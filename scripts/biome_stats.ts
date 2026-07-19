import { sampleSurfaceHeight } from '../src/world/elevation';
import { sampleSurfaceClimate } from '../src/world/climate';
import { CLAUDECITIZEN_PLANET } from '../src/world/planet';
import type { Vec3 } from '../src/types';

const seed = 20061;
const planet = CLAUDECITIZEN_PLANET;
const counts = new Map<string, number>();
const landCounts = new Map<string, number>();
const waterCounts = new Map<string, number>();
const SAMPLES = 20000;

let s = 12345;
function rand(): number {
  s = (s * 1103515245 + 12345) % 2147483648;
  return s / 2147483648;
}

for (let i = 0; i < SAMPLES; i += 1) {
  // Uniform point on sphere
  const z = rand() * 2 - 1;
  const theta = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  const dir: Vec3 = { x: r * Math.cos(theta), y: r * Math.sin(theta), z };
  const pos: Vec3 = {
    x: dir.x * planet.radiusMeters,
    y: dir.y * planet.radiusMeters,
    z: dir.z * planet.radiusMeters,
  };
  const height = sampleSurfaceHeight(planet, seed, pos);
  const sample = sampleSurfaceClimate(planet, seed, pos, height);
  counts.set(sample.biome, (counts.get(sample.biome) ?? 0) + 1);
  if (sample.waterBody == null) {
    landCounts.set(sample.biome, (landCounts.get(sample.biome) ?? 0) + 1);
  } else {
    waterCounts.set(sample.waterBody, (waterCounts.get(sample.waterBody) ?? 0) + 1);
  }
}

const land = [...landCounts.values()].reduce((a, b) => a + b, 0);
console.log('=== All samples ===');
for (const [biome, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${biome.padEnd(10)} ${((count / SAMPLES) * 100).toFixed(1)}%`);
}
console.log(`\n=== Land only (${land} samples) ===`);
for (const [biome, count] of [...landCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${biome.padEnd(10)} ${((count / land) * 100).toFixed(1)}%`);
}
console.log('\n=== Hydrology ===');
for (const [waterBody, count] of [...waterCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${waterBody.padEnd(10)} ${((count / SAMPLES) * 100).toFixed(1)}%`);
}
