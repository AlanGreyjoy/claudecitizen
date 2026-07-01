import type { CubeFace, Planet, TileInfo } from '../../../types';
import { distance, scale } from '../../../math/vec3';
import { directionFromCubeFace } from '../../../world/cube_sphere';
import { MIN_LEVEL } from './constants';
import { tileBounds, tileKey } from './tile_key';

export function makeTileInfo(face: CubeFace, level: number, x: number, y: number, planet: Planet): TileInfo {
  const bounds = tileBounds(level, x, y);
  const centerDirection = directionFromCubeFace(
    face,
    (bounds.u0 + bounds.u1) * 0.5,
    (bounds.v0 + bounds.v1) * 0.5,
  );
  const cornerA = scale(directionFromCubeFace(face, bounds.u0, bounds.v0), planet.radiusMeters);
  const cornerB = scale(directionFromCubeFace(face, bounds.u1, bounds.v1), planet.radiusMeters);
  const centerPosition = scale(centerDirection, planet.radiusMeters);
  return {
    bounds,
    centerDirection,
    centerPosition,
    face,
    level,
    spanMeters: distance(cornerA, cornerB),
    x,
    y,
  };
}

export function parentTileInfo(info: TileInfo, planet: Planet): TileInfo | null {
  if (info.level <= MIN_LEVEL) return null;
  return makeTileInfo(
    info.face,
    info.level - 1,
    Math.floor(info.x / 2),
    Math.floor(info.y / 2),
    planet,
  );
}

export { tileKey };
