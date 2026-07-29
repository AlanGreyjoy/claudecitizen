/**
 * Resolve the KTX-Software `ktx` CLI for texture transcoding.
 *
 * Order: ASTERON_KTX env → managed install under ~/.asteron/tools/ktx/<version>
 * → bare `ktx` on PATH.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Pinned release that Tools → Packages installs. Bump with engine_tools.mjs. */
export const KTX_PINNED_VERSION = '4.4.2';

export const KTX_RELEASES_URL = 'https://github.com/KhronosGroup/KTX-Software/releases';

export function toolsRootDir() {
  return join(homedir(), '.asteron', 'tools');
}

export function ktxInstallRoot(version = KTX_PINNED_VERSION) {
  return join(toolsRootDir(), 'ktx', version);
}

export function ktxManagedBinaryPath(version = KTX_PINNED_VERSION) {
  const name = process.platform === 'win32' ? 'ktx.exe' : 'ktx';
  return join(ktxInstallRoot(version), 'bin', name);
}

export function toolsManifestPath() {
  return join(toolsRootDir(), 'manifest.json');
}

/**
 * @returns {{ path: string, source: 'env' | 'managed' | 'path' } | null}
 */
export function resolveKtxBinary() {
  const fromEnv = process.env.ASTERON_KTX?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return { path: fromEnv, source: 'env' };
  }

  const managed = ktxManagedBinaryPath();
  if (existsSync(managed)) {
    return { path: managed, source: 'managed' };
  }

  const probe = spawnSync('ktx', ['--version'], { encoding: 'utf8' });
  if (!probe.error && probe.status === 0) {
    return { path: 'ktx', source: 'path' };
  }

  return null;
}

/** @returns {string | null} First line of `ktx --version`, or null. */
export function probeKtxVersion(binaryPath) {
  if (!binaryPath) return null;
  const probe = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return null;
  return (probe.stdout || probe.stderr || '').trim().split('\n')[0] || null;
}
