import { copyFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(root, 'backend');
const target = resolve(backend, 'target/wasm32-unknown-unknown/release/cc_sim_core.wasm');
const destination = resolve(root, 'public/wasm/cc_sim_core.wasm');

function run(command, args, cwd = root) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', rejectRun);
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

await run('cargo', [
  'build',
  '--locked',
  '--release',
  '--target',
  'wasm32-unknown-unknown',
  '-p',
  'cc-sim-core',
  '--no-default-features',
], backend);
await mkdir(dirname(destination), { recursive: true });
await copyFile(target, destination);
