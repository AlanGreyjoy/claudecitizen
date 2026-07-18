import type { StoredTerrainTile } from './terrain_tile_cache';
import {
  TERRAIN_CACHE_VERSION,
  VEGETATION_CACHE_VERSION,
} from './cache_keys';
import { putCachedTile } from './tile_cache_store';

/** Binary spawn pack: small JSON manifest + sibling .bin of tile buffers. */
export interface SpawnPackTerrainRecord {
  colorsByteLength: number;
  colorsOffset: number;
  key: string;
  normalsByteLength: number;
  normalsOffset: number;
  positionsByteLength: number;
  positionsOffset: number;
}

export interface SpawnPackManifest {
  bin: string;
  format: 2;
  planetId: string;
  seed: number;
  terrain: SpawnPackTerrainRecord[];
  terrainCacheVersion: string;
  vegetationCacheVersion: string;
}

function decodeTerrainRecord(
  buffer: ArrayBuffer,
  record: SpawnPackTerrainRecord,
): StoredTerrainTile {
  return {
    positions: new Float32Array(
      buffer.slice(
        record.positionsOffset,
        record.positionsOffset + record.positionsByteLength,
      ),
    ),
    colors: new Uint8Array(
      buffer.slice(
        record.colorsOffset,
        record.colorsOffset + record.colorsByteLength,
      ),
    ),
    normals: new Int16Array(
      buffer.slice(
        record.normalsOffset,
        record.normalsOffset + record.normalsByteLength,
      ),
    ),
  };
}

export function spawnPackManifestUrl(planetId: string): string {
  return `/cache/spawn/${planetId}-${TERRAIN_CACHE_VERSION}.json`;
}

/**
 * Fetch the spawn-corridor pack and seed IndexedDB. Vegetation is not packed
 * (matrices explode pack size); boot warm still prefetches veg from disk/worker.
 */
export async function hydrateSpawnPackFromUrl(
  planetId: string,
): Promise<{ terrain: number; vegetation: number } | null> {
  const manifestUrl = spawnPackManifestUrl(planetId);
  let response: Response;
  try {
    // Avoid sticky stale packs after spawn-corridor rebakes (force-cache hid
    // the plains pack and left cold boots on empty IndexedDB + dead worker).
    response = await fetch(manifestUrl, { cache: 'no-cache' });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let manifest: SpawnPackManifest;
  try {
    manifest = (await response.json()) as SpawnPackManifest;
  } catch {
    console.warn('ClaudeCitizen spawn pack JSON parse failed:', manifestUrl);
    return null;
  }

  if (
    manifest.format !== 2 ||
    manifest.planetId !== planetId ||
    manifest.terrainCacheVersion !== TERRAIN_CACHE_VERSION
  ) {
    console.info(
      `ClaudeCitizen spawn pack skipped (version mismatch): ${manifestUrl}`,
    );
    return null;
  }

  // Keep veg version in the manifest so future packs can extend without clients
  // accepting stale formats blindly.
  void manifest.vegetationCacheVersion;
  void VEGETATION_CACHE_VERSION;

  const binUrl = `/cache/spawn/${manifest.bin}`;
  let binResponse: Response;
  try {
    binResponse = await fetch(binUrl, { cache: 'no-cache' });
  } catch {
    return null;
  }
  if (!binResponse.ok) return null;
  const buffer = await binResponse.arrayBuffer();

  let terrain = 0;
  for (const record of manifest.terrain ?? []) {
    await putCachedTile(record.key, decodeTerrainRecord(buffer, record));
    terrain += 1;
  }

  console.info(`ClaudeCitizen spawn pack hydrated: ${terrain} terrain tiles.`);
  return { terrain, vegetation: 0 };
}
