/**
 * Bisects the post chain with the measured sky value.
 *
 *   node scripts/validate_atmosphere_sky.mjs
 *
 * Renders takram's sky() alone, starting from their own defaults and adding one
 * piece of our integration per stage. The first stage whose upper-half mean goes
 * black names the assumption that is wrong — no scene, no depth buffer, no
 * aerial perspective involved.
 *
 * Runs under Electron because Chromium gates WebGPU on Linux behind
 * --enable-features=Vulkan.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = await import('electron');
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  app.commandLine.appendSwitch('enable-features', 'Vulkan');

  const pagePath = process.env.GPSKY_PAGE;

  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 320, height: 240 });
    let payload;
    try {
      await win.loadFile(pagePath);
      payload = await win.webContents.executeJavaScript(
        `new Promise((resolve, reject) => {
           const start = Date.now();
           (function poll() {
             if (window.GameplaySky) { window.GameplaySky.run().then(resolve, (e) => resolve({ ok: false, error: String(e && e.message || e) })); return; }
             if (Date.now() - start > 15000) { reject(new Error('module never evaluated')); return; }
             setTimeout(poll, 50);
           })();
         })`,
      );
    } catch (error) {
      payload = { ok: false, error: String(error?.message ?? error) };
    }
    process.stdout.write('\n__GPSKY__' + JSON.stringify(payload) + '__GPSKY__\n');
    win.destroy();
    app.exit(payload && payload.ok ? 0 : 1);
  });
} else {
  const esbuild = await import('esbuild');

  const built = await esbuild.build({
    entryPoints: [join(here, 'validate_gameplay_sky_entry.ts')],
    bundle: true,
    format: 'esm',
    // ESM, not IIFE: webgpu-post-stack pulls in modules with top-level
    // `new URL(..., import.meta.url)`, which esbuild leaves empty under IIFE and
    // which then throws while the bundle is still evaluating.
    footer: { js: 'window.GameplaySky = { run };' },
    platform: 'browser',
    target: 'es2022',
    write: false,
    absWorkingDir: repoRoot,
  });

  const workDir = await mkdtemp(join(tmpdir(), 'asteron-gpsky-'));
  const pagePath = join(workDir, 'gpsky.html');
  // Inlined rather than <script src>: navigator.gpu is undefined on opaque
  // origins, so the page must be a real file.
  await writeFile(
    pagePath,
    `<!doctype html><meta charset="utf-8"><title>gpsky</title><body>running</body>\n<script type="module">\n${built.outputFiles[0].text.replace(
      /<\/script>/gi,
      '<\\/script>',
    )}\n</script>\n`,
  );

  const electronBin = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron');
  const child = spawn(electronBin, [fileURLToPath(import.meta.url)], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, GPSKY_PAGE: pagePath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', () => {}); // Electron/Vulkan chatter

  const exitCode = await new Promise((res) => child.on('close', res));
  await rm(workDir, { recursive: true, force: true });

  const match = stdout.match(/__GPSKY__([\s\S]*?)__GPSKY__/);
  if (!match) {
    console.error(`gameplay sky repro produced no result (electron exit ${exitCode})`);
    process.exit(1);
  }
  const result = JSON.parse(match[1]);

  if (result.samples?.length) {
    console.log('');
    console.log(`  adapter : ${result.adapter ?? 'n/a'}`);
    console.log('');
    console.log('  place          sun elev   luminance   R / G / B / A');
    for (const s of result.samples) {
      console.log(
        `  ${s.place.padEnd(14)}${String(s.sunElevationDegrees).padStart(6)} deg` +
          `${s.luminance.toExponential(2).padStart(12)}   ` +
          `${s.r.toFixed(4)} ${s.g.toFixed(4)} ${s.b.toFixed(4)} a=${s.a.toFixed(4)}` +
          `${s.black ? '   <-- BLACK' : ''}`,
      );
    }
    console.log('');
    const black = result.samples.filter((s) => s.black);
    console.log(
      black.length === 0
        ? '  Real post stack renders a sky everywhere. Gameplay black is NOT the post stack.'
        : `  Black at ${black.length}/${result.samples.length} sample(s).`,
    );
    console.log('');
  }

  if (!result.ok) {
    console.error(`gameplay sky repro failed: ${result.error}`);
    process.exit(1);
  }
}
