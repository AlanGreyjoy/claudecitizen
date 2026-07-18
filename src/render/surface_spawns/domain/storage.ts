import type { SurfaceSpawnInstance } from '../../../types';

export const STORED_SURFACE_SPAWN_TILE_VERSION = 1 as const;

export interface StoredSurfaceSpawnTile {
  version: typeof STORED_SURFACE_SPAWN_TILE_VERSION;
  instances: SurfaceSpawnInstance[];
}

function isFiniteVec3(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === 'number' &&
    Number.isFinite(v.x) &&
    typeof v.y === 'number' &&
    Number.isFinite(v.y) &&
    typeof v.z === 'number' &&
    Number.isFinite(v.z)
  );
}

function isValidInstance(raw: unknown): raw is SurfaceSpawnInstance {
  if (!raw || typeof raw !== 'object') return false;
  const src = raw as Record<string, unknown>;
  return (
    typeof src.layerId === 'string' &&
    src.layerId.length > 0 &&
    isFiniteVec3(src.position) &&
    isFiniteVec3(src.normal) &&
    typeof src.yawRadians === 'number' &&
    Number.isFinite(src.yawRadians) &&
    typeof src.scale === 'number' &&
    Number.isFinite(src.scale)
  );
}

export function isValidStoredSurfaceSpawnTile(
  value: unknown,
): value is StoredSurfaceSpawnTile {
  if (!value || typeof value !== 'object') return false;
  const src = value as Record<string, unknown>;
  if (src.version !== STORED_SURFACE_SPAWN_TILE_VERSION) return false;
  if (!Array.isArray(src.instances)) return false;
  for (const instance of src.instances) {
    if (!isValidInstance(instance)) return false;
  }
  return true;
}
