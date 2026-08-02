import type { CubeFace, Planet, PlanetSpawnCatalog } from '../../../types';
import {
  hashSurfaceSpawnCatalog,
  surfaceSpawnStorageKey,
} from '../../../cache/cache-keys';
import { getCachedTile, putCachedTile } from '../../../cache/tile-cache-store';
import {
  isValidStoredSurfaceSpawnTile,
  type StoredSurfaceSpawnTile,
} from '../domain/storage';

export type { StoredSurfaceSpawnTile } from '../domain/storage';

/**
 * The hash is ~18 toFixed() strings per catalog entry and both key builders run
 * on every streamed tile. Catalogs are replaced wholesale on edit, so identity
 * is a safe memo key.
 */
const hashByCatalog = new WeakMap<PlanetSpawnCatalog, string>();

function catalogHash(catalog: PlanetSpawnCatalog): string {
  const cached = hashByCatalog.get(catalog);
  if (cached !== undefined) return cached;
  const hash = hashSurfaceSpawnCatalog(catalog);
  hashByCatalog.set(catalog, hash);
  return hash;
}

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
    catalogHash(catalog),
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
    catalogHash(catalog),
    face,
    level,
    x,
    y,
  );
  void putCachedTile(key, tile).catch(() => {});
}
