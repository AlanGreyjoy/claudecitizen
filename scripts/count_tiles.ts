// Fast standalone reimplementation of the tile selection logic in
// src/render/planet_tiles/manager.ts. Counts selected tiles per level WITHOUT
// building geometry, so we can test LOD fixes quickly.
import { dot, distance, normalize, scale } from '../src/math/vec3';
import { CUBE_FACES, directionFromCubeFace, faceUvFromDirection } from '../src/world/cube_sphere';
import { radialUp, cartesianFromLatLonAlt } from '../src/world/coordinates';
import {
  RENDER_SURFACE_LEVEL,
  sampleRenderablePlanetSurface,
} from '../src/world/planet_surface';
import { CLAUDECITIZEN_PLANET as planet } from '../src/world/planet';
import { resolveLandingSite } from '../src/world/landing_sites';
import type { CubeFace, TileBounds, TileInfo, Vec3 } from '../src/types';

const R = planet.radiusMeters;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function tileBounds(level: number, x: number, y: number): TileBounds {
  const tileCount = 2 ** level;
  const step = 2 / tileCount;
  const u0 = -1 + x * step;
  const v0 = -1 + y * step;
  return { u0, u1: u0 + step, v0, v1: v0 + step };
}

function makeTileInfo(face: CubeFace, level: number, x: number, y: number): TileInfo {
  const bounds = tileBounds(level, x, y);
  const centerDirection = directionFromCubeFace(face, (bounds.u0 + bounds.u1) * 0.5, (bounds.v0 + bounds.v1) * 0.5);
  const cornerA = scale(directionFromCubeFace(face, bounds.u0, bounds.v0), R);
  const cornerB = scale(directionFromCubeFace(face, bounds.u1, bounds.v1), R);
  const centerPosition = scale(centerDirection, R);
  return { bounds, centerDirection, centerPosition, face, level, spanMeters: distance(cornerA, cornerB), x, y };
}

const seed = 20061;
const { latRadians, lonRadians } = resolveLandingSite(planet, seed);
const probe = cartesianFromLatLonAlt(latRadians, lonRadians, 0, R);
const surface = sampleRenderablePlanetSurface(planet, seed, probe);
const groundPos = scale(normalize(probe), R + surface.heightMeters + 2);

interface TileLodConfig {
  MIN_LEVEL: number;
  MAX_LEVEL: number;
  splitFacingFloor: number;
  errorFn: (alt: number) => number;
  horizonMarginRad: number | null;
}

function run(
  label: string,
  cfg: TileLodConfig,
  bodyPosition: Vec3,
  altitudeMeters: number,
): void {
  const { MIN_LEVEL, MAX_LEVEL, splitFacingFloor, errorFn, horizonMarginRad } = cfg;

  function shouldCullTile(info: TileInfo, cameraUp: Vec3, alt: number): boolean {
    const facing = dot(info.centerDirection, cameraUp);
    if (horizonMarginRad != null) {
      // Geometric horizon: a surface point is visible if its angular distance
      // from the sub-camera point is < phiH = acos(R/(R+alt)). Cull a tile only
      // if its NEAREST point to the sub-camera point is beyond phiH + margin,
      // so we never drop the tile the camera is standing in.
      const phiH = Math.acos(R / Math.max(R + alt, R + 1));
      const phiCenter = Math.acos(clamp(facing, -1, 1));
      const phiHalf = info.spanMeters / (2 * R); // angular half-extent of the tile
      const nearestAngle = Math.max(0, phiCenter - phiHalf);
      return nearestAngle > phiH + horizonMarginRad && info.level > 0;
    }
    const horizonAllowance = clamp01(alt / (R * 0.12)) * 0.28;
    return facing < -0.45 - horizonAllowance && info.level > 0;
  }

  function shouldSplitTile(info: TileInfo, bodyPos: Vec3, cameraUp: Vec3, alt: number): boolean {
    if (info.level < MIN_LEVEL) return true;
    if (info.level >= MAX_LEVEL) return false;
    const facing = dot(info.centerDirection, cameraUp);
    if (facing < splitFacingFloor) return false;
    const cameraDistance = distance(info.centerPosition, bodyPos);
    const projectedError = info.spanMeters / Math.max(cameraDistance, 1);
    return projectedError > errorFn(alt);
  }

  const cameraUp = radialUp(bodyPosition);
  const cameraFace = faceUvFromDirection(cameraUp);
  const counts: Record<number, number> = {};
  let total = 0;

  function traverse(face: CubeFace, level: number, x: number, y: number): void {
    const info = makeTileInfo(face, level, x, y);
    if (level <= 1 && face !== cameraFace.face && level < MIN_LEVEL) {
      traverse(face, level + 1, x * 2, y * 2);
      traverse(face, level + 1, x * 2 + 1, y * 2);
      traverse(face, level + 1, x * 2, y * 2 + 1);
      traverse(face, level + 1, x * 2 + 1, y * 2 + 1);
      return;
    }
    if (shouldCullTile(info, cameraUp, altitudeMeters)) return;
    if (shouldSplitTile(info, bodyPosition, cameraUp, altitudeMeters)) {
      traverse(face, level + 1, x * 2, y * 2);
      traverse(face, level + 1, x * 2 + 1, y * 2);
      traverse(face, level + 1, x * 2, y * 2 + 1);
      traverse(face, level + 1, x * 2 + 1, y * 2 + 1);
      return;
    }
    counts[info.level] = (counts[info.level] || 0) + 1;
    total++;
  }

  for (const face of CUBE_FACES) traverse(face, 0, 0, 0);
  const verts = total * 625;
  const levels = Object.keys(counts).map(Number);
  const maxLvl = levels.length ? Math.max(...levels) : '-';
  console.log(`${label.padEnd(30)} alt=${String(Math.round(altitudeMeters)).padStart(7)}m  tiles: ${String(total).padStart(5)}  verts: ${verts.toLocaleString().padStart(10)}  maxLvl: ${maxLvl}  byLevel: ${JSON.stringify(counts)}`);
}

const currentError = (alt: number): number =>
  Math.max(0.9, (alt < 500 ? 0.18 : 0.24) + clamp01(alt / 120_000) * 1.8);

const CURRENT: TileLodConfig = {
  MIN_LEVEL: 2,
  MAX_LEVEL: RENDER_SURFACE_LEVEL,
  splitFacingFloor: -0.18,
  errorFn: currentError,
  horizonMarginRad: 0.03,
};

console.log('--- GROUND (on foot, ~2m above surface) ---');
run('CURRENT', CURRENT, groundPos, 2);

// Low flight (ship, 500m up)
console.log('--- LOW FLIGHT (500m) ---');
run('CURRENT', CURRENT, groundPos, 500);

// High atmosphere / orbit (50km)
console.log('--- HIGH (50km) ---');
run('CURRENT', CURRENT, groundPos, 50_000);

// Orbit (200km)
console.log('--- ORBIT (200km) ---');
run('CURRENT', CURRENT, groundPos, 200_000);
