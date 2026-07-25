import { access, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { EditorRepositoryError, isInsidePath } from './repository.mjs';

/** Stable runtime URL for the configured Sidekick pack (editor + Build Web). */
export const SIDEKICK_VIRTUAL_URL_PREFIX = '/asteron/content/synty-sidekick/';

const MANIFEST_NAME = 'manifest.json';
const BASE_MODEL_RELATIVE = 'base/SK_BaseModel.glb';
const MATERIAL_CONFIG_RELATIVE = 'materials/base-material.json';

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Normalize a project-relative content-pack folder path.
 * Returns '' when unset. Throws EditorRepositoryError when invalid.
 */
export function normalizeProjectRelativePackPath(value, label = 'contentPacks.syntySidekick') {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new EditorRepositoryError(`${label} must be a string`);
  }
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  if (trimmed.includes('\0')) {
    throw new EditorRepositoryError(`invalid ${label}`);
  }
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/')) {
    throw new EditorRepositoryError(`${label} must be project-relative (not absolute)`);
  }
  const segments = trimmed.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new EditorRepositoryError(`invalid ${label}`);
  }
  return segments.join('/');
}

/** Resolve a configured relative pack path under the project root. */
export function resolveConfiguredPackPath(projectRoot, relativePath) {
  const normalized = normalizeProjectRelativePackPath(relativePath);
  if (!normalized) return null;
  const absolute = resolve(projectRoot, normalized);
  if (!isInsidePath(absolute, resolve(projectRoot))) {
    throw new EditorRepositoryError('Sidekick pack path escapes the project root', 403);
  }
  return { relativePath: normalized, absolutePath: absolute };
}

/**
 * Validate a Sidekick pack directory (Unity export output or project folder).
 * @param {string} packDir Absolute path to the pack root.
 * @param {string} [relativePath] Project-relative path for status display.
 */
export async function validateSidekickPack(packDir, relativePath = '') {
  const absolute = resolve(packDir);
  const errors = [];
  const warnings = [];
  let speciesCount = 0;
  let partsCount = 0;
  let partsWithMesh = 0;
  let missingMeshFiles = 0;
  let hasManifest = false;
  let hasBaseModel = false;
  let hasMaterialConfig = false;
  let exportReportPresent = false;
  const displayPath = relativePath || absolute;

  if (!(await isDirectory(absolute))) {
    return {
      ok: false,
      present: false,
      configured: Boolean(relativePath),
      path: absolute,
      relativePath: relativePath || '',
      errors: relativePath
        ? [`Configured pack folder not found: ${displayPath}`]
        : ['Sidekick pack not configured. Use Tools → Locate Synty Sidekick Pack…'],
      warnings,
      speciesCount,
      partsCount,
      partsWithMesh,
      missingMeshFiles,
      hasManifest,
      hasBaseModel,
      hasMaterialConfig,
      exportReportPresent,
    };
  }

  const present = true;
  const manifestPath = join(absolute, MANIFEST_NAME);
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    hasManifest = true;
  } catch {
    errors.push(`Missing or invalid ${MANIFEST_NAME}.`);
  }

  if (manifest && typeof manifest === 'object') {
    if (!Array.isArray(manifest.species) || manifest.species.length === 0) {
      errors.push('manifest.json has no species[].');
    } else {
      speciesCount = manifest.species.length;
    }
    if (!Array.isArray(manifest.parts) || manifest.parts.length === 0) {
      errors.push('manifest.json has no parts[].');
    } else {
      partsCount = manifest.parts.length;
      for (const part of manifest.parts) {
        if (!part || typeof part !== 'object') continue;
        const meshUrl = typeof part.meshUrl === 'string' ? part.meshUrl : null;
        const fileExists = part.fileExists === true;
        if (fileExists && meshUrl) {
          partsWithMesh += 1;
          const meshPath = resolve(absolute, meshUrl);
          if (!isInsidePath(meshPath, absolute)) {
            missingMeshFiles += 1;
            warnings.push(`Part mesh escapes pack root: ${meshUrl}`);
            continue;
          }
          if (!(await pathExists(meshPath))) {
            missingMeshFiles += 1;
          }
        }
      }
    }

    const assets = manifest.assets && typeof manifest.assets === 'object' ? manifest.assets : {};
    const baseRel =
      typeof assets.baseModelUrl === 'string' && assets.baseModelUrl.trim()
        ? assets.baseModelUrl.trim()
        : BASE_MODEL_RELATIVE;
    const materialRel =
      typeof assets.materialConfigUrl === 'string' && assets.materialConfigUrl.trim()
        ? assets.materialConfigUrl.trim()
        : MATERIAL_CONFIG_RELATIVE;

    hasBaseModel = await pathExists(join(absolute, baseRel));
    if (!hasBaseModel) errors.push(`Missing base model: ${baseRel}`);

    hasMaterialConfig = await pathExists(join(absolute, materialRel));
    if (!hasMaterialConfig) warnings.push(`Missing material config: ${materialRel}`);
  } else {
    hasBaseModel = await pathExists(join(absolute, BASE_MODEL_RELATIVE));
    if (!hasBaseModel) errors.push(`Missing base model: ${BASE_MODEL_RELATIVE}`);
    hasMaterialConfig = await pathExists(join(absolute, MATERIAL_CONFIG_RELATIVE));
  }

  exportReportPresent = await pathExists(join(absolute, 'export-report.txt'));
  if (missingMeshFiles > 0) {
    warnings.push(`${missingMeshFiles} part mesh file(s) listed in the manifest are missing on disk.`);
  }

  return {
    ok: errors.length === 0,
    present,
    configured: Boolean(relativePath),
    path: absolute,
    relativePath: relativePath || '',
    errors,
    warnings,
    speciesCount,
    partsCount,
    partsWithMesh,
    missingMeshFiles,
    hasManifest,
    hasBaseModel,
    hasMaterialConfig,
    exportReportPresent,
  };
}

/**
 * Read the configured Sidekick path from project settings and validate it.
 * @param {string} projectRoot
 * @param {string} [relativePath] Override; when omitted reads asteron.project.json via caller.
 */
export async function getSidekickPackStatus(projectRoot, relativePath = '') {
  const normalized = normalizeProjectRelativePackPath(relativePath);
  if (!normalized) {
    return validateSidekickPack(resolve(projectRoot, '__unconfigured_sidekick__'), '');
  }
  const resolvedPack = resolveConfiguredPackPath(projectRoot, normalized);
  return validateSidekickPack(resolvedPack.absolutePath, resolvedPack.relativePath);
}

/**
 * Map a virtual Sidekick URL to an absolute file under the configured pack.
 * Returns null when the URL is not a Sidekick virtual path.
 */
export function resolveSidekickVirtualAsset(projectRoot, relativePackPath, pathname) {
  if (!pathname.startsWith(SIDEKICK_VIRTUAL_URL_PREFIX)) return null;
  const pack = resolveConfiguredPackPath(projectRoot, relativePackPath);
  if (!pack) {
    throw new EditorRepositoryError(
      'Sidekick pack not configured. Use Tools → Locate Synty Sidekick Pack…',
      404,
    );
  }
  const suffix = decodeURIComponent(pathname.slice(SIDEKICK_VIRTUAL_URL_PREFIX.length));
  if (!suffix || suffix.includes('\0') || suffix.split('/').includes('..')) {
    throw new EditorRepositoryError('invalid Sidekick asset path', 403);
  }
  const absolute = resolve(pack.absolutePath, suffix);
  if (!isInsidePath(absolute, pack.absolutePath)) {
    throw new EditorRepositoryError('Sidekick asset path escapes pack root', 403);
  }
  return absolute;
}

/** Convert an absolute folder under projectRoot to a project-relative path. */
export function toProjectRelativePackPath(projectRoot, absoluteDir) {
  const root = resolve(projectRoot);
  const absolute = resolve(absoluteDir);
  if (!isInsidePath(absolute, root)) {
    throw new EditorRepositoryError(
      'Sidekick pack must live inside the open AsteronEngine project.',
      400,
    );
  }
  const relativePath = relative(root, absolute).split(sep).join('/');
  return normalizeProjectRelativePackPath(relativePath);
}

export function formatSidekickPackSummary(status) {
  if (!status.configured) {
    return 'Sidekick pack not configured. Use Tools → Locate Synty Sidekick Pack… or Project Settings.';
  }
  if (!status.present) {
    return `Sidekick pack missing at ${status.relativePath}.`;
  }
  const lines = [
    status.ok ? 'Sidekick pack OK.' : 'Sidekick pack invalid.',
    `Path: ${status.relativePath}`,
    `Species: ${status.speciesCount} · Parts: ${status.partsCount} (${status.partsWithMesh} with meshes)`,
  ];
  if (status.errors.length) lines.push(`Errors: ${status.errors.join(' ')}`);
  if (status.warnings.length) lines.push(`Warnings: ${status.warnings.join(' ')}`);
  return lines.join('\n');
}
