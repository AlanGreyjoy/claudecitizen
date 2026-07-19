import type { Planet, TileInfo, Vec3 } from '../../../types';
import { distance, dot, sub } from '../../../math/vec3';
import { directionFromCubeFace } from '../../../world/cube_sphere';
import {
  BACKFACE_CULL_DOT,
  HORIZON_MARGIN_RADIANS,
  MAX_LEVEL,
  MIN_LEVEL,
  TERRAIN_SKIRT_MAX_DEPTH_METERS,
  minProjectedError,
} from './constants';
import { clamp, clamp01 } from './tile_key';

// Force max terrain detail near the player so the visible mesh matches foot sampling.
const GROUND_MAX_LOD_ALTITUDE_METERS = 2_000;
// L17 halves the ground triangle span. Halving the forced-detail radius keeps
// the number of max-detail tiles near the player approximately unchanged while
// raising on-foot fidelity from roughly 8 m to 4 m per triangle.
const GROUND_DETAIL_RADIUS_METERS = 450;
/** Near-viewer tiles (and parents that contain them) must never be frustum-culled. */
const FRUSTUM_KEEP_RADIUS_METERS = 900;
const tileAngularRadiusCache = new WeakMap<TileInfo, number>();

export interface TileSelectionView {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  tanHalfFovX: number;
  tanHalfFovY: number;
}

function tileAngularRadius(info: TileInfo): number {
  const cached = tileAngularRadiusCache.get(info);
  if (cached != null) return cached;
  const { u0, u1, v0, v1 } = info.bounds;
  const corners = [
    directionFromCubeFace(info.face, u0, v0),
    directionFromCubeFace(info.face, u1, v0),
    directionFromCubeFace(info.face, u0, v1),
    directionFromCubeFace(info.face, u1, v1),
  ];
  let minimumFacing = 1;
  for (const corner of corners) {
    minimumFacing = Math.min(minimumFacing, dot(info.centerDirection, corner));
  }
  const radius = Math.acos(clamp(minimumFacing, -1, 1));
  tileAngularRadiusCache.set(info, radius);
  return radius;
}

function tileFootprintRadiusMeters(info: TileInfo, planet: Planet): number {
  const angularRadius = tileAngularRadius(info);
  const surfaceRadius = planet.radiusMeters + Math.abs(planet.terrainAmplitudeMeters);
  return 2 * surfaceRadius * Math.sin(angularRadius * 0.5);
}

/**
 * Conservative support radius for a tile against one frustum plane.
 *
 * Treating the complete terrain height envelope as an isotropic sphere made
 * every fine tile roughly 30 km wide for culling purposes on Asteron. Almost
 * the complete near hemisphere then survived a narrow cockpit view. Terrain
 * height and skirts are radial, so only their projection onto the tested plane
 * belongs in the bound.
 */
function tilePlaneSupportMeters(
  info: TileInfo,
  planet: Planet,
  sideAxis: Vec3,
  forwardAxis: Vec3,
  sideSign: -1 | 1,
  tanHalfFov: number,
): number {
  const footprintSupport =
    tileFootprintRadiusMeters(info, planet) * Math.hypot(1, tanHalfFov);
  // Surface heights are clamped to +/- amplitude. Skirts extend inward by a
  // bounded local-cell allowance rather than a fraction of total relief.
  const heightEnvelope =
    Math.abs(planet.terrainAmplitudeMeters) + TERRAIN_SKIRT_MAX_DEPTH_METERS;
  const radialProjection = Math.abs(
    sideSign * dot(info.centerDirection, sideAxis) -
      tanHalfFov * dot(info.centerDirection, forwardAxis),
  );
  return footprintSupport + heightEnvelope * radialProjection;
}

export function targetErrorForAltitude(altitudeMeters: number): number {
  const groundFloor = altitudeMeters < 500 ? 0.18 : 0.24;
  const baseline = groundFloor + clamp01(altitudeMeters / 120_000) * 1.8;
  return Math.max(minProjectedError(), baseline);
}

/**
 * True when this tile could cover the viewer. Large parents often have centers
 * far outside the view cone while still containing the player — those must
 * stay alive so LOD can recurse into underfoot children.
 */
function tileNearViewer(
  info: TileInfo,
  bodyPosition: Vec3,
  altitudeMeters: number,
): boolean {
  const keep =
    FRUSTUM_KEEP_RADIUS_METERS +
    Math.max(0, altitudeMeters) * 0.15 +
    info.spanMeters * 0.75;
  return distance(info.centerPosition, bodyPosition) < keep;
}

export function shouldCullTile(
  info: TileInfo,
  planet: Planet,
  cameraUp: Vec3,
  altitudeMeters: number,
  bodyPosition: Vec3,
  view?: TileSelectionView | null,
): boolean {
  if (info.level <= 0) return false;

  // Never drop coverage under / around the viewer — frustum tests on tile
  // centers would otherwise cull the whole subdivision chain (0 active tiles).
  if (tileNearViewer(info, bodyPosition, altitudeMeters)) return false;

  const facing = dot(info.centerDirection, cameraUp);
  // Aggressively drop the far / back hemisphere before horizon math.
  if (facing < BACKFACE_CULL_DOT) return true;

  const phiH = Math.acos(
    planet.radiusMeters / Math.max(planet.radiusMeters + altitudeMeters, planet.radiusMeters + 1),
  );
  const phiCenter = Math.acos(clamp(facing, -1, 1));
  // Cube-sphere tile centers are not generally the geodesic midpoint of an
  // opposite-corner chord. Half that chord can underestimate the tile's true
  // angular radius badly enough to cull the tile containing the camera near a
  // cube-face axis. The farthest center-to-corner angle is conservative for
  // the normalized cube-face patch.
  const phiHalf = tileAngularRadius(info);
  const nearestAngle = Math.max(0, phiCenter - phiHalf);
  if (nearestAngle > phiH + HORIZON_MARGIN_RADIANS) return true;

  if (!view) return false;

  const toCenter = sub(info.centerPosition, view.eye);
  const footprintRadius = tileFootprintRadiusMeters(info, planet);
  const heightEnvelope =
    Math.abs(planet.terrainAmplitudeMeters) + TERRAIN_SKIRT_MAX_DEPTH_METERS;
  const forwardDistance = dot(toCenter, view.forward);
  const forwardSupport =
    footprintRadius +
    heightEnvelope * Math.abs(dot(info.centerDirection, view.forward));
  if (forwardDistance < -forwardSupport) return true;

  // Tile-vs-perspective-frustum side planes. Test each side separately so the
  // radial height envelope is projected in the correct direction instead of
  // inflating every tile by the planet's full terrain amplitude.
  const horizontalCenter = dot(toCenter, view.right);
  for (const sign of [-1, 1] as const) {
    const planeDistance =
      sign * horizontalCenter - forwardDistance * view.tanHalfFovX;
    const support = tilePlaneSupportMeters(
      info,
      planet,
      view.right,
      view.forward,
      sign,
      view.tanHalfFovX,
    );
    if (planeDistance > support) return true;
  }

  const verticalCenter = dot(toCenter, view.up);
  for (const sign of [-1, 1] as const) {
    const planeDistance =
      sign * verticalCenter - forwardDistance * view.tanHalfFovY;
    const support = tilePlaneSupportMeters(
      info,
      planet,
      view.up,
      view.forward,
      sign,
      view.tanHalfFovY,
    );
    if (planeDistance > support) return true;
  }
  return false;
}

export function shouldSplitTile(
  info: TileInfo,
  planet: Planet,
  bodyPosition: Vec3,
  cameraUp: Vec3,
  altitudeMeters: number,
  wasSplit = false,
): boolean {
  if (info.level < MIN_LEVEL) return true;
  if (info.level >= MAX_LEVEL) return false;

  const facing = dot(info.centerDirection, cameraUp);
  if (facing < BACKFACE_CULL_DOT && !tileNearViewer(info, bodyPosition, altitudeMeters)) {
    return false;
  }

  const cameraDistance = distance(info.centerPosition, bodyPosition);
  const centerAngle = Math.acos(clamp(facing, -1, 1));
  const nearestSurfaceDistance =
    Math.max(0, centerAngle - tileAngularRadius(info)) * planet.radiusMeters;
  const groundCameraDistance = Math.hypot(
    nearestSurfaceDistance,
    Math.max(altitudeMeters, 0),
  );
  const groundDetailRadius =
    GROUND_DETAIL_RADIUS_METERS * (wasSplit ? 1.15 : 1);
  const groundDetailAltitude =
    GROUND_MAX_LOD_ALTITUDE_METERS * (wasSplit ? 1.1 : 1);
  if (
    info.level < MAX_LEVEL &&
    altitudeMeters < groundDetailAltitude &&
    facing > 0.2 &&
    groundCameraDistance < groundDetailRadius + altitudeMeters * 0.35
  ) {
    return true;
  }

  const projectedError = info.spanMeters / Math.max(cameraDistance, 1);
  const targetError = targetErrorForAltitude(altitudeMeters);
  // Once a parent has split, keep its children until the projected error falls
  // clearly below the entry threshold. This prevents tiny ship/camera motion
  // from alternating a cached parent and its four cached children every frame.
  return projectedError > targetError * (wasSplit ? 0.82 : 1);
}
