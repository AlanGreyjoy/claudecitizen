import { length, normalize, scale } from '../math/vec3';
import { getFootSurfaceSampleLevel } from './foot_surface_level';
import { sampleSurfaceClimate } from './climate';
import { sampleSurfaceHeightDetails } from './elevation';
import {
  sampleRenderableSurfaceHeight,
  sampleVisibleSurfaceFrame,
} from './renderable_surface';
import type { SurfaceHeightSampleOptions } from './elevation';
import type { Planet, PlanetSurfaceSample, Vec3 } from '../types';

export { sampleSurfaceHeight } from './elevation';
export {
  getRenderableSurfaceCacheStats,
  RENDER_SURFACE_LEVEL,
  RENDER_SURFACE_SEGMENTS,
  sampleRenderableSurfaceHeight,
} from './renderable_surface';

interface SurfaceAtDirectionResult {
  point: Vec3;
  surface: PlanetSurfaceSample;
}

export interface TerrainSegmentHit {
  distance: number;
  normal: Vec3;
  point: Vec3;
}

export interface TerrainPathSegment {
  end: Vec3;
  length: number;
  start: Vec3;
}

function visibleSurfaceClearance(
  planet: Planet,
  seed: number,
  position: Vec3,
  level: number,
): number {
  const heightMeters = sampleRenderableSurfaceHeight(planet, seed, position, level);
  return length(position) - (planet.radiusMeters + heightMeters);
}

function terrainHitAt(
  planet: Planet,
  seed: number,
  point: Vec3,
  distance: number,
  level: number,
): TerrainSegmentHit {
  const frame = sampleVisibleSurfaceFrame(planet, seed, point, level);
  return {
    distance,
    normal: frame.normal,
    point: frame.point,
  };
}

function setMidpoint(target: Vec3, start: Vec3, end: Vec3): void {
  target.x = (start.x + end.x) * 0.5;
  target.y = (start.y + end.y) * 0.5;
  target.z = (start.z + end.z) * 0.5;
}

function copyPoint(target: Vec3, source: Vec3): void {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
}

/** Find the first visible-terrain crossing along a contiguous ballistic path. */
export function castTerrainPath(
  planet: Planet,
  seed: number,
  segments: readonly TerrainPathSegment[],
): TerrainSegmentHit | null {
  const first = segments[0];
  if (!first) return null;
  const level = getFootSurfaceSampleLevel();
  let pathDistance = 0;
  const midpoint = { x: 0, y: 0, z: 0 };
  const above = { x: 0, y: 0, z: 0 };
  const below = { x: 0, y: 0, z: 0 };
  const candidate = { x: 0, y: 0, z: 0 };
  const startClearance = visibleSurfaceClearance(planet, seed, first.start, level);
  if (startClearance <= 0) return terrainHitAt(planet, seed, first.start, 0, level);

  for (const segment of segments) {
    if (segment.length <= 0) continue;
    setMidpoint(midpoint, segment.start, segment.end);
    const midpointClearance = visibleSurfaceClearance(planet, seed, midpoint, level);
    const endClearance = visibleSurfaceClearance(planet, seed, segment.end, level);

    if (midpointClearance <= 0) {
      copyPoint(above, segment.start);
      copyPoint(below, midpoint);
    } else if (endClearance <= 0) {
      copyPoint(above, midpoint);
      copyPoint(below, segment.end);
    } else {
      pathDistance += segment.length;
      continue;
    }

    for (let iteration = 0; iteration < 8; iteration += 1) {
      setMidpoint(candidate, above, below);
      if (visibleSurfaceClearance(planet, seed, candidate, level) > 0) {
        copyPoint(above, candidate);
      } else {
        copyPoint(below, candidate);
      }
    }
    return terrainHitAt(
      planet,
      seed,
      below,
      pathDistance + length({
        x: below.x - segment.start.x,
        y: below.y - segment.start.y,
        z: below.z - segment.start.z,
      }),
      level,
    );
  }
  return null;
}

/** Find the first visible-terrain crossing on a short world-space ray segment. */
export function castTerrainSegment(
  planet: Planet,
  seed: number,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
): TerrainSegmentHit | null {
  if (maxDistance <= 0) return null;
  const rayDirection = normalize(direction);
  const end = {
    x: origin.x + rayDirection.x * maxDistance,
    y: origin.y + rayDirection.y * maxDistance,
    z: origin.z + rayDirection.z * maxDistance,
  };
  return castTerrainPath(planet, seed, [
    {
      end,
      length: maxDistance,
      start: origin,
    },
  ]);
}

export function sampleAnalyticPlanetSurface(
  planet: Planet,
  seed: number,
  position: Vec3,
  options?: SurfaceHeightSampleOptions,
): PlanetSurfaceSample {
  const heightDetails = sampleSurfaceHeightDetails(planet, seed, position, options);
  return sampleSurfaceClimate(
    planet,
    seed,
    position,
    heightDetails.heightMeters,
    heightDetails,
  );
}

export function sampleFootPlanetSurface(
  planet: Planet,
  seed: number,
  position: Vec3,
): PlanetSurfaceSample {
  const level = getFootSurfaceSampleLevel();
  const frame = sampleVisibleSurfaceFrame(planet, seed, position, level);
  return {
    ...sampleSurfaceClimate(
      planet,
      seed,
      position,
      frame.heightMeters,
      frame.heightDetails,
    ),
    normal: frame.normal,
  };
}

export function sampleVisiblePlanetSurface(
  planet: Planet,
  seed: number,
  position: Vec3,
): PlanetSurfaceSample {
  const frame = sampleVisibleSurfaceFrame(planet, seed, position);
  return {
    ...sampleSurfaceClimate(
      planet,
      seed,
      position,
      frame.heightMeters,
      frame.heightDetails,
    ),
    normal: frame.normal,
  };
}

export function sampleAnalyticSurfaceAtDirection(
  direction: Vec3,
  planet: Planet,
  seed: number,
  offsetMeters: number = 0,
): SurfaceAtDirectionResult {
  const normalizedDirection = normalize(direction);
  const samplePosition = scale(normalizedDirection, planet.radiusMeters);
  const surface = sampleAnalyticPlanetSurface(planet, seed, samplePosition);
  return {
    point: scale(normalizedDirection, surface.surfaceRadiusMeters + offsetMeters),
    surface,
  };
}

export function sampleVisibleSurfaceAtDirection(
  direction: Vec3,
  planet: Planet,
  seed: number,
  offsetMeters: number = 0,
): SurfaceAtDirectionResult {
  const normalizedDirection = normalize(direction);
  const samplePosition = scale(normalizedDirection, planet.radiusMeters);
  const surface = sampleVisiblePlanetSurface(planet, seed, samplePosition);
  return {
    point: scale(normalizedDirection, surface.surfaceRadiusMeters + offsetMeters),
    surface,
  };
}

export function surfacePointFromDirection(
  direction: Vec3,
  planet: Planet,
  seed: number,
  offsetMeters: number = 0,
): Vec3 {
  return sampleAnalyticSurfaceAtDirection(direction, planet, seed, offsetMeters).point;
}

export function renderableSurfacePointFromDirection(
  direction: Vec3,
  planet: Planet,
  seed: number,
  offsetMeters: number = 0,
): Vec3 {
  return sampleVisibleSurfaceAtDirection(direction, planet, seed, offsetMeters).point;
}

export const samplePlanetSurface = sampleAnalyticPlanetSurface;
export const sampleRenderablePlanetSurface = sampleVisiblePlanetSurface;
