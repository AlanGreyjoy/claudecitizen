import { statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * One rule, two consumers.
 *
 * `scripts/transcode_project_textures.mjs` writes KTX2-compressed twins of the
 * project's GLBs into `<project>/.asteron/derived/<same relative path>`. Both
 * the editor (which serves assets straight off disk) and the release build
 * (which copies referenced assets into the output) must prefer that twin when
 * it exists and is current — so the rule lives here and both import it.
 *
 * Importable from `editor-desktop/repository.mjs` (Electron main, ESM) and from
 * `vite.config.ts` (bundled by esbuild). Plain ESM, no dependencies.
 *
 * Deliberately project-root-relative rather than assets-relative, so the same
 * rule covers `/assets/**` and the `contentPacks.syntySidekick` virtual mount
 * without a second code path.
 */

export const DERIVED_ROOT_RELATIVE = join('.asteron', 'derived');

/** Memo keyed by source path; invalidated when the source mtime changes. */
const decisions = new Map();

function statOrNull(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Derived twin of a project file, or null when the path escapes the project or
 * already lives inside the derived tree.
 *
 * @param {string} projectRoot
 * @param {string} absoluteSourcePath
 * @returns {string | null}
 */
export function derivedPathFor(projectRoot, absoluteSourcePath) {
  if (!projectRoot) return null;
  const relativePath = relative(resolve(projectRoot), resolve(absoluteSourcePath));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  if (relativePath === '.asteron' || relativePath.startsWith(`.asteron${sep}`)) return null;
  return join(resolve(projectRoot), DERIVED_ROOT_RELATIVE, relativePath);
}

/**
 * The path that should actually be read or copied for a project asset. Prefers
 * the derived twin when it exists and is not older than the source. Never
 * throws — any doubt resolves to the original source path.
 *
 * @param {string} projectRoot
 * @param {string} absoluteSourcePath
 * @returns {string}
 */
export function resolvePreferredAssetPath(projectRoot, absoluteSourcePath) {
  const derived = derivedPathFor(projectRoot, absoluteSourcePath);
  if (!derived) return absoluteSourcePath;

  const sourceStat = statOrNull(absoluteSourcePath);
  const cached = decisions.get(absoluteSourcePath);
  if (cached && cached.sourceMtimeMs === (sourceStat?.mtimeMs ?? null)) return cached.chosen;

  const derivedStat = statOrNull(derived);
  let chosen = absoluteSourcePath;
  if (derivedStat) {
    // A missing source means the derived copy is all that is left; a derived
    // copy older than its source is stale and must lose.
    if (!sourceStat) chosen = derived;
    else if (derivedStat.mtimeMs >= sourceStat.mtimeMs) chosen = derived;
  }

  decisions.set(absoluteSourcePath, {
    chosen,
    sourceMtimeMs: sourceStat?.mtimeMs ?? null,
  });
  return chosen;
}

/** Drops the memo. Call after a transcode run inside a long-lived process. */
export function clearDerivedAssetCache() {
  decisions.clear();
}
