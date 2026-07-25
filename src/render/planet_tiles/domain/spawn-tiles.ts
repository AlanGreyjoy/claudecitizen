import type { Planet, TileInfo, Vec3 } from '../../../types';
import { distance, normalize } from '../../../math/vec3';
import { faceUvFromDirection } from '../../../world/cube_sphere';
import { MAX_LEVEL, MIN_LEVEL } from './constants';
import { makeTileInfo } from './tile_info';
import { clamp } from './tile_key';

export interface CollectTilesNearOptions {
  maxLevel?: number;
  minLevel?: number;
  radiusMeters: number;
}

/**
 * Enumerate cube-face tiles near a world position for spawn prefetch / baking.
 * Only walks the face containing the position (spawn corridors are local).
 */
export function collectTilesNearPosition(
  planet: Planet,
  position: Vec3,
  options: CollectTilesNearOptions,
): TileInfo[] {
  const minLevel = options.minLevel ?? MIN_LEVEL;
  const maxLevel = options.maxLevel ?? MAX_LEVEL;
  const radiusMeters = Math.max(0, options.radiusMeters);
  const direction = normalize(position);
  const faceUv = faceUvFromDirection(direction);
  const results: TileInfo[] = [];
  const seen = new Set<string>();

  for (let level = minLevel; level <= maxLevel; level += 1) {
    const tileCount = 2 ** level;
    const centerX = clamp(
      Math.floor(((faceUv.u + 1) * 0.5) * tileCount),
      0,
      tileCount - 1,
    );
    const centerY = clamp(
      Math.floor(((faceUv.v + 1) * 0.5) * tileCount),
      0,
      tileCount - 1,
    );
    const probe = makeTileInfo(faceUv.face, level, centerX, centerY, planet);
    const tileSpan = Math.max(probe.spanMeters, 1);
    const tileRadius = Math.ceil(radiusMeters / tileSpan) + 1;

    for (let dy = -tileRadius; dy <= tileRadius; dy += 1) {
      for (let dx = -tileRadius; dx <= tileRadius; dx += 1) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < 0 || y < 0 || x >= tileCount || y >= tileCount) continue;
        const info = makeTileInfo(faceUv.face, level, x, y, planet);
        const key = `${info.face}:${info.level}:${info.x}:${info.y}`;
        if (seen.has(key)) continue;
        if (distance(info.centerPosition, position) > radiusMeters + info.spanMeters * 0.75) {
          continue;
        }
        seen.add(key);
        results.push(info);
      }
    }
  }

  return results;
}
