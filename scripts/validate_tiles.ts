// Validates the real createPlanetTileManager: counts selected tiles and measures
// build time at ground level after the LOD fix.
import {
  createPlanetTileManager,
  type TileManagerUpdateResult,
} from '../src/render/planet_tiles';
import { CLAUDECITIZEN_PLANET as planet } from '../src/world/planet';
import { sampleRenderablePlanetSurface } from '../src/world/planet_surface';
import { cartesianFromLatLonAlt } from '../src/world/coordinates';
import { resolveLandingSite } from '../src/world/landing_sites';
import { normalize, scale } from '../src/math/vec3';
import type { Scene } from 'three';
import type { Vec3 } from '../src/types';

const seed = 20061;
const { latRadians, lonRadians } = resolveLandingSite(planet, seed);
const probe = cartesianFromLatLonAlt(latRadians, lonRadians, 0, planet.radiusMeters);
const surface = sampleRenderablePlanetSurface(planet, seed, probe);
const bodyPosition = scale(normalize(probe), planet.radiusMeters + surface.heightMeters + 2);

const scene = { add() {} } as unknown as Scene;
const mgr = createPlanetTileManager(scene, planet, seed);

// Run update a few times so the build budget populates the selected tiles.
let last: TileManagerUpdateResult | null = null;
const t0 = performance.now();
for (let i = 0; i < 20; i += 1) {
  last = mgr.update(bodyPosition, surface);
}
const t1 = performance.now();
console.log('selectedTiles (frame 1 budget=12):', '(see below)');
if (last) {
  console.log('after 20 frames -> selectedTiles:', last.selectedTiles.length, 'total elapsed:', (t1 - t0).toFixed(0), 'ms');
  console.log('after 20 frames -> cache stats:', last.stats);
}

// One fresh update to see the per-frame selection count (tiles chosen, pre-budget).
const fresh = mgr.update(bodyPosition, surface);
console.log('fresh update selectedTiles:', fresh.selectedTiles.length);
console.log('fresh update cache stats:', fresh.stats);

for (let i = 1; i <= 48; i += 1) {
  const sweepProbe = cartesianFromLatLonAlt(
    latRadians,
    lonRadians + i * 0.0025,
    0,
    planet.radiusMeters,
  );
  const sweepSurface = sampleRenderablePlanetSurface(planet, seed, sweepProbe);
  const sweepPosition: Vec3 = scale(
    normalize(sweepProbe),
    planet.radiusMeters + sweepSurface.heightMeters + 2,
  );
  last = mgr.update(sweepPosition, sweepSurface);
}
if (last) {
  console.log('after sweep cache stats:', last.stats);
}
