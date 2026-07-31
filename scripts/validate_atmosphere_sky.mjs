/**
 * Bisects the black atmosphere sky.
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

  const pagePath = process.env.SKY_PAGE;

  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 320, height: 240 });
    let payload;
    try {
      await win.loadFile(pagePath);
      payload = await win.webContents.executeJavaScript('AtmosphereSky.run()');
    } catch (error) {
      payload = { ok: false, error: String(error?.message ?? error) };
    }
    process.stdout.write('\n__SKY__' + JSON.stringify(payload) + '__SKY__\n');
    win.destroy();
    app.exit(payload && payload.ok ? 0 : 1);
  });
} else {
  const esbuild = await import('esbuild');

  const built = await esbuild.build({
    entryPoints: [join(here, 'validate_atmosphere_sky_entry.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'AtmosphereSky',
    platform: 'browser',
    target: 'es2022',
    write: false,
    absWorkingDir: repoRoot,
  });

  const workDir = await mkdtemp(join(tmpdir(), 'asteron-sky-'));
  const pagePath = join(workDir, 'sky.html');
  // Inlined rather than <script src>: navigator.gpu is undefined on opaque
  // origins, so the page must be a real file.
  await writeFile(
    pagePath,
    `<!doctype html><meta charset="utf-8"><title>sky</title><body>running</body>\n<script>\n${built.outputFiles[0].text.replace(
      /<\/script>/gi,
      '<\\/script>',
    )}\n</script>\n`,
  );

  const electronBin = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron');
  const child = spawn(electronBin, [fileURLToPath(import.meta.url)], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, SKY_PAGE: pagePath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', () => {}); // Electron/Vulkan chatter

  const exitCode = await new Promise((res) => child.on('close', res));
  await rm(workDir, { recursive: true, force: true });

  const match = stdout.match(/__SKY__([\s\S]*?)__SKY__/);
  if (!match) {
    console.error(`sky bisect produced no result (electron exit ${exitCode})`);
    process.exit(1);
  }
  const result = JSON.parse(match[1]);

  if (result.stages?.length) {
    console.log('');
    console.log(`  adapter : ${result.adapter ?? 'n/a'}`);
    console.log('');
    console.log('  stage                              luminance   mean RGB');
    for (const stage of result.stages) {
      console.log(
        `  ${stage.name.padEnd(34)}` +
          `${stage.luminance.toExponential(2).padStart(10)}   ` +
          `${stage.meanR.toFixed(4)} ${stage.meanG.toFixed(4)} ${stage.meanB.toFixed(4)}` +
          `${stage.black ? '   <-- BLACK' : ''}`,
      );
      console.log(`      ${stage.detail}`);
    }
    console.log('');
    const firstBlack = result.stages.find((stage) => stage.black);
    if (firstBlack) {
      console.log(`  First black stage: "${firstBlack.name}" — ${firstBlack.detail}`);
    } else {
      console.log('  No stage went black; the sky node works with every setting we apply.');
      console.log('  The fault is downstream — the aerial-perspective composite or the depth input.');
    }
    console.log('');
  }

  if (!result.ok) {
    console.error(`sky bisect failed: ${result.error}`);
    process.exit(1);
  }
}
