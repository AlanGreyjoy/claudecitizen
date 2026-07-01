// Measures the desync between the RENDERED terrain mesh height and the analytic
// sampler height at the player's location. The mesh is built from the sampler at
// a coarse grid (TILE_SEGMENTS per tile); if the sampler has sub-tile detail, the
// mesh linearly interpolates across it and the player/vegetation (which use the
// exact sampler) will appear to float or sink relative to the visible mesh.
import { CLAUDECITIZEN_PLANET as planet } from '../src/world/planet';
import {
  getRenderableSurfaceCacheStats,
  samplePlanetSurface,
  sampleRenderablePlanetSurface,
} from '../src/world/planet_surface';
import { cartesianFromLatLonAlt } from '../src/world/coordinates';
import { resolveLandingSite } from '../src/world/landing_sites';
import { faceUvFromDirection, directionFromCubeFace } from '../src/world/cube_sphere';
import { normalize, scale } from '../src/math/vec3';

const TILE_SEGMENTS = 24;
const seed = 20061;
const R = planet.radiusMeters;

const { latRadians, lonRadians } = resolveLandingSite(planet, seed);
const probe = cartesianFromLatLonAlt(latRadians, lonRadians, 0, R);
const playerPos = scale(normalize(probe), R + samplePlanetSurface(planet, seed, probe).heightMeters + 0.05);
const playerDir = normalize(playerPos);
const samplerHeight = samplePlanetSurface(planet, seed, playerPos).heightMeters;
console.log('player sampler height:', samplerHeight.toFixed(1), 'm');

const { face, u, v } = faceUvFromDirection(playerDir);

function tileMeshHeightAt(level: number, pu: number, pv: number): number {
  const tileCount = 2 ** level;
  const tx = Math.min(tileCount - 1, Math.max(0, Math.floor(((pu + 1) / 2) * tileCount)));
  const ty = Math.min(tileCount - 1, Math.max(0, Math.floor(((pv + 1) / 2) * tileCount)));
  const step = 2 / tileCount;
  const u0 = -1 + tx * step;
  const v0 = -1 + ty * step;
  // local fractional position within the tile [0,1]
  const fu = (pu - u0) / step;
  const fv = (pv - v0) / step;
  const ix = Math.min(TILE_SEGMENTS, Math.max(0, Math.floor(fu * TILE_SEGMENTS)));
  const iy = Math.min(TILE_SEGMENTS, Math.max(0, Math.floor(fv * TILE_SEGMENTS)));
  const tx0 = ix / TILE_SEGMENTS;
  const tx1 = (ix + 1) / TILE_SEGMENTS;
  const ty0 = iy / TILE_SEGMENTS;
  const ty1 = (iy + 1) / TILE_SEGMENTS;
  const ax = (fu - tx0) / (tx1 - tx0);
  const ay = (fv - ty0) / (ty1 - ty0);
  const corner = (cx: number, cy: number): number => {
    const dir = directionFromCubeFace(face, u0 + step * (cx / TILE_SEGMENTS), v0 + step * (cy / TILE_SEGMENTS));
    const s = samplePlanetSurface(planet, seed, scale(dir, R));
    return s.surfaceRadiusMeters;
  };
  const r00 = corner(ix, iy);
  const r10 = corner(ix + 1, iy);
  const r01 = corner(ix, iy + 1);
  const r11 = corner(ix + 1, iy + 1);
  const r0 = r00 + (r10 - r00) * ax;
  const r1 = r01 + (r11 - r01) * ax;
  return (r0 + (r1 - r0) * ay) - R;
}

for (const level of [6, 7, 8, 9]) {
  const meshH = tileMeshHeightAt(level, u, v);
  const desync = samplerHeight - meshH;
  console.log(`level ${level}: meshHeight=${meshH.toFixed(1)}m  desync(sampler-mesh)=${desync.toFixed(1)}m  quadSize=${(R * Math.PI / 2 / 2 ** level / TILE_SEGMENTS).toFixed(0)}m`);
}

// Also check a few random nearby points to see worst-case desync at level 8.
let worst = 0;
for (let i = 0; i < 200; i += 1) {
  const du = (Math.random() - 0.5) * 0.02;
  const dv = (Math.random() - 0.5) * 0.02;
  const dir = directionFromCubeFace(face, u + du, v + dv);
  const sH = samplePlanetSurface(planet, seed, scale(dir, R)).heightMeters;
  const mH = tileMeshHeightAt(8, u + du, v + dv);
  worst = Math.max(worst, Math.abs(sH - mH));
}
console.log('level 8 worst desync over 200 nearby points:', worst.toFixed(1), 'm');

for (let i = 0; i < 200; i += 1) {
  const du = (Math.random() - 0.5) * 0.02;
  const dv = (Math.random() - 0.5) * 0.02;
  const dir = directionFromCubeFace(face, u + du, v + dv);
  sampleRenderablePlanetSurface(planet, seed, scale(dir, R));
}
console.log('renderable surface cache stats:', getRenderableSurfaceCacheStats());
