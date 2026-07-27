/**
 * Builds a shippable web release for an external AsteronEngine project.
 *
 * `npm run build:web` alone cannot do this. The engine owns `index.html`,
 * `vite.config.ts`, and every `import.meta.glob` that pulls scenes, planets,
 * systems, and prefabs into the bundle — and those globs resolve against the
 * engine checkout, not the open project. A project supplies only `assets/` and
 * a handful of `src/**` documents, so building from the project root finds no
 * Vite config and building from the engine root finds no project content.
 *
 * The fix is a staging tree: hardlink the engine checkout into
 * `.asteron-build/stage`, overlay the project's `src/**` documents on top,
 * hardlink the project's `assets/` in beside them, and run Vite there. Hardlinks
 * make the copy near-instant and cost no extra disk; the overlay always removes
 * the engine file before writing so a shared inode is never edited in place.
 *
 * Usage:
 *   node scripts/build_project_web.mjs --project /path/to/project [options]
 *
 *   --project <dir>   Project root (default: $ASTERON_PROJECT_ROOT).
 *   --skip-wasm       Reuse the existing public/wasm/cc_sim_core.wasm.
 *   --skip-typecheck  Skip `tsc --noEmit` on the engine.
 *   --keep-stage      Leave .asteron-build/stage in place for inspection.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Engine files the staged tree needs in order to be a valid Vite root. */
const ENGINE_ROOT_FILES = ['index.html', 'editor.html', 'vite.config.ts', 'tsconfig.json', 'package.json'];
/** Engine directories hardlinked wholesale into the stage. */
const ENGINE_TREES = ['src', 'public'];

function parseArguments(argv) {
  const options = {
    projectRoot: process.env.ASTERON_PROJECT_ROOT ?? '',
    skipWasm: false,
    skipTypecheck: false,
    keepStage: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--project') options.projectRoot = argv[++index] ?? '';
    else if (argument === '--skip-wasm') options.skipWasm = true;
    else if (argument === '--skip-typecheck') options.skipTypecheck = true;
    else if (argument === '--keep-stage') options.keepStage = true;
    else if (!argument.startsWith('--') && !options.projectRoot) options.projectRoot = argument;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.projectRoot) {
    throw new Error('No project root. Pass --project <dir> or set ASTERON_PROJECT_ROOT.');
  }
  options.projectRoot = resolve(options.projectRoot);
  return options;
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', rejectRun);
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function readProjectSettings(projectRoot) {
  const path = join(projectRoot, 'asteron.project.json');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
  const outDir = parsed?.build?.outDir;
  if (typeof outDir !== 'string' || !outDir.trim()) {
    throw new Error(`${path} is missing build.outDir.`);
  }
  return {
    name: typeof parsed.name === 'string' ? parsed.name : 'Asteron',
    backendUrl: typeof parsed.backendUrl === 'string' ? parsed.backendUrl : '',
    defaultScene: typeof parsed.defaultScene === 'string' ? parsed.defaultScene : 'title',
    outDir: resolve(projectRoot, outDir),
  };
}

/** Hardlink copy. Falls back to a real copy when the two trees differ by device. */
async function linkTree(source, destination) {
  try {
    await cp(source, destination, { recursive: true, force: true, preserveTimestamps: true });
  } catch (error) {
    throw new Error(`Could not stage ${source}: ${error.message}`);
  }
}

async function hardlinkTree(source, destination) {
  try {
    await run('cp', ['-al', source, destination], engineRoot);
  } catch {
    // Different filesystem, or a cp without -l. A byte copy is slower but correct.
    await linkTree(source, destination);
  }
}

async function listFilesRecursive(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const directory = queue.shift();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) queue.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files;
}

/**
 * Copies the project's `src/**` documents over the staged engine ones. Paths
 * mirror the engine layout exactly, so a project scene replaces the engine
 * scene of the same id while engine-only documents (login, character-creation,
 * loading) survive — the shipped game needs both sets.
 */
async function overlayProjectSource(projectRoot, stageDir) {
  const projectSrc = join(projectRoot, 'src');
  if (!existsSync(projectSrc)) return [];

  const overlaid = [];
  for (const sourcePath of await listFilesRecursive(projectSrc)) {
    const relativePath = relative(projectSrc, sourcePath);
    if (relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) continue;
    const destination = join(stageDir, 'src', relativePath);
    await mkdir(dirname(destination), { recursive: true });
    // The staged file may be a hardlink to the engine's copy. Unlink first so
    // the write lands on a fresh inode instead of editing the engine checkout.
    await rm(destination, { force: true });
    await cp(sourcePath, destination);
    overlaid.push(join('src', relativePath));
  }
  return overlaid;
}

async function stageEngine(stageDir) {
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  for (const tree of ENGINE_TREES) {
    const source = join(engineRoot, tree);
    if (!existsSync(source)) continue;
    await hardlinkTree(source, join(stageDir, tree));
  }
  for (const file of ENGINE_ROOT_FILES) {
    const source = join(engineRoot, file);
    if (!existsSync(source)) continue;
    await cp(source, join(stageDir, file));
  }
  // Symlinked rather than copied: Vite must resolve the same dependency graph
  // the engine installed, and a 1GB copy per build is not worth it.
  await symlink(join(engineRoot, 'node_modules'), join(stageDir, 'node_modules'), 'dir');
}

/**
 * Netlify reads these from the publish directory itself, so they survive a
 * `netlify deploy --dir` upload with no repo-level config.
 */
const NETLIFY_HEADERS = `# Emitted by scripts/build_project_web.mjs — do not edit by hand.

# Deployment config: must never be served stale after a re-stamp.
/asteron.runtime.json
  Cache-Control: no-store

# Vite content-hashes these filenames, so they are safe to pin forever.
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# Entry document: always revalidate so a new build is picked up immediately.
/index.html
  Cache-Control: no-cache

/
  Cache-Control: no-cache
`;

async function writeReleaseMetadata(settings) {
  await writeFile(
    join(settings.outDir, 'asteron.runtime.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        project: settings.name,
        backendUrl: settings.backendUrl,
        bootScene: settings.defaultScene,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(join(settings.outDir, '_headers'), NETLIFY_HEADERS, 'utf8');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const settings = await readProjectSettings(options.projectRoot);
  const stageDir = join(engineRoot, '.asteron-build', 'stage');

  console.log(`[build-web] project  ${options.projectRoot}`);
  console.log(`[build-web] engine   ${engineRoot}`);
  console.log(`[build-web] outDir   ${settings.outDir}`);

  if (!options.skipWasm) {
    await run('node', [join(engineRoot, 'scripts/build_wasm.mjs')], engineRoot);
  } else if (!existsSync(join(engineRoot, 'public/wasm/cc_sim_core.wasm'))) {
    throw new Error('--skip-wasm was passed but public/wasm/cc_sim_core.wasm does not exist.');
  }

  if (!options.skipTypecheck) {
    await run('npx', ['tsc', '--noEmit'], engineRoot);
  }

  console.log('[build-web] staging engine + project…');
  await stageEngine(stageDir);
  const overlaid = await overlayProjectSource(options.projectRoot, stageDir);
  for (const path of overlaid) console.log(`[build-web]   overlay ${path}`);

  const projectAssets = join(options.projectRoot, 'assets');
  if (existsSync(projectAssets)) {
    await hardlinkTree(projectAssets, join(stageDir, 'assets'));
  } else {
    console.warn('[build-web] project has no assets/ — prefabs and models will be missing.');
  }
  // The asset-copy plugin reads contentPacks.syntySidekick from this file.
  await cp(join(options.projectRoot, 'asteron.project.json'), join(stageDir, 'asteron.project.json'));

  console.log('[build-web] running vite build…');
  await run('npx', ['vite', 'build', '--outDir', settings.outDir, '--emptyOutDir'], stageDir);

  await writeReleaseMetadata(settings);
  if (!options.keepStage) await rm(stageDir, { recursive: true, force: true });

  console.log(`[build-web] done → ${settings.outDir}`);
  if (!settings.backendUrl.startsWith('https://')) {
    console.warn(
      `[build-web] WARNING backendUrl is "${settings.backendUrl}". An HTTPS site cannot call it — ` +
        'set an https:// URL in Project Settings before deploying.',
    );
  }
}

await main();
