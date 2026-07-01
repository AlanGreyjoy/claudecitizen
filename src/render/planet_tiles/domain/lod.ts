import type { Planet, TileInfo, Vec3 } from '../../../types';
import { distance, dot } from '../../../math/vec3';
import {
  HORIZON_MARGIN_RADIANS,
  MAX_LEVEL,
  MIN_LEVEL,
  minProjectedError,
} from './constants';
import { clamp, clamp01 } from './tile_key';

// Force max terrain detail near the player so the visible mesh matches foot sampling.
const GROUND_MAX_LOD_ALTITUDE_METERS = 2_000;
const GROUND_DETAIL_RADIUS_METERS = 900;

export function targetErrorForAltitude(altitudeMeters: number): number {
  const groundFloor = altitudeMeters < 500 ? 0.18 : 0.24;
  const baseline = groundFloor + clamp01(altitudeMeters / 120_000) * 1.8;
  return Math.max(minProjectedError(), baseline);
}

export function shouldCullTile(
  info: TileInfo,
  planet: Planet,
  cameraUp: Vec3,
  altitudeMeters: number,
): boolean {
  const facing = dot(info.centerDirection, cameraUp);
  const phiH = Math.acos(
    planet.radiusMeters / Math.max(planet.radiusMeters + altitudeMeters, planet.radiusMeters + 1),
  );
  const phiCenter = Math.acos(clamp(facing, -1, 1));
  const phiHalf = info.spanMeters / (2 * planet.radiusMeters);
  const nearestAngle = Math.max(0, phiCenter - phiHalf);
  return nearestAngle > phiH + HORIZON_MARGIN_RADIANS && info.level > 0;
}

export function shouldSplitTile(
  info: TileInfo,
  bodyPosition: Vec3,
  cameraUp: Vec3,
  altitudeMeters: number,
): boolean {
  if (info.level < MIN_LEVEL) return true;
  if (info.level >= MAX_LEVEL) return false;

  const facing = dot(info.centerDirection, cameraUp);
  if (facing < -0.18) return false;

  const cameraDistance = distance(info.centerPosition, bodyPosition);
  if (
    info.level < MAX_LEVEL &&
    altitudeMeters < GROUND_MAX_LOD_ALTITUDE_METERS &&
    facing > 0.2 &&
    cameraDistance < GROUND_DETAIL_RADIUS_METERS + altitudeMeters * 0.35
  ) {
    return true;
  }

  const projectedError = info.spanMeters / Math.max(cameraDistance, 1);
  return projectedError > targetErrorForAltitude(altitudeMeters);
}
