import { copyFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'target/wasm32-unknown-unknown/release/cc_sim_core.wasm');
const destination = resolve(root, 'public/wasm/cc_sim_core.wasm');

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
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
]);
await mkdir(dirname(destination), { recursive: true });
await copyFile(target, destination);
