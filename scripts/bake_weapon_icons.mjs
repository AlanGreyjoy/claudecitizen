/**
 * Bake 512px inventory icons for every weapon in weapon_catalog_data.mjs.
 *
 *   node scripts/bake_weapon_icons.mjs [--project <dir>] [--out <dir>] [--only <id>]
 *
 * Runs three.js under Electron the same way validate_atmosphere_sky.mjs does:
 * esbuild bundles the browser half to an IIFE, that gets inlined into a temp
 * page, and Electron drives it one weapon at a time. GLBs are handed over as
 * base64 and parsed in-page, so nothing depends on file:// fetch rules — the
 * Synty packs embed all their textures, so the models are self-contained.
 *
 * Output: <out>/<weapon-id>.png, consumed by seed_weapon_catalog.mjs.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const DEFAULT_PROJECT = '/home/alan/Documents/AsteronEngine/Asteron';
const DEFAULT_OUT = join(repoRoot, 'build', 'weapon-icons');

function parseArgs(argv) {
  const args = { project: DEFAULT_PROJECT, out: DEFAULT_OUT, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') args.project = resolve(argv[i + 1] ?? '');
    if (argv[i] === '--out') args.out = resolve(argv[i + 1] ?? '');
    if (argv[i] === '--only') args.only = argv[i + 1] ?? null;
  }
  return args;
}

if (process.versions.electron) {
  const { app, BrowserWindow } = await import('electron');
  // A hidden window on a headless-ish Linux session is exactly the case
  // Chromium blocklists, and losing the GL context fails the whole bake.
  // SwiftShader is plenty for a static 512px product shot.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');

  const pagePath = process.env.ICON_PAGE;
  const jobsPath = process.env.ICON_JOBS;
  const outDir = process.env.ICON_OUT;

  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 600, height: 600 });
    const jobs = JSON.parse(await readFile(jobsPath, 'utf8'));
    const results = [];
    try {
      await win.loadFile(pagePath);
      for (const job of jobs) {
        const base64 = (await readFile(job.glb)).toString('base64');
        // Stage the payload rather than interpolating megabytes into a call.
        await win.webContents.executeJavaScript(
          `window.__job = ${JSON.stringify({ base64, melee: job.melee })}; true;`,
        );
        const outcome = await win.webContents.executeJavaScript(
          'WeaponIcons.render(window.__job).then(r => r, e => ({ ok: false, error: String(e && e.message || e) }))',
        );
        if (outcome.ok) {
          const png = Buffer.from(outcome.dataUrl.split(',')[1], 'base64');
          await writeFile(join(outDir, `${job.id}.png`), png);
          results.push({ id: job.id, ok: true, bytes: png.length });
        } else {
          results.push({ id: job.id, ok: false, error: outcome.error });
        }
        await win.webContents.executeJavaScript('window.__job = null; true;');
      }
    } catch (error) {
      results.push({ id: '(harness)', ok: false, error: String(error?.message ?? error) });
    }
    process.stdout.write(`\n__ICONS__${JSON.stringify(results)}__ICONS__\n`);
    win.destroy();
    app.exit(results.every((r) => r.ok) ? 0 : 1);
  });
} else {
  const args = parseArgs(process.argv.slice(2));
  const { WEAPONS } = await import('./weapon_catalog_data.mjs');
  const esbuild = await import('esbuild');

  const assetsRoot = join(args.project, 'assets');
  const selected = WEAPONS.filter((w) => !args.only || w.id === args.only);
  if (selected.length === 0) throw new Error(`No weapons matched --only ${args.only}`);

  const jobs = [];
  for (const weapon of selected) {
    const glb = join(assetsRoot, weapon.glbPath);
    if (!existsSync(glb)) {
      console.error(`SKIP ${weapon.id}: missing ${weapon.glbPath}`);
      continue;
    }
    jobs.push({ id: weapon.id, glb, melee: weapon.melee });
  }

  await mkdir(args.out, { recursive: true });
  const built = await esbuild.build({
    entryPoints: [join(here, 'bake_weapon_icons_entry.mjs')],
    bundle: true,
    format: 'iife',
    globalName: 'WeaponIcons',
    platform: 'browser',
    target: 'es2022',
    write: false,
    absWorkingDir: repoRoot,
  });

  const workDir = await mkdtemp(join(tmpdir(), 'asteron-icons-'));
  const pagePath = join(workDir, 'icons.html');
  const jobsPath = join(workDir, 'jobs.json');
  await writeFile(jobsPath, JSON.stringify(jobs), 'utf8');
  await writeFile(
    pagePath,
    `<!doctype html><meta charset="utf-8"><title>weapon icons</title><body></body>\n<script>\n${built.outputFiles[0].text.replace(
      /<\/script>/gi,
      '<\\/script>',
    )}\n</script>\n`,
    'utf8',
  );

  const electronBin = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron');
  const child = spawn(electronBin, [fileURLToPath(import.meta.url)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      ICON_PAGE: pagePath,
      ICON_JOBS: jobsPath,
      ICON_OUT: args.out,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', () => {}); // Electron/GPU chatter

  const exitCode = await new Promise((res) => child.on('close', res));
  await rm(workDir, { recursive: true, force: true });

  const match = stdout.match(/__ICONS__([\s\S]*?)__ICONS__/);
  if (!match) {
    console.error(`icon bake produced no result (electron exit ${exitCode})`);
    console.error(stdout.slice(-2000));
    process.exit(1);
  }
  const results = JSON.parse(match[1]);
  const failed = results.filter((r) => !r.ok);
  for (const result of failed) console.error(`FAIL ${result.id}: ${result.error}`);
  const ok = results.filter((r) => r.ok);
  const average = ok.length
    ? Math.round(ok.reduce((sum, r) => sum + r.bytes, 0) / ok.length / 1024)
    : 0;
  console.log(`${ok.length}/${results.length} icons -> ${args.out} (avg ${average}KB)`);
  process.exit(failed.length === 0 ? 0 : 1);
}
