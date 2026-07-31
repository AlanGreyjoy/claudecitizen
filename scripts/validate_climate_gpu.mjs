/**
 * Validates the production GPU climate kernel against the production CPU path.
 *
 *   node scripts/validate_climate_gpu.mjs [--samples N] [--seed N]
 *
 * Reports two things: per-field CPU-f64-vs-GPU-f32 agreement, and how often that
 * delta actually flips `classifyBiome`. The second number is the one that
 * matters — PLAN.md lists threshold flips as the named risk of GPU climate, and
 * a flip rate is the only honest way to size it.
 *
 * Runs under Electron because Chromium gates WebGPU on Linux behind
 * --enable-features=Vulkan. Exits non-zero when the GPU is unreachable or the
 * flip rate exceeds --max-flip-rate, so this is usable as a gate.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function parseArgs(argv) {
  const args = { samples: 262_144, seed: 1337, maxFlipRate: 1e-4 };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split('=');
    const readValue = () => (inline !== undefined ? inline : argv[++i]);
    if (key === '--samples') args.samples = Number(readValue());
    else if (key === '--seed') args.seed = Number(readValue());
    else if (key === '--max-flip-rate') args.maxFlipRate = Number(readValue());
  }
  return args;
}

// Electron re-executes this file inside its main process. The parent pass
// bundles + spawns; the child pass drives the browser window.
if (process.versions.electron) {
  const { app, BrowserWindow } = await import('electron');
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  app.commandLine.appendSwitch('enable-features', 'Vulkan');

  const pagePath = process.env.VALIDATE_PAGE;
  const { samples, seed } = JSON.parse(process.env.VALIDATE_ARGS);

  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 640, height: 480 });
    let payload;
    try {
      await win.loadFile(pagePath);
      payload = await win.webContents.executeJavaScript(
        `ClimateGpu.run(${samples}, ${seed})`,
      );
    } catch (error) {
      payload = { ok: false, error: String(error?.message ?? error) };
    }
    process.stdout.write('\n__VALIDATE__' + JSON.stringify(payload) + '__VALIDATE__\n');
    win.destroy();
    app.exit(payload && payload.ok ? 0 : 1);
  });
} else {
  const args = parseArgs(process.argv.slice(2));
  const esbuild = await import('esbuild');

  const built = await esbuild.build({
    entryPoints: [join(here, 'validate_climate_gpu_entry.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ClimateGpu',
    platform: 'browser',
    target: 'es2022',
    write: false,
    absWorkingDir: repoRoot,
  });

  const workDir = await mkdtemp(join(tmpdir(), 'asteron-climate-gpu-'));
  const pagePath = join(workDir, 'validate.html');
  // Inlined rather than <script src>: Chromium blocks script fetches across
  // file:// origins, and navigator.gpu is undefined on opaque origins (data:,
  // about:blank), so the page must be a real file.
  await writeFile(
    pagePath,
    `<!doctype html><meta charset="utf-8"><title>climate-gpu</title><body>running</body>\n<script>\n${built.outputFiles[0].text.replace(
      /<\/script>/gi,
      '<\\/script>',
    )}\n</script>\n`,
  );

  const electronBin = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron');
  const child = spawn(electronBin, [fileURLToPath(import.meta.url)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      VALIDATE_PAGE: pagePath,
      VALIDATE_ARGS: JSON.stringify(args),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', () => {}); // Electron/Vulkan chatter, not useful here

  const exitCode = await new Promise((res) => child.on('close', res));
  await rm(workDir, { recursive: true, force: true });

  const match = stdout.match(/__VALIDATE__([\s\S]*?)__VALIDATE__/);
  if (!match) {
    console.error(`climate GPU validation produced no result (electron exit ${exitCode})`);
    process.exit(1);
  }
  const result = JSON.parse(match[1]);
  if (!result.ok) {
    console.error(`climate GPU validation failed: ${result.error}`);
    process.exit(1);
  }

  const { agreement, biome, timing } = result;
  console.log('');
  console.log(`  adapter  : ${result.adapter}`);
  console.log(`  samples  : ${result.samples.toLocaleString()}`);
  console.log('');
  console.log('  --- field agreement (CPU f64 vs GPU f32) ---');
  for (const field of agreement) {
    console.log(
      `  ${field.name.padEnd(12)} max |d| = ${field.maxAbs.toExponential(3)}` +
        `   mean |d| = ${field.meanAbs.toExponential(3)}` +
        `   max rel = ${field.maxRel.toExponential(3)}`,
    );
  }
  console.log('');
  console.log('  --- classifyBiome flips ---');
  console.log(
    `  ${biome.flipped.toLocaleString()} / ${biome.compared.toLocaleString()}` +
      `   rate = ${biome.flipRate.toExponential(3)}` +
      `   (budget ${args.maxFlipRate.toExponential(3)})`,
  );
  for (const flip of biome.examples) {
    console.log(
      `    ${flip.cpu} -> ${flip.gpu}` +
        `   dT = ${flip.temperatureDelta.toExponential(2)}` +
        `   dM = ${flip.moistureDelta.toExponential(2)}`,
    );
  }
  console.log('  --- timing ---');
  console.log(`  CPU  : ${timing.cpuMs.toFixed(2)} ms`);
  console.log(`  GPU  : ${timing.gpuMs.toFixed(2)} ms  (includes readback)`);
  console.log(`  speedup incl readback : ${timing.speedup.toFixed(2)}x`);
  console.log('');

  if (biome.flipRate > args.maxFlipRate) {
    console.error(
      `flip rate ${biome.flipRate.toExponential(3)} exceeds budget ${args.maxFlipRate.toExponential(3)}`,
    );
    process.exit(1);
  }
}
