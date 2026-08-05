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
 * Over-authored sources are capped on the way through: `--max-texture-size` and
 * `--max-normal-size` halve a texture until it fits, which is the only lever
 * that helps when the source resolution — not the codec — is the problem.
 *
 * Requires KTX-Software's `ktx` binary (Tools → Packages…, ASTERON_KTX, or PATH).
 *
 * Usage:
 *   node scripts/transcode_project_textures.mjs --project <dir> [options]
 *
 *   --max-texture-size <n>   Cap every texture's longest edge at n (power of
 *                            two; 0 disables).
 *   --max-normal-size <n>    Tighter cap for normal maps. Falls back to
 *                            --max-texture-size when 0.
 *   --jobs <n>               Files encoded in parallel. 0 (the default) uses
 *                            cores - 2, capped at 16.
 *
 * Both caps default to `textures.maxTextureSize` / `textures.maxNormalSize` in
 * `asteron.project.json`, so the editor's Tools → Transcode Project Textures…
 * and a bare CLI run produce the same signature. A flag overrides the setting.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
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

function validateSizeCap(label, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, got "${value}"`);
  }
  if (value !== 0 && (value & (value - 1)) !== 0) {
    throw new Error(`${label} must be a power of two (or 0 to disable), got ${value}`);
  }
  return value;
}

function parseArguments(argv) {
  const options = {
    project: process.env.ASTERON_PROJECT_ROOT ?? '',
    only: '',
    force: false,
    jobs: 0,
    ormCodec: 'uastc',
    // Null, not 0: "no flag given" has to stay distinguishable from "flag given
    // as 0", or a project setting could never be turned off from the CLI.
    maxTextureSize: null,
    maxNormalSize: null,
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
      case '--max-texture-size':
        options.maxTextureSize = validateSizeCap('--max-texture-size', Number(argv[++i] ?? 0));
        break;
      case '--max-normal-size':
        options.maxNormalSize = validateSizeCap('--max-normal-size', Number(argv[++i] ?? 0));
        break;
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
  if (!Number.isInteger(options.jobs) || options.jobs < 0) {
    throw new Error(`--jobs must be a non-negative integer (0 = auto), got "${options.jobs}"`);
  }
  options.project = resolve(options.project);
  return options;
}

/**
 * Resolves the size caps from the project, with explicit flags winning.
 *
 * The caps belong to the project rather than to whoever typed the command,
 * because they are part of the manifest's settings signature: a run with a
 * different cap invalidates every twin and re-encodes the whole tree. The
 * editor's **Tools → Transcode Project Textures…** passes only `--project`
 * (`editor-desktop/main.mjs`), so a cap that lived only in a CLI invocation
 * would be silently undone the first time someone used the menu — hours of
 * re-encoding, back to full resolution, with nothing to indicate it happened.
 * Reading them from `asteron.project.json` makes both paths agree by
 * construction and lets the setting travel with the project.
 */
function resolveTextureCaps(options, settings) {
  const configured = settings?.textures ?? {};
  const pick = (flagValue, settingKey) => {
    if (flagValue !== null) return flagValue;
    const value = configured[settingKey];
    if (value === undefined || value === null) return 0;
    return validateSizeCap(`asteron.project.json textures.${settingKey}`, value);
  };
  return {
    maxNormalSize: pick(options.maxNormalSize, 'maxNormalSize'),
    maxTextureSize: pick(options.maxTextureSize, 'maxTextureSize'),
  };
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

/**
 * Target dimensions when a texture exceeds its cap, or null to keep it as-is.
 *
 * Compression alone does not fix an over-authored source: the Synty SciFi pack
 * ships `PolygonScifiWorlds_Texture_A_01_Normal_8k.png` at 8192², embedded in
 * 572 of this project's GLBs, and 510 of those carry no 4k twin to remap onto.
 * At 8192² it is 256 MB decoded and still ~85 MB as UASTC with mips — four
 * times any other texture in the pack, for a flat-shaded low-poly atlas whose
 * texel density never justified it.
 *
 * Halves rather than scaling to an arbitrary target: power-of-two atlases stay
 * power-of-two, the aspect ratio stays exact, and each step is the same
 * reduction the mip chain performs anyway.
 */
function resizeTargetFor(texture, choice, options) {
  const cap = choice.normal && options.maxNormalSize > 0
    ? options.maxNormalSize
    : options.maxTextureSize;
  if (!cap) return null;

  const size = texture.getSize();
  if (!size) return null;
  let [width, height] = size;
  if (!width || !height || Math.max(width, height) <= cap) return null;

  while (Math.max(width, height) > cap && width > 1 && height > 1) {
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
  return { width, height };
}

function ktxArgsFor({ codec, oetf, normal }, inputPath, outputPath, resize = null) {
  const args = ['create', '--generate-mipmap'];
  // `ktx create` resamples to these when they differ from the source, using the
  // same filter it uses for the mip chain.
  if (resize) {
    args.push('--width', String(resize.width), '--height', String(resize.height));
  }
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
    // Part of the signature so changing a cap re-encodes rather than serving
    // twins built at the old resolution.
    `max:${options.maxTextureSize}`,
    `maxnormal:${options.maxNormalSize}`,
  ].join('|');
}

/**
 * One `ktx` run, shaped like the `spawnSync` result the failure helpers read.
 *
 * Async rather than sync so the file pool can keep several encodes in flight.
 * `ktx` at these settings is effectively single-threaded — a serial run of one
 * 3-texture GLB measured 1m29s wall against 1m49s user, so ~1.2 cores — which
 * is why the parallelism has to live here rather than inside the encoder.
 */
function runKtx(ktxPath, args) {
  return new Promise((resolvePromise) => {
    execFile(
      ktxPath,
      args,
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolvePromise({ status: 0, signal: null, stdout, stderr });
          return;
        }
        // A non-zero exit reports a numeric `code`; a spawn failure (ENOENT,
        // EACCES) reports a string errno and has to surface as `error` instead,
        // and an abort reports only `signal`.
        const status = typeof error.code === 'number' ? error.code : null;
        resolvePromise({
          error: status === null && !error.signal ? error : undefined,
          signal: error.signal ?? null,
          status: status ?? 1,
          stdout,
          stderr,
        });
      },
    );
  });
}

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * Workers pull from a shared cursor rather than taking a fixed slice, so one
 * slow 8k atlas cannot leave the other lanes idle at the end of the run.
 */
async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    }),
  );
}

/** Reserve the main thread and a core of headroom; cap so a big box stays sane. */
function resolveJobCount(requested) {
  if (requested > 0) return requested;
  const cores = cpus()?.length || 4;
  return Math.max(1, Math.min(16, cores - 2));
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
async function encodeTexture(ktxPath, choice, inputPath, outputPath, resize = null) {
  const primary = await runKtx(ktxPath, ktxArgsFor(choice, inputPath, outputPath, resize));
  if (!ktxFailed(primary)) {
    return { codec: choice.codec, result: primary };
  }
  if (choice.codec === 'uastc') {
    return { codec: choice.codec, result: primary, failed: true };
  }
  const fallback = { ...choice, codec: 'uastc' };
  const secondary = await runKtx(
    ktxPath,
    ktxArgsFor(fallback, inputPath, outputPath, resize),
  );
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
  // Buffered, not printed as they happen: with a file pool in flight, a resize
  // note printed mid-encode lands under an unrelated file's summary line.
  const counts = { etc1s: 0, uastc: 0, skipped: 0, notes: [] };

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
    const resize = resizeTargetFor(texture, choice, options);
    const inputPath = join(tempRoot, `tex-${index}${extname(texture.getURI() || '') || '.png'}`);
    const ktx2Path = join(tempRoot, `tex-${index}.ktx2`);
    await writeFile(inputPath, Buffer.from(image));

    if (resize) {
      const [sourceWidth, sourceHeight] = texture.getSize() ?? [0, 0];
      counts.notes.push(
        `  resize "${texture.getName()}" `
          + `${sourceWidth}x${sourceHeight} -> ${resize.width}x${resize.height}`,
      );
    }

    const encoded = await encodeTexture(ktxPath, choice, inputPath, ktx2Path, resize);
    if (encoded.failed) {
      throw new Error(
        `${label}: ktx failed for texture "${texture.getName()}"\n  ${ktxPath} ${
          ktxArgsFor(choice, inputPath, ktx2Path, resize).join(' ')
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
  Object.assign(options, resolveTextureCaps(options, settings));
  if (options.maxTextureSize || options.maxNormalSize) {
    const source = settings?.textures ? 'asteron.project.json / flags' : 'flags';
    console.log(
      `[transcode] size caps (${source}): `
        + `texture ${options.maxTextureSize || 'off'}, normal ${options.maxNormalSize || 'off'}`,
    );
  }

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

  const jobs = resolveJobCount(options.jobs);
  const totals = { encoded: 0, skipped: 0, failed: 0, sourceBytes: 0, outputBytes: 0 };
  let completed = 0;

  async function processModelFile(sourcePath) {
    const relativePath = relative(options.project, sourcePath);
    const outputPath = join(derivedRoot, relativePath);
    const entry = reuseEntries[relativePath];

    if (isUpToDate(entry, sourcePath, outputPath, options)) {
      totals.skipped += 1;
      totals.sourceBytes += entry.sourceSizeBytes;
      totals.outputBytes += entry.outputSizeBytes;
      return;
    }

    const sourceStat = statSync(sourcePath);
    if (options.dryRun) {
      console.log(`[transcode] would encode ${relativePath} (${(sourceStat.size / 1e6).toFixed(1)}MB)`);
      totals.encoded += 1;
      return;
    }

    // Its own temp dir per file: lanes write `tex-<index>.ktx2` under the same
    // names, so a shared root would have them clobbering each other's payloads.
    const tempRoot = await mkdtemp(join(tmpdir(), 'asteron-ktx2-'));
    try {
      // One NodeIO per file. The pool has several documents open at once, and a
      // shared reader is not worth reasoning about across concurrent reads.
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
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
      totals.sourceBytes += sourceStat.size;
      totals.outputBytes += outputStat.size;
      totals.encoded += 1;
      completed += 1;
      // Summary and its notes emitted together, so a lane's output stays whole.
      console.log(
        `[transcode] (${completed}/${files.length}) ${relativePath}: `
          + `${(sourceStat.size / 1e6).toFixed(1)}MB -> ${(outputStat.size / 1e6).toFixed(1)}MB `
          + `(etc1s ${counts.etc1s}, uastc ${counts.uastc})`
          + counts.notes.map((note) => `\n[transcode] ${note}`).join(''),
      );
    } catch (error) {
      // A failed file is simply left underived; the resolvers then serve the
      // source, so a bad encode costs savings rather than correctness.
      totals.failed += 1;
      completed += 1;
      delete manifest.entries[relativePath];
      await rm(outputPath, { force: true });
      console.warn(`[transcode] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  if (!options.dryRun) console.log(`[transcode] ${jobs} parallel job(s)`);
  await runWithConcurrency(files, jobs, processModelFile);

  const { encoded, skipped, failed, sourceBytes, outputBytes } = totals;

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
