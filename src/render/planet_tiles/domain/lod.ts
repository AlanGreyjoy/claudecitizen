import type { Planet, TileInfo, Vec3 } from '../../../types';
import { distance, dot, sub } from '../../../math/vec3';
import { directionFromCubeFace } from '../../../world/cube_sphere';
import {
  BACKFACE_CULL_DOT,
  HORIZON_MARGIN_RADIANS,
  MAX_LEVEL,
  MIN_LEVEL,
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

function tileBoundingRadiusMeters(info: TileInfo, planet: Planet): number {
  const angularRadius = tileAngularRadius(info);
  const surfaceRadius = planet.radiusMeters + Math.abs(planet.terrainAmplitudeMeters);
  const surfaceChordRadius = 2 * surfaceRadius * Math.sin(angularRadius * 0.5);
  // Tile centers sit on the sea-level sphere. Include the full authored height
  // envelope plus skirt depth so the view test cannot reject visible geometry.
  return surfaceChordRadius + Math.abs(planet.terrainAmplitudeMeters) * 2;
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
  const radius = tileBoundingRadiusMeters(info, planet);
  const forwardDistance = dot(toCenter, view.forward);
  if (forwardDistance < -radius) return true;

  // Sphere-vs-perspective-frustum side planes. The previous circular cone used
  // vertical FOV for both axes and a planet-centered tile radius, which culled
  // terrain that was visibly inside the wider horizontal camera frustum.
  const horizontalDistance = Math.abs(dot(toCenter, view.right));
  const horizontalLimit =
    Math.max(0, forwardDistance) * view.tanHalfFovX +
    radius * Math.hypot(1, view.tanHalfFovX);
  if (horizontalDistance > horizontalLimit) return true;

  const verticalDistance = Math.abs(dot(toCenter, view.up));
  const verticalLimit =
    Math.max(0, forwardDistance) * view.tanHalfFovY +
    radius * Math.hypot(1, view.tanHalfFovY);
  return verticalDistance > verticalLimit;
}

export function shouldSplitTile(
  info: TileInfo,
  planet: Planet,
  bodyPosition: Vec3,
  cameraUp: Vec3,
  altitudeMeters: number,
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
  if (
    info.level < MAX_LEVEL &&
    altitudeMeters < GROUND_MAX_LOD_ALTITUDE_METERS &&
    facing > 0.2 &&
    groundCameraDistance < GROUND_DETAIL_RADIUS_METERS + altitudeMeters * 0.35
  ) {
    return true;
  }

  const projectedError = info.spanMeters / Math.max(cameraDistance, 1);
  return projectedError > targetErrorForAltitude(altitudeMeters);
}
