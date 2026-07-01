import type { Planet, PlanetSurfaceSample, TileInfo, Vec3 } from '../../../types';
import { scale } from '../../../math/vec3';
import {
  renderableSurfacePointFromDirection,
  sampleRenderablePlanetSurface,
} from '../../../world/planet_surface';
import { buildSurfaceFrame } from './surface_frame';

export interface SurfaceAnchor {
  bitangent: Vec3;
  normal: Vec3;
  position: Vec3;
  surface: PlanetSurfaceSample;
  tangent: Vec3;
}

export function createAnchorFromDirection(
  direction: Vec3,
  planet: Planet,
  seed: number,
): SurfaceAnchor {
  const samplePos = scale(direction, planet.radiusMeters);
  const surface = sampleRenderablePlanetSurface(planet, seed, samplePos);
  const point = renderableSurfacePointFromDirection(direction, planet, seed, 0);
  const normal = normalizeVec3(
    surface.normal?.x ?? direction.x,
    surface.normal?.y ?? direction.y,
    surface.normal?.z ?? direction.z,
  );
  const { tangent, bitangent } = buildSurfaceFrame(normal);
  return {
    bitangent,
    normal,
    position: { x: point.x, y: point.y, z: point.z },
    surface,
    tangent,
  };
}

export function createAnchorFromTile(
  tileInfo: TileInfo,
  planet: Planet,
  seed: number,
): SurfaceAnchor {
  return createAnchorFromDirection(tileInfo.centerDirection, planet, seed);
}

function normalizeVec3(x: number, y: number, z: number): Vec3 {
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return { x: 0, y: 1, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}
