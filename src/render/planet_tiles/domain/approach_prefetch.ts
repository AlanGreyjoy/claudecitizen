import type { Planet, Vec3 } from '../../../types';
import { add, distance, dot, length, normalize, scale } from '../../../math/vec3';
import { radialUp } from '../../../world/coordinates';
import { MIN_LEVEL } from './constants';

export interface ApproachPrefetchPlan {
  focuses: Vec3[];
  maxLevel: number;
  minLevel: number;
  radiusMeters: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rejectFromUp(velocity: Vec3, up: Vec3): Vec3 {
  return add(velocity, scale(up, -dot(velocity, up)));
}

function advanceOnSphere(direction: Vec3, tangent: Vec3, distanceRadians: number): Vec3 {
  if (distanceRadians <= 1e-9) return direction;
  const pureTangent = normalize(add(tangent, scale(direction, -dot(tangent, direction))));
  return normalize(
    add(
      scale(direction, Math.cos(distanceRadians)),
      scale(pureTangent, Math.sin(distanceRadians)),
    ),
  );
}

/**
 * Build prefetch foci along the ground track under a descending / cruising ship
 * so arbitrary landings warm tiles before L17 is forced near the surface.
 *
 * Near-surface selection already requests underfoot fine LODs. Prefetching
 * every level from MIN→MAX inside a large radius floods the terrain mesh
 * cache, thrashing pending worker jobs before they finish.
 */
export function planApproachPrefetch(
  planet: Planet,
  position: Vec3,
  velocity: Vec3,
  altitudeMeters: number,
): ApproachPrefetchPlan | null {
  // Below this, visitSelectedTiles already forces ground detail. Prefetching
  // L16/L17 here only competes with the tiles under the player.
  if (altitudeMeters < 1_500) return null;

  const up = radialUp(position);
  const surfaceFocus = scale(up, planet.radiusMeters);
  const horizontal = rejectFromUp(velocity, up);
  const groundSpeed = length(horizontal);
  const descentRate = Math.max(0, -dot(velocity, up));

  const timeToGround =
    descentRate > 8 ? altitudeMeters / descentRate : altitudeMeters > 8_000 ? 18 : 10;
  const lookAheadSeconds = clamp(timeToGround * 0.55, 2.5, 22);
  const aheadMeters = clamp(groundSpeed * lookAheadSeconds, 0, 80_000);

  const focuses: Vec3[] = [surfaceFocus];
  if (aheadMeters > 200 && groundSpeed > 5) {
    const tangent = normalize(horizontal);
    const steps = aheadMeters > 12_000 ? 3 : aheadMeters > 4_000 ? 2 : 1;
    for (let i = 1; i <= steps; i += 1) {
      const stepMeters = (aheadMeters * i) / steps;
      const dir = advanceOnSphere(up, tangent, stepMeters / planet.radiusMeters);
      focuses.push(scale(dir, planet.radiusMeters));
    }
  }

  // Cap fine LOD from high altitude — L17 from orbit is wasted work.
  // Prefetch only the top few levels; parents come from normal selection.
  let maxLevel: number;
  if (altitudeMeters > 80_000) maxLevel = 9;
  else if (altitudeMeters > 30_000) maxLevel = 11;
  else if (altitudeMeters > 12_000) maxLevel = 13;
  else if (altitudeMeters > 4_000) maxLevel = 15;
  else maxLevel = 16;

  const minLevel = Math.max(MIN_LEVEL, maxLevel - 2);
  const radiusMeters = clamp(
    300 + altitudeMeters * 0.05 + aheadMeters * 0.08,
    350,
    8_000,
  );

  // Drop duplicate foci that land in the same coarse cell.
  const unique: Vec3[] = [];
  for (const focus of focuses) {
    if (unique.every((existing) => distance(existing, focus) > radiusMeters * 0.35)) {
      unique.push(focus);
    }
  }

  return {
    focuses: unique,
    maxLevel,
    minLevel,
    radiusMeters,
  };
}
