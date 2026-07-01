import { normalize, scale } from '../math/vec3';
import { getFootSurfaceSampleLevel } from './foot_surface_level';
import { sampleSurfaceClimate } from './climate';
import { sampleSurfaceHeight } from './elevation';
import { sampleVisibleSurfaceFrame } from './renderable_surface';
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

export function sampleAnalyticPlanetSurface(
  planet: Planet,
  seed: number,
  position: Vec3,
): PlanetSurfaceSample {
  const heightMeters = sampleSurfaceHeight(planet, seed, position);
  return sampleSurfaceClimate(planet, seed, position, heightMeters);
}

export function sampleFootPlanetSurface(
  planet: Planet,
  seed: number,
  position: Vec3,
): PlanetSurfaceSample {
  const level = getFootSurfaceSampleLevel();
  const frame = sampleVisibleSurfaceFrame(planet, seed, position, level);
  return {
    ...sampleSurfaceClimate(planet, seed, position, frame.heightMeters),
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
    ...sampleSurfaceClimate(planet, seed, position, frame.heightMeters),
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
