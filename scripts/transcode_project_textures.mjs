#!/usr/bin/env node
/**
 * Transcodes every embedded texture in a project's GLB/glTF assets to KTX2
 * (Basis Universal), writing non-destructive twins under
 * `<project>/.asteron/derived/<same relative path>`.
 *
 * Why derived twins rather than in-place: `scripts/bake_*.py` parse the embedded
 * PNG/JPEG payloads with Pillow and must keep working after every fresh Unity
 * export. Run the bake scripts first, then this — the manifest's mtime check
 * picks up a re-baked source automatically.
 *
 * Codec choice is per texture, driven by the glTF slot the texture occupies:
 *   normalTexture                              -> UASTC  (banding is visible)
 *   occlusion / metallicRoughness              -> UASTC by default; ETC1S is
 *                                                 channel-correlated and wrecks
 *                                                 packed ORM maps
 *   baseColor / emissive                       -> ETC1S  (~0.5 byte/texel)
 *
 * Requires KTX-Software's `ktx` binary (Tools → Packages…, ASTERON_KTX, or PATH).
 *
 * Usage:
 *   node scripts/transcode_project_textures.mjs --project <dir> [options]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { listTextureSlots } from '@gltf-transform/functions';

import { DERIVED_ROOT_RELATIVE } from './derived-assets.mjs';
import {
  KTX_RELEASES_URL,
  probeKtxVersion,
  resolveKtxBinary,
} from './resolve_ktx.mjs';

const MANIFEST_NAME = 'manifest.json';
const MANIFEST_SCHEMA_VERSION = 1;
const MODEL_EXTENSIONS = new Set(['.glb', '.gltf']);

const UASTC_SLOTS = new Set([
  'occlusionTexture',
  'metallicRoughnessTexture',
  // Sparse emissive atlases trip a BasisLZ SSE assert in KTX-Software 4.4.x
  // (`early_out_err >= 0`). UASTC encodes them reliably.
  'emissiveTexture',
]);
const SRGB_SLOTS = new Set(['baseColorTexture', 'emissiveTexture']);

function parseArguments(argv) {
  const options = {
    project: process.env.ASTERON_PROJECT_ROOT ?? '',
    only: '',
    force: false,
    jobs: 0,
    ormCodec: 'uastc',
    dryRun: false,
    clean: false,
    verify: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--project': options.project = argv[++i] ?? ''; break;
      case '--only': options.only = argv[++i] ?? ''; break;
      case '--jobs': options.jobs = Number(argv[++i] ?? 0); break;
      case '--orm-codec': options.ormCodec = (argv[++i] ?? 'uastc').toLowerCase(); break;
      case '--force': options.force = true; break;
      case '--dry-run': options.dryRun = true; break;
      case '--clean': options.clean = true; break;
      case '--verify': options.verify = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
        options.project = arg;
    }
  }
  if (!options.project) {
    throw new Error('Pass --project <dir> or set ASTERON_PROJECT_ROOT.');
  }
  if (!['etc1s', 'uastc'].includes(options.ormCodec)) {
    throw new Error(`--orm-codec must be etc1s or uastc, got "${options.ormCodec}"`);
  }
  options.project = resolve(options.project);
  return options;
}

function requireKtxBinary() {
  const resolved = resolveKtxBinary();
  if (!resolved) {
    throw new Error(
      'KTX-Software not found. Install via AsteronEngine Tools → Packages…, '
        + `or put \`ktx\` on PATH / set ASTERON_KTX:\n  ${KTX_RELEASES_URL}`,
    );
  }
  const version = probeKtxVersion(resolved.path);
  if (!version) {
    throw new Error(
      `KTX binary at ${resolved.path} failed \`ktx --version\`. Reinstall via Tools → Packages….`,
    );
  }
  return { path: resolved.path, source: resolved.source, version };
}

function normalizeContentPackRelativePath(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed.includes('\0')) return '';
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/')) return '';
  const segments = trimmed.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return segments.join('/');
}

async function readProjectSettings(projectRoot) {
  try {
    const raw = await readFile(join(projectRoot, 'asteron.project.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function listModelFiles(root) {
  const found = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (MODEL_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(path);
      }
    }
  }
  await walk(root);
  return found;
}

/**
 * glTF slot data is authoritative; the filename pattern is only the fallback
 * for a texture no material references through a standard slot.
 */
function codecFor(texture, ormCodec) {
  const slots = listTextureSlots(texture);
  const name = texture.getName() ?? '';
  if (slots.includes('normalTexture') || /_normal/i.test(name)) {
    return { codec: 'uastc', oetf: 'linear', normal: true };
  }
  if (slots.includes('emissiveTexture') || /emissive/i.test(name)) {
    return { codec: 'uastc', oetf: 'srgb', normal: false };
  }
  if (slots.some((slot) => UASTC_SLOTS.has(slot))) {
    return { codec: ormCodec, oetf: 'linear', normal: false };
  }
  if (slots.some((slot) => SRGB_SLOTS.has(slot))) {
    return { codec: 'etc1s', oetf: 'srgb', normal: false };
  }
  return { codec: 'etc1s', oetf: 'srgb', normal: false };
}

function ktxArgsFor({ codec, oetf, normal }, inputPath, outputPath) {
  const args = ['create', '--generate-mipmap'];
  // sRGB color data must keep the SRGB vkFormat; linear data stays UNORM.
  if (oetf === 'srgb') {
    args.push('--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb');
  } else {
    args.push('--format', 'R8G8B8A8_UNORM', '--assign-tf', 'linear');
  }
  if (codec === 'uastc') {
    args.push('--encode', 'uastc', '--uastc-quality', '2', '--zstd', '18');
    if (normal) args.push('--normal-mode');
  } else {
    // --threads 1 avoids a KTX-Software 4.4.x BasisLZ SSE assert on some
    // atlases; still fall back to UASTC in encodeTexture if it aborts.
    args.push('--encode', 'basis-lz', '--clevel', '3', '--qlevel', '128', '--threads', '1');
  }
  args.push(inputPath, outputPath);
  return args;
}

function settingsSignature(options) {
  return [
    'ktx2-v2',
    'etc1s:basis-lz/c3/q128/t1',
    'uastc:q2/zstd18',
    'emissive:uastc',
    `orm:${options.ormCodec}`,
  ].join('|');
}

function ktxFailed(result) {
  return Boolean(result.error) || result.status !== 0 || Boolean(result.signal);
}

function formatKtxFailure(result) {
  return (result.stderr || result.stdout || result.error?.message || result.signal || '').trim();
}

/**
 * Encode one texture. ETC1S can SIGABRT inside BasisLZ SSE kernels on some
 * Synty emissive/atlas content — retry once as UASTC so one bad encode does
 * not leave the whole GLB underived.
 */
function encodeTexture(ktxPath, choice, inputPath, outputPath) {
  const primary = spawnSync(ktxPath, ktxArgsFor(choice, inputPath, outputPath), {
    encoding: 'utf8',
  });
  if (!ktxFailed(primary)) {
    return { codec: choice.codec, result: primary };
  }
  if (choice.codec === 'uastc') {
    return { codec: choice.codec, result: primary, failed: true };
  }
  const fallback = { ...choice, codec: 'uastc' };
  const secondary = spawnSync(ktxPath, ktxArgsFor(fallback, inputPath, outputPath), {
    encoding: 'utf8',
  });
  if (!ktxFailed(secondary)) {
    return { codec: 'uastc', result: secondary, fellBack: true };
  }
  return { codec: choice.codec, result: primary, failed: true };
}

async function readManifest(derivedRoot) {
  try {
    const raw = await readFile(join(derivedRoot, MANIFEST_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== MANIFEST_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeManifest(derivedRoot, manifest) {
  await mkdir(derivedRoot, { recursive: true });
  await writeFile(join(derivedRoot, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
}

function sha256(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

function isUpToDate(entry, sourcePath, outputPath, options) {
  if (options.force || !entry) return false;
  if (!existsSync(outputPath)) return false;
  const sourceStat = statSync(sourcePath);
  const outputStat = statSync(outputPath);
  if (entry.sourceSizeBytes !== sourceStat.size) return false;
  if (entry.outputSizeBytes !== outputStat.size) return false;
  if (options.verify) return entry.sourceSha256 === sha256(sourcePath);
  return entry.sourceMtimeMs === sourceStat.mtimeMs;
}

/**
 * `GLTFLoader` names a texture from `textures[].name || images[].name`, and a
 * KTX2 image is a bufferView so there is no URI fallback. If names are lost,
 * `canonicalTextureKey` returns null for every texture and the runtime dedup
 * stops entirely — turning a scene that dedups 7.1GB down to 1.2GB back into a
 * regression. Refuse to write a file that would do that.
 */
function assertTextureNames(document, label) {
  const unnamed = document
    .getRoot()
    .listTextures()
    .filter((texture) => !texture.getName());
  if (unnamed.length > 0) {
    throw new Error(
      `${label}: ${unnamed.length} texture(s) have no name — runtime dedup would break. Skipped.`,
    );
  }
}

async function transcodeDocument(io, sourcePath, outputPath, options, tempRoot, label, ktxPath) {
  const document = await io.read(sourcePath);
  assertTextureNames(document, label);

  const textures = document.getRoot().listTextures();
  const counts = { etc1s: 0, uastc: 0, skipped: 0 };

  for (const [index, texture] of textures.entries()) {
    const image = texture.getImage();
    if (!image) {
      counts.skipped += 1;
      continue;
    }
    if (texture.getMimeType() === 'image/ktx2') {
      counts.skipped += 1;
      continue;
    }
    const choice = codecFor(texture, options.ormCodec);
    const inputPath = join(tempRoot, `tex-${index}${extname(texture.getURI() || '') || '.png'}`);
    const ktx2Path = join(tempRoot, `tex-${index}.ktx2`);
    await writeFile(inputPath, Buffer.from(image));

    const encoded = encodeTexture(ktxPath, choice, inputPath, ktx2Path);
    if (encoded.failed) {
      throw new Error(
        `${label}: ktx failed for texture "${texture.getName()}"\n  ${ktxPath} ${
          ktxArgsFor(choice, inputPath, ktx2Path).join(' ')
        }\n  ${formatKtxFailure(encoded.result)}`,
      );
    }
    texture.setImage(new Uint8Array(await readFile(ktx2Path))).setMimeType('image/ktx2');
    counts[encoded.codec] += 1;
  }

  if (counts.etc1s + counts.uastc > 0) {
    document.createExtension(KHRTextureBasisu).setRequired(true);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await io.write(outputPath, document);

  // Round-trip check: names must have survived the write, not just the read.
  assertTextureNames(await io.read(outputPath), `${label} (written)`);
  return counts;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const derivedRoot = join(options.project, DERIVED_ROOT_RELATIVE);

  if (options.clean) {
    await rm(derivedRoot, { recursive: true, force: true });
    console.log(`[transcode] removed ${derivedRoot}`);
    return;
  }

  const ktx = requireKtxBinary();
  console.log(`[transcode] using ${ktx.version} (${ktx.source}: ${ktx.path})`);

  const settings = await readProjectSettings(options.project);
  const roots = [join(options.project, 'assets')];
  const packRelative = normalizeContentPackRelativePath(settings?.contentPacks?.syntySidekick);
  if (packRelative) roots.push(join(options.project, packRelative));

  const seen = new Set();
  const files = [];
  for (const root of roots) {
    for (const file of await listModelFiles(root)) {
      if (seen.has(file)) continue;
      seen.add(file);
      if (options.only && !file.includes(options.only)) continue;
      files.push(file);
    }
  }
  files.sort();
  console.log(`[transcode] ${files.length} model file(s) in scope`);

  const signature = settingsSignature(options);
  const previous = await readManifest(derivedRoot);
  const reuseEntries = previous && previous.settings === signature ? previous.entries : {};
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    settings: signature,
    entries: { ...reuseEntries },
  };

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  let encoded = 0;
  let skipped = 0;
  let failed = 0;
  let sourceBytes = 0;
  let outputBytes = 0;

  for (const sourcePath of files) {
    const relativePath = relative(options.project, sourcePath);
    const outputPath = join(derivedRoot, relativePath);
    const entry = reuseEntries[relativePath];

    if (isUpToDate(entry, sourcePath, outputPath, options)) {
      skipped += 1;
      sourceBytes += entry.sourceSizeBytes;
      outputBytes += entry.outputSizeBytes;
      continue;
    }

    const sourceStat = statSync(sourcePath);
    if (options.dryRun) {
      console.log(`[transcode] would encode ${relativePath} (${(sourceStat.size / 1e6).toFixed(1)}MB)`);
      encoded += 1;
      continue;
    }

    const tempRoot = await mkdtemp(join(tmpdir(), 'asteron-ktx2-'));
    try {
      const counts = await transcodeDocument(
        io,
        sourcePath,
        outputPath,
        options,
        tempRoot,
        relativePath,
        ktx.path,
      );
      const outputStat = statSync(outputPath);
      manifest.entries[relativePath] = {
        sourceSizeBytes: sourceStat.size,
        sourceMtimeMs: sourceStat.mtimeMs,
        sourceSha256: options.verify ? sha256(sourcePath) : undefined,
        outputSizeBytes: outputStat.size,
        textures: counts.etc1s + counts.uastc + counts.skipped,
        etc1s: counts.etc1s,
        uastc: counts.uastc,
      };
      sourceBytes += sourceStat.size;
      outputBytes += outputStat.size;
      encoded += 1;
      console.log(
        `[transcode] ${relativePath}: ${(sourceStat.size / 1e6).toFixed(1)}MB -> ${(outputStat.size / 1e6).toFixed(1)}MB (etc1s ${counts.etc1s}, uastc ${counts.uastc})`,
      );
    } catch (error) {
      // A failed file is simply left underived; the resolvers then serve the
      // source, so a bad encode costs savings rather than correctness.
      failed += 1;
      delete manifest.entries[relativePath];
      await rm(outputPath, { force: true });
      console.warn(`[transcode] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  if (!options.dryRun) await writeManifest(derivedRoot, manifest);
  console.log(
    `[transcode] ${encoded} encoded, ${skipped} skipped, ${failed} failed` +
      (outputBytes > 0
        ? ` — ${(sourceBytes / 1e9).toFixed(2)}GB -> ${(outputBytes / 1e9).toFixed(2)}GB on disk`
        : ''),
  );
}

main().catch((error) => {
  console.error(`[transcode] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
