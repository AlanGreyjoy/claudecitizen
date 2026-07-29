/**
 * Engine-managed native tools (KTX-Software today).
 *
 * Installs under ~/.asteron/tools/ — no sudo, no system package managers.
 * Download + SHA1 verify from the pinned Khronos GitHub release.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  existsSync,
} from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  cp,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  KTX_PINNED_VERSION,
  KTX_RELEASES_URL,
  ktxInstallRoot,
  ktxManagedBinaryPath,
  probeKtxVersion,
  resolveKtxBinary,
  toolsManifestPath,
  toolsRootDir,
} from '../scripts/resolve_ktx.mjs';

const KTX_RELEASE_BASE =
  `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_PINNED_VERSION}`;

/**
 * Per-platform release assets. SHA1s for Darwin/Windows are pinned here because
 * those builds ship without companion `.sha1` files on the releases page.
 */
const KTX_ASSETS = {
  'linux-x64': {
    file: `KTX-Software-${KTX_PINNED_VERSION}-Linux-x86_64.tar.bz2`,
    sha1: 'c6b08c817f8c8dd299deccae4f2fbb8d55e9acd2',
    kind: 'tar.bz2',
  },
  'linux-arm64': {
    file: `KTX-Software-${KTX_PINNED_VERSION}-Linux-arm64.tar.bz2`,
    sha1: '5300220283c2c1bef07ca310b27519241e5f51ee',
    kind: 'tar.bz2',
  },
  'darwin-arm64': {
    file: `KTX-Software-${KTX_PINNED_VERSION}-Darwin-arm64.pkg`,
    sha1: 'f6bc075b4de1f633ded8efe06e8b281e6360b1c4',
    kind: 'pkg',
  },
  'darwin-x64': {
    file: `KTX-Software-${KTX_PINNED_VERSION}-Darwin-x86_64.pkg`,
    sha1: '69aa8799fbfaf72380adfef949727ffb36671aa8',
    kind: 'pkg',
  },
  'win32-x64': {
    file: `KTX-Software-${KTX_PINNED_VERSION}-Windows-x64.exe`,
    sha1: '5323b8dd2431dcd4c22aa869015942294bea99e7',
    kind: 'nsis',
  },
  'win32-arm64': {
    file: `KTX-Software-${KTX_PINNED_VERSION}-Windows-arm64.exe`,
    sha1: '74c6063d727e45837c3dd89d69e8522ca3f3562e',
    kind: 'nsis',
  },
};

export class EngineToolsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'EngineToolsError';
    this.status = status;
  }
}

function platformKey() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  if (!arch) {
    throw new EngineToolsError(
      `Unsupported CPU architecture "${process.arch}" for KTX-Software.`,
      400,
    );
  }
  if (process.platform === 'linux') return `linux-${arch}`;
  if (process.platform === 'darwin') return `darwin-${arch}`;
  if (process.platform === 'win32') return `win32-${arch}`;
  throw new EngineToolsError(
    `Unsupported platform "${process.platform}" for KTX-Software.`,
    400,
  );
}

function resolveAsset() {
  const key = platformKey();
  const asset = KTX_ASSETS[key];
  if (!asset) {
    throw new EngineToolsError(`No KTX-Software build for ${key}.`, 400);
  }
  return { key, ...asset, url: `${KTX_RELEASE_BASE}/${asset.file}` };
}

async function readManifest() {
  try {
    const raw = await readFile(toolsManifestPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeManifest(next) {
  await mkdir(toolsRootDir(), { recursive: true });
  await writeFile(toolsManifestPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function downloadFile(url, destPath, onProgress) {
  onProgress?.({ phase: 'downloading', message: `Downloading ${basename(url)}…` });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new EngineToolsError(
      `Download failed (${response.status}): ${url}`,
      502,
    );
  }
  await mkdir(dirname(destPath), { recursive: true });
  await pipeline(response.body, createWriteStream(destPath));
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new EngineToolsError(
      `${command} ${args.join(' ')} failed`
        + (detail ? `:\n${detail.slice(0, 2000)}` : '.'),
    );
  }
  return result;
}

async function extractTarBz2(archivePath, installRoot, onProgress) {
  onProgress?.({ phase: 'extracting', message: 'Extracting KTX-Software…' });
  await rm(installRoot, { recursive: true, force: true });
  await mkdir(installRoot, { recursive: true });
  runCommand('tar', ['-xjf', archivePath, '-C', installRoot, '--strip-components=1']);
}

/**
 * Expand a macOS .pkg without installing system-wide, then copy bin/ + lib/.
 */
async function extractDarwinPkg(pkgPath, installRoot, onProgress) {
  onProgress?.({ phase: 'extracting', message: 'Expanding macOS package…' });
  const expandDir = await mkdtemp(join(tmpdir(), 'asteron-ktx-pkg-'));
  try {
    runCommand('pkgutil', ['--expand-full', pkgPath, expandDir]);
    const binCandidates = [];
    const libCandidates = [];
    async function walk(dir) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'bin') binCandidates.push(full);
          if (entry.name === 'lib') libCandidates.push(full);
          await walk(full);
        }
      }
    }
    await walk(expandDir);
    const binDir = binCandidates.find((dir) => existsSync(join(dir, 'ktx')));
    if (!binDir) {
      throw new EngineToolsError(
        'Expanded .pkg did not contain bin/ktx. Install from the releases page instead.',
      );
    }
    const siblingLib = join(dirname(binDir), 'lib');
    const libDir = existsSync(siblingLib)
      ? siblingLib
      : libCandidates[0] ?? null;

    await rm(installRoot, { recursive: true, force: true });
    await mkdir(join(installRoot, 'bin'), { recursive: true });
    await cp(binDir, join(installRoot, 'bin'), { recursive: true });
    if (libDir && existsSync(libDir)) {
      await mkdir(join(installRoot, 'lib'), { recursive: true });
      await cp(libDir, join(installRoot, 'lib'), { recursive: true });
    }
  } finally {
    await rm(expandDir, { recursive: true, force: true });
  }
}

async function extractWindowsNsis(exePath, installRoot, onProgress) {
  onProgress?.({ phase: 'extracting', message: 'Running silent Windows installer…' });
  await rm(installRoot, { recursive: true, force: true });
  await mkdir(installRoot, { recursive: true });
  // NSIS: /S silent, /D= must be last and unquoted.
  const result = spawnSync(exePath, ['/S', `/D=${installRoot}`], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new EngineToolsError(
      `Silent KTX installer failed (exit ${result.status ?? 'unknown'}). `
        + `Try the releases page: ${KTX_RELEASES_URL}`,
    );
  }

  const candidates = [
    join(installRoot, 'bin', 'ktx.exe'),
    join(installRoot, 'ktx.exe'),
  ];
  let found = candidates.find((path) => existsSync(path));
  if (!found) {
    async function findKtx(dir, depth = 0) {
      if (depth > 4 || found) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === 'ktx.exe') {
          found = full;
          return;
        }
        if (entry.isDirectory()) await findKtx(full, depth + 1);
      }
    }
    await findKtx(installRoot);
  }
  if (!found) {
    await rm(installRoot, { recursive: true, force: true });
    throw new EngineToolsError(
      `Silent install finished but ktx.exe was not found under ${installRoot}. `
        + `Install from ${KTX_RELEASES_URL} and ensure ktx is on PATH.`,
    );
  }
  // Normalize to installRoot/bin/ktx.exe when the installer used a flat layout.
  const normalized = join(installRoot, 'bin', 'ktx.exe');
  if (found !== normalized) {
    await mkdir(dirname(normalized), { recursive: true });
    if (!existsSync(normalized)) {
      await cp(found, normalized);
    }
  }
}

/**
 * @returns {Promise<{
 *   id: string,
 *   name: string,
 *   description: string,
 *   version: string,
 *   state: 'missing' | 'installed' | 'outdated',
 *   binaryPath: string | null,
 *   versionLabel: string | null,
 *   pathSource: 'env' | 'managed' | 'path' | null,
 *   releasesUrl: string,
 * }>}
 */
export async function getKtxPackageStatus() {
  const managedBinary = ktxManagedBinaryPath();
  const managedExists = existsSync(managedBinary);
  const managedVersion = managedExists ? probeKtxVersion(managedBinary) : null;
  const manifest = await readManifest();
  const manifestVersion = typeof manifest?.ktx?.version === 'string' ? manifest.ktx.version : null;

  let state = 'missing';
  if (managedExists) {
    state = manifestVersion === KTX_PINNED_VERSION || (managedVersion ?? '').includes(KTX_PINNED_VERSION)
      ? 'installed'
      : 'outdated';
  }

  const resolved = resolveKtxBinary();
  return {
    id: 'ktx-software',
    name: 'KTX-Software',
    description: 'Basis/KTX2 texture encoder for derived assets (.asteron/derived).',
    version: KTX_PINNED_VERSION,
    state,
    binaryPath: resolved?.path ?? null,
    versionLabel: resolved ? probeKtxVersion(resolved.path) : null,
    pathSource: resolved?.source ?? null,
    releasesUrl: KTX_RELEASES_URL,
  };
}

export async function listEnginePackages() {
  return { packages: [await getKtxPackageStatus()] };
}

/**
 * @param {{ onProgress?: (event: { phase: string, message: string }) => void }} [options]
 */
export async function installKtxPackage({ onProgress } = {}) {
  const asset = resolveAsset();
  const installRoot = ktxInstallRoot();
  const staging = await mkdtemp(join(tmpdir(), 'asteron-ktx-dl-'));
  const archivePath = join(staging, asset.file);

  try {
    await downloadFile(asset.url, archivePath, onProgress);
    onProgress?.({ phase: 'verifying', message: 'Verifying SHA1…' });
    const digest = await sha1File(archivePath);
    if (digest.toLowerCase() !== asset.sha1.toLowerCase()) {
      throw new EngineToolsError(
        `SHA1 mismatch for ${asset.file}: expected ${asset.sha1}, got ${digest}.`,
      );
    }

    if (asset.kind === 'tar.bz2') {
      await extractTarBz2(archivePath, installRoot, onProgress);
    } else if (asset.kind === 'pkg') {
      await extractDarwinPkg(archivePath, installRoot, onProgress);
    } else if (asset.kind === 'nsis') {
      await extractWindowsNsis(archivePath, installRoot, onProgress);
    } else {
      throw new EngineToolsError(`Unknown asset kind "${asset.kind}".`);
    }

    const binary = ktxManagedBinaryPath();
    const versionLabel = probeKtxVersion(binary);
    if (!versionLabel) {
      await rm(installRoot, { recursive: true, force: true });
      throw new EngineToolsError(
        `Installed files at ${installRoot} but \`ktx --version\` failed.`,
      );
    }

    const manifest = await readManifest();
    manifest.ktx = {
      version: KTX_PINNED_VERSION,
      path: installRoot,
      binaryPath: binary,
      installedAt: new Date().toISOString(),
    };
    await writeManifest(manifest);

    onProgress?.({ phase: 'success', message: `Installed ${versionLabel}` });
    return {
      ok: true,
      message: `Installed ${versionLabel}`,
      package: await getKtxPackageStatus(),
    };
  } catch (error) {
    onProgress?.({
      phase: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function uninstallKtxPackage() {
  const installRoot = ktxInstallRoot();
  await rm(installRoot, { recursive: true, force: true });
  // Also drop any other version dirs left behind after a pin bump.
  const ktxRoot = join(toolsRootDir(), 'ktx');
  if (existsSync(ktxRoot)) {
    try {
      const versions = await readdir(ktxRoot);
      if (versions.length === 0) await rm(ktxRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  const manifest = await readManifest();
  if (manifest.ktx) {
    delete manifest.ktx;
    await writeManifest(manifest);
  }
  return {
    ok: true,
    message: 'KTX-Software removed from ~/.asteron/tools.',
    package: await getKtxPackageStatus(),
  };
}

export { KTX_PINNED_VERSION, KTX_RELEASES_URL, resolveKtxBinary, ktxManagedBinaryPath };
