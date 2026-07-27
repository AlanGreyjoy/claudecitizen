#!/usr/bin/env node
/**
 * Merge a folder of single-clip (or multi-clip) GLBs into one multi-clip pack.
 *
 * Usage:
 *   node scripts/pack_animation_glbs.mjs --in <dir> --out <file.glb>
 *   node scripts/pack_animation_glbs.mjs --project <projectRoot>
 *
 * With --project, packs the default stance folders when present:
 *   assets/animations/ProRifle/*.glb → …/ProRifle/locomotion.glb
 *   assets/animations/HandgunLocomotions/*.glb → …/HandgunLocomotions/locomotion.glb
 * Also accepts protected/ mirrors (pro-rifle, handgun-locomotions) as --in sources
 * when the public animations folders are empty; output still lands under assets/animations/.
 *
 * Single-clip inputs are renamed to the file stem (idle.glb → clip "idle") so
 * controller clipNames stay stable. Multi-clip inputs keep embedded names.
 * Output scene/skeleton comes from the first input; later clips must share bone names.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Node lacks FileReader; Three's GLTFExporter needs it for binary blobs. */
globalThis.FileReader = class FileReader {
  result = null;
  onload = null;
  onloadend = null;
  onerror = null;
  readAsArrayBuffer(blob) {
    Promise.resolve(blob.arrayBuffer())
      .then((buf) => {
        this.result = buf;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      })
      .catch((err) => {
        this.onerror?.(err);
      });
  }
  readAsDataURL() {
    throw new Error('FileReader.readAsDataURL is not supported in this packer.');
  }
};

const DEFAULT_PACKS = [
  {
    label: 'ProRifle',
    relativeIns: [
      'assets/animations/ProRifle',
      'assets/protected/animations/pro-rifle',
      'assets/protected/animations/ProRifle',
    ],
    relativeOut: 'assets/animations/ProRifle/locomotion.glb',
  },
  {
    label: 'HandgunLocomotions',
    relativeIns: [
      'assets/animations/HandgunLocomotions',
      'assets/protected/animations/handgun-locomotions',
      'assets/protected/animations/HandgunLocomotions',
    ],
    relativeOut: 'assets/animations/HandgunLocomotions/locomotion.glb',
  },
];

function usage() {
  console.log(`Usage:
  node scripts/pack_animation_glbs.mjs --in <dir> --out <file.glb>
  node scripts/pack_animation_glbs.mjs --project <projectRoot>

Options:
  --in <dir>         Directory of *.glb clip files (skips locomotion.glb)
  --out <file.glb>   Output multi-clip pack path
  --project <root>   Pack default ProRifle + Handgun folders under the project
  --help             Show this help
`);
}

function parseArgs(argv) {
  const args = { inDir: null, outFile: null, projectRoot: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--in') args.inDir = argv[++i] ?? null;
    else if (arg === '--out') args.outFile = argv[++i] ?? null;
    else if (arg === '--project') args.projectRoot = argv[++i] ?? null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function stemOf(filePath) {
  return basename(filePath, extname(filePath));
}

async function listInputGlbs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.glb$/i.test(entry.name))
    .map((entry) => join(dir, entry.name))
    .filter((filePath) => stemOf(filePath).toLowerCase() !== 'locomotion')
    .sort((a, b) => stemOf(a).localeCompare(stemOf(b)));
  if (files.length === 0) {
    throw new Error(`No .glb clip files found in ${dir}`);
  }
  return files;
}

async function loadGltf(loader, filePath) {
  const buf = await readFile(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolveGltf, reject) => {
    loader.parse(ab, pathToFileURL(dirname(filePath)).href + '/', resolveGltf, reject);
  });
}

/**
 * @param {string[]} inputFiles
 * @param {string} outFile
 */
async function packFiles(inputFiles, outFile) {
  const loader = new GLTFLoader();
  const exporter = new GLTFExporter();
  /** @type {import('three').Object3D | null} */
  let scene = null;
  /** @type {import('three').AnimationClip[]} */
  const clips = [];
  const seenNames = new Set();

  for (const filePath of inputFiles) {
    const gltf = await loadGltf(loader, filePath);
    if (!scene) {
      scene = gltf.scene;
    }
    const stem = stemOf(filePath);
    const sourceClips = gltf.animations ?? [];
    if (sourceClips.length === 0) {
      console.warn(`skip ${filePath}: no animations`);
      continue;
    }
    if (sourceClips.length === 1) {
      const clip = sourceClips[0].clone();
      clip.name = stem;
      if (seenNames.has(clip.name)) {
        throw new Error(`Duplicate clip name "${clip.name}" from ${filePath}`);
      }
      seenNames.add(clip.name);
      clips.push(clip);
      continue;
    }
    for (const source of sourceClips) {
      const clip = source.clone();
      if (!clip.name) clip.name = stem;
      if (seenNames.has(clip.name)) {
        throw new Error(`Duplicate clip name "${clip.name}" from ${filePath}`);
      }
      seenNames.add(clip.name);
      clips.push(clip);
    }
  }

  if (!scene) throw new Error('No scene loaded from inputs.');
  if (clips.length === 0) throw new Error('No animation clips collected.');

  const arrayBuffer = await exporter.parseAsync(scene, {
    animations: clips,
    binary: true,
  });
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter did not return a binary ArrayBuffer.');
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, Buffer.from(arrayBuffer));
  console.log(`Wrote ${outFile} (${clips.length} clips, ${arrayBuffer.byteLength} bytes)`);
  for (const clip of clips) {
    console.log(`  - ${clip.name} (${clip.duration.toFixed(3)}s, ${clip.tracks.length} tracks)`);
  }
  return clips.map((clip) => clip.name);
}

async function packDirectory(inDir, outFile) {
  const inputFiles = await listInputGlbs(inDir);
  console.log(`Packing ${inputFiles.length} GLB(s) from ${inDir}`);
  return packFiles(inputFiles, outFile);
}

async function findFirstExistingDir(projectRoot, relativeIns) {
  for (const relative of relativeIns) {
    const absolute = join(projectRoot, relative);
    try {
      const files = await listInputGlbs(absolute);
      return { absolute, files };
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function packProject(projectRoot) {
  const root = resolve(projectRoot);
  let packed = 0;
  for (const pack of DEFAULT_PACKS) {
    const found = await findFirstExistingDir(root, pack.relativeIns);
    if (!found) {
      console.warn(`Skip ${pack.label}: no clip GLBs under ${pack.relativeIns.join(' | ')}`);
      continue;
    }
    const outFile = join(root, pack.relativeOut);
    console.log(`\n=== ${pack.label} (${found.absolute}) → ${outFile} ===`);
    await packFiles(found.files, outFile);
    packed += 1;
  }
  if (packed === 0) {
    throw new Error(
      `No stance clip folders found under ${root}. Expected e.g. assets/animations/ProRifle/*.glb`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (args.projectRoot) {
    await packProject(args.projectRoot);
    return;
  }
  if (!args.inDir || !args.outFile) {
    usage();
    throw new Error('Provide --in and --out, or --project <root>.');
  }
  await packDirectory(resolve(args.inDir), resolve(args.outFile));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
