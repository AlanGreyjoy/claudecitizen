import type { TileInfo, Vec3 } from '../../../types';
import { distance, dot, normalize } from '../../../math/vec3';
import {
  getVegetationTileDistanceMeters,
  VEGETATION_ALTITUDE_CUTOFF_METERS,
  VEGETATION_MIN_TILE_LEVEL,
  VEGETATION_TILE_DOT_THRESHOLD,
} from './constants';

export function shouldDecorateTile(
  tileInfo: TileInfo,
  bodyPosition: Vec3,
  altitudeMeters: number,
): boolean {
  if (altitudeMeters > VEGETATION_ALTITUDE_CUTOFF_METERS) return false;
  if (tileInfo.level < VEGETATION_MIN_TILE_LEVEL) return false;
  if (dot(tileInfo.centerDirection, normalize(bodyPosition)) < VEGETATION_TILE_DOT_THRESHOLD)
    return false;
  return distance(tileInfo.centerPosition, bodyPosition) < getVegetationTileDistanceMeters();
}

export function isVegetationVisibleAtAltitude(altitudeMeters: number): boolean {
  return altitudeMeters <= VEGETATION_ALTITUDE_CUTOFF_METERS;
}
