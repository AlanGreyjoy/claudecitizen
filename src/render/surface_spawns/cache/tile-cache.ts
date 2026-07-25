import type { CubeFace, Planet, PlanetSpawnCatalog } from '../../../types';
import {
  hashSurfaceSpawnCatalog,
  surfaceSpawnStorageKey,
} from '../../../cache/cache_keys';
import { getCachedTile, putCachedTile } from '../../../cache/tile_cache_store';
import {
  isValidStoredSurfaceSpawnTile,
  type StoredSurfaceSpawnTile,
} from '../domain/storage';

export type { StoredSurfaceSpawnTile } from '../domain/storage';

export async function loadSurfaceSpawnTile(
  planet: Planet,
  seed: number,
  catalog: PlanetSpawnCatalog,
  face: CubeFace,
  level: number,
  x: number,
  y: number,
): Promise<StoredSurfaceSpawnTile | null> {
  const key = surfaceSpawnStorageKey(
    planet,
    seed,
    hashSurfaceSpawnCatalog(catalog),
    face,
    level,
    x,
    y,
  );
  const stored = await getCachedTile<unknown>(key);
  if (!isValidStoredSurfaceSpawnTile(stored)) return null;
  return stored;
}

export function saveSurfaceSpawnTile(
  planet: Planet,
  seed: number,
  catalog: PlanetSpawnCatalog,
  face: CubeFace,
  level: number,
  x: number,
  y: number,
  tile: StoredSurfaceSpawnTile,
): void {
  const key = surfaceSpawnStorageKey(
    planet,
    seed,
    hashSurfaceSpawnCatalog(catalog),
    face,
    level,
    x,
    y,
  );
  void putCachedTile(key, tile).catch(() => {});
}
