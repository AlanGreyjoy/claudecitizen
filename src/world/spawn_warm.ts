import type { Planet, Vec3 } from '../types';
import { add, normalize, scale } from '../math/vec3';
import { cartesianFromLatLonAlt } from './coordinates';
import { resolveLandingSite } from './landing_sites';
import {
  sampleRenderableSurfaceHeightDetails,
} from './renderable_surface';
import { warmRiverNetwork } from './rivers';

const DEFAULT_HEIGHT_RING_RADIUS_METERS = 900;
const DEFAULT_HEIGHT_RING_SAMPLES_PER_SIDE = 40;

/**
 * Densely sample the renderable height cache around a surface point so the first
 * walk near spawn does not thrash the 120k Map.
 */
export function warmRenderableHeightRing(
  planet: Planet,
  seed: number,
  center: Vec3,
  radiusMeters: number = DEFAULT_HEIGHT_RING_RADIUS_METERS,
  samplesPerSide: number = DEFAULT_HEIGHT_RING_SAMPLES_PER_SIDE,
): void {
  const up = normalize(center);
  // Build a local tangent basis from an arbitrary non-parallel vector.
  const helper =
    Math.abs(up.y) < 0.9
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 };
  const east = normalize({
    x: helper.y * up.z - helper.z * up.y,
    y: helper.z * up.x - helper.x * up.z,
    z: helper.x * up.y - helper.y * up.x,
  });
  const north = normalize({
    x: up.y * east.z - up.z * east.y,
    y: up.z * east.x - up.x * east.z,
    z: up.x * east.y - up.y * east.x,
  });

  for (let iy = 0; iy < samplesPerSide; iy += 1) {
    for (let ix = 0; ix < samplesPerSide; ix += 1) {
      const u = (ix / (samplesPerSide - 1) - 0.5) * 2;
      const v = (iy / (samplesPerSide - 1) - 0.5) * 2;
      if (u * u + v * v > 1.05) continue;
      const offset = add(scale(east, u * radiusMeters), scale(north, v * radiusMeters));
      const probe = add(scale(up, planet.radiusMeters), offset);
      sampleRenderableSurfaceHeightDetails(planet, seed, probe);
    }
  }
}

export function spawnWarmFocusPosition(planet: Planet, seed: number): Vec3 {
  const site = resolveLandingSite(planet, seed);
  return cartesianFromLatLonAlt(
    site.latRadians,
    site.lonRadians,
    0,
    planet.radiusMeters,
  );
}

export function warmPlanetSpawnCaches(planet: Planet, seed: number): Vec3 {
  warmRiverNetwork(planet, seed);
  const focus = spawnWarmFocusPosition(planet, seed);
  warmRenderableHeightRing(planet, seed, focus);
  return focus;
}
