/**
 * WebGPU compute spike: is a WGSL port of our simplex/fbm climate kernel both
 * faithful to the CPU result and faster once readback is paid for?
 *
 *   node scripts/webgpu_noise_spike.mjs [--samples N] [--seed N] [--repeats N]
 *
 * Runs under Electron (which is where the editor lives) because Chromium gates
 * WebGPU on Linux behind --enable-features=Vulkan. Touches no engine code: it
 * imports src/world/terrain-noise.ts read-only for the CPU reference so the
 * comparison is against the real kernel, not a transcription of it.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function parseArgs(argv) {
  const args = { samples: 262_144, seed: 1337, repeats: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split('=');
    const readValue = () => (inline !== undefined ? inline : argv[++i]);
    if (key === '--samples') args.samples = Number(readValue());
    else if (key === '--seed') args.seed = Number(readValue());
    else if (key === '--repeats') args.repeats = Number(readValue());
  }
  return args;
}

// Electron re-executes this file inside its main process. The parent pass
// bundles + spawns; the child pass drives the browser window.
if (process.versions.electron) {
  const { app, BrowserWindow } = await import('electron');
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  app.commandLine.appendSwitch('enable-features', 'Vulkan');

  const pagePath = process.env.SPIKE_PAGE;
  const { samples, seed, repeats } = JSON.parse(process.env.SPIKE_ARGS);

  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 640, height: 480 });
    let payload;
    try {
      await win.loadFile(pagePath);
      payload = await win.webContents.executeJavaScript(
        `Spike.run(${samples}, ${seed}, ${repeats})`,
      );
    } catch (error) {
      payload = { ok: false, error: String(error && error.message ? error.message : error) };
    }
    process.stdout.write('\n__SPIKE__' + JSON.stringify(payload) + '__SPIKE__\n');
    win.destroy();
    app.exit(payload && payload.ok ? 0 : 1);
  });
} else {
  const args = parseArgs(process.argv.slice(2));
  const esbuild = await import('esbuild');

  const built = await esbuild.build({
    entryPoints: [join(here, 'webgpu_noise_spike_entry.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'Spike',
    platform: 'browser',
    target: 'es2022',
    write: false,
    absWorkingDir: repoRoot,
  });
  const code = built.outputFiles[0].text;

  const workDir = await mkdtemp(join(tmpdir(), 'asteron-webgpu-spike-'));
  const pagePath = join(workDir, 'spike.html');
  // Inlined rather than <script src>: Chromium blocks module/script fetches
  // across file:// origins, and navigator.gpu is undefined on opaque origins
  // (data:, about:blank), so the page must be a real file.
  await writeFile(
    pagePath,
    `<!doctype html><meta charset="utf-8"><title>spike</title><body>running</body>\n<script>\n${code.replace(/<\/script>/gi, '<\\/script>')}\n</script>\n`,
  );

  const electronBin = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron');
  const child = spawn(electronBin, [fileURLToPath(import.meta.url)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      SPIKE_PAGE: pagePath,
      SPIKE_ARGS: JSON.stringify(args),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', () => {}); // Electron/Vulkan chatter, not useful here

  const exitCode = await new Promise((res) => child.on('close', res));
  await rm(workDir, { recursive: true, force: true });

  const match = stdout.match(/__SPIKE__([\s\S]*?)__SPIKE__/);
  if (!match) {
    console.error(`spike produced no result (electron exit ${exitCode})`);
    process.exit(1);
  }
  const result = JSON.parse(match[1]);
  if (!result.ok) {
    console.error(`spike failed: ${result.error}`);
    process.exit(1);
  }

  const ms = (value) => (value === null || value === undefined ? '    n/a' : `${value.toFixed(2).padStart(7)} ms`);
  const { tableCheck, agreement, timing } = result;

  console.log('');
  console.log(`  adapter        : ${result.adapter}`);
  console.log(`  samples        : ${result.samples.toLocaleString()}  (10 simplex-3D evals each)`);
  console.log('');
  console.log('  --- fidelity ---');
  console.log(`  perm table vs engine getNoise3D : max |d| = ${tableCheck.maxDelta.toExponential(3)}  ${tableCheck.pass ? 'EXACT' : 'MISMATCH'}`);
  for (const field of agreement) {
    console.log(
      `  ${field.name.padEnd(12)} CPU f64 vs GPU f32 : max |d| = ${field.maxAbs.toExponential(3)}` +
      `   mean |d| = ${field.meanAbs.toExponential(3)}   max rel = ${field.maxRel.toExponential(3)}`,
    );
  }
  console.log('');
  console.log('  --- timing (median of repeats) ---');
  console.log(`  CPU  engine fbm3d x3   : ${ms(timing.cpuMs)}`);
  console.log(`  GPU  kernel only       : ${ms(timing.gpuKernelMs)}`);
  console.log(`  GPU  readback (map)    : ${ms(timing.gpuReadbackMs)}`);
  console.log(`  GPU  total wall        : ${ms(timing.gpuTotalMs)}`);
  console.log('');
  console.log(`  speedup, kernel only   : ${timing.speedupKernel === null ? 'n/a' : timing.speedupKernel.toFixed(2) + 'x'}`);
  console.log(`  speedup, incl readback : ${timing.speedupTotal.toFixed(2)}x`);
  console.log('');
}
