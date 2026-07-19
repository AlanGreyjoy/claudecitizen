// Renders an equirectangular biome map of the planet to a BMP for quick
// visual inspection of macro terrain structure. Usage: npx tsx scripts/biome_map.ts
import { writeFileSync } from 'node:fs';
import { sampleSurfaceHeight } from '../src/world/elevation';
import { sampleSurfaceClimate } from '../src/world/climate';
import { CLAUDECITIZEN_PLANET } from '../src/world/planet';
import type { Biome, Vec3, WaterBody } from '../src/types';

const seed = 20061;
const planet = CLAUDECITIZEN_PLANET;
const WIDTH = 720;
const HEIGHT = 360;

const BIOME_COLORS: Record<Biome, [number, number, number]> = {
  forest: [45, 90, 39],
  plains: [96, 128, 56],
  desert: [194, 178, 128],
  tundra: [255, 255, 255],
  highlands: [139, 144, 136],
  peak: [248, 251, 255],
  rock: [127, 114, 95],
};

const WATER_COLORS: Record<WaterBody, [number, number, number]> = {
  ocean: [26, 58, 90],
  lake: [42, 90, 122],
  river: [80, 140, 190],
};

const rowSize = Math.ceil((WIDTH * 3) / 4) * 4;
const pixelDataSize = rowSize * HEIGHT;
const fileSize = 54 + pixelDataSize;
const buf = Buffer.alloc(fileSize);
buf.write('BM', 0);
buf.writeUInt32LE(fileSize, 2);
buf.writeUInt32LE(54, 10);
buf.writeUInt32LE(40, 14);
buf.writeInt32LE(WIDTH, 18);
buf.writeInt32LE(HEIGHT, 22);
buf.writeUInt16LE(1, 26);
buf.writeUInt16LE(24, 28);
buf.writeUInt32LE(pixelDataSize, 34);

for (let py = 0; py < HEIGHT; py += 1) {
  const lat = Math.PI / 2 - (Math.PI * (py + 0.5)) / HEIGHT;
  for (let px = 0; px < WIDTH; px += 1) {
    const lon = -Math.PI + (2 * Math.PI * (px + 0.5)) / WIDTH;
    const dir: Vec3 = {
      x: Math.cos(lat) * Math.cos(lon),
      y: Math.sin(lat),
      z: Math.cos(lat) * Math.sin(lon),
    };
    const pos: Vec3 = {
      x: dir.x * planet.radiusMeters,
      y: dir.y * planet.radiusMeters,
      z: dir.z * planet.radiusMeters,
    };
    const height = sampleSurfaceHeight(planet, seed, pos);
    const sample = sampleSurfaceClimate(planet, seed, pos, height);
    let [r, g, b] = sample.waterBody
      ? WATER_COLORS[sample.waterBody]
      : BIOME_COLORS[sample.biome];
    // Shade land by height so mountain relief is visible.
    if (sample.normalizedHeight > 0) {
      const shade = 1 - Math.min(0.45, sample.normalizedHeight * 0.9);
      if (sample.waterBody == null && sample.biome !== 'peak') {
        r = Math.round(r * shade + 255 * (1 - shade) * 0.5);
        g = Math.round(g * shade + 255 * (1 - shade) * 0.5);
        b = Math.round(b * shade + 255 * (1 - shade) * 0.5);
      }
    }
    // BMP rows are bottom-up.
    const offset = 54 + (HEIGHT - 1 - py) * rowSize + px * 3;
    buf[offset] = b;
    buf[offset + 1] = g;
    buf[offset + 2] = r;
  }
}

writeFileSync('scripts/biome_map.bmp', buf);
console.log('wrote scripts/biome_map.bmp');
