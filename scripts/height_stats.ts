import { sampleSurfaceHeight } from '../src/world/elevation';
import { sampleTerrainRegions } from '../src/world/terrain_regions';
import { CLAUDECITIZEN_PLANET } from '../src/world/planet';
import type { Vec3 } from '../src/types';

const seed = 20061;
const planet = CLAUDECITIZEN_PLANET;
const SAMPLES = 20000;

let s = 12345;
function rand(): number {
  s = (s * 1103515245 + 12345) % 2147483648;
  return s / 2147483648;
}

let mountainSamples = 0;
let maxH = -1;
let maxMountainH = -1;
const histo = new Array(10).fill(0);
let landHigh = 0;
let land = 0;

for (let i = 0; i < SAMPLES; i += 1) {
  const z = rand() * 2 - 1;
  const theta = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  const dir: Vec3 = { x: r * Math.cos(theta), y: r * Math.sin(theta), z };
  const pos: Vec3 = {
    x: dir.x * planet.radiusMeters,
    y: dir.y * planet.radiusMeters,
    z: dir.z * planet.radiusMeters,
  };
  const h = sampleSurfaceHeight(planet, seed, pos) / planet.terrainAmplitudeMeters;
  const { mountainRegion } = sampleTerrainRegions(seed, dir.x, dir.y, dir.z);
  maxH = Math.max(maxH, h);
  if (h > 0) {
    land += 1;
    if (h > 0.45) landHigh += 1;
    histo[Math.min(9, Math.floor(h * 10))] += 1;
  }
  if (mountainRegion > 0.35) {
    mountainSamples += 1;
    maxMountainH = Math.max(maxMountainH, h);
  }
}

console.log(`max normalizedHeight: ${maxH.toFixed(3)}`);
console.log(`mountainRegion>0.35: ${((mountainSamples / SAMPLES) * 100).toFixed(1)}% of surface`);
console.log(`max height in mountain regions: ${maxMountainH.toFixed(3)}`);
console.log(`land > 0.45: ${((landHigh / land) * 100).toFixed(2)}% of land`);
console.log('land height histogram (0.1 bins):', histo.map((c) => ((c / land) * 100).toFixed(1)).join(' '));
