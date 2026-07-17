// Measures the desync between the RENDERED terrain mesh height and the analytic
// sampler height at the player's location. The mesh is built from the sampler at
// a coarse grid (TILE_SEGMENTS per tile); if a consumer uses the analytic
// sampler instead, it will appear to float or sink relative to the visible mesh.
import { CLAUDECITIZEN_PLANET as planet } from '../src/world/planet';
import {
  getRenderableSurfaceCacheStats,
  samplePlanetSurface,
  sampleRenderablePlanetSurface,
} from '../src/world/planet_surface';
import { sampleVisibleSurfaceFrame } from '../src/world/renderable_surface';
import { cartesianFromLatLonAlt } from '../src/world/coordinates';
import { resolveLandingSite } from '../src/world/landing_sites';
import { faceUvFromDirection, directionFromCubeFace } from '../src/world/cube_sphere';
import { normalize, scale } from '../src/math/vec3';

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
  const direction = directionFromCubeFace(face, pu, pv);
  return sampleVisibleSurfaceFrame(planet, seed, scale(direction, R), level).heightMeters;
}

for (const level of [6, 7, 8, 9, 16]) {
  const meshH = tileMeshHeightAt(level, u, v);
  const desync = samplerHeight - meshH;
  console.log(
    `level ${level}: meshHeight=${meshH.toFixed(1)}m  desync(sampler-mesh)=${desync.toFixed(1)}m`,
  );
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
