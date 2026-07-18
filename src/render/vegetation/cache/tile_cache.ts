import type { Planet, VegetationSettings } from '../../../types';
import {
  hashVegetationQualityBudgets,
  hashVegetationSettings,
  vegetationStorageKey,
} from '../../../cache/cache_keys';
import { getCachedTile, putCachedTile } from '../../../cache/tile_cache_store';
import {
  getGrassSampleCount,
  getTreeSampleCount,
} from '../domain/constants';
import type { StoredVegetationTile } from '../domain/storage';

export type { StoredVegetationInstance, StoredVegetationTile } from '../domain/storage';

export function vegetationSettingsHash(settings: VegetationSettings): string {
  return [
    hashVegetationSettings(settings),
    hashVegetationQualityBudgets(getGrassSampleCount(), getTreeSampleCount()),
  ].join('#');
}

export async function loadVegetationTile(
  planet: Planet,
  seed: number,
  settings: VegetationSettings,
  face: Parameters<typeof vegetationStorageKey>[3],
  level: number,
  x: number,
  y: number,
): Promise<StoredVegetationTile | null> {
  const key = vegetationStorageKey(
    planet,
    seed,
    vegetationSettingsHash(settings),
    face,
    level,
    x,
    y,
  );
  return getCachedTile<StoredVegetationTile>(key);
}

export function saveVegetationTile(
  planet: Planet,
  seed: number,
  settings: VegetationSettings,
  face: Parameters<typeof vegetationStorageKey>[3],
  level: number,
  x: number,
  y: number,
  tile: StoredVegetationTile,
): void {
  const key = vegetationStorageKey(
    planet,
    seed,
    vegetationSettingsHash(settings),
    face,
    level,
    x,
    y,
  );
  void putCachedTile(key, tile).catch(() => {});
}
