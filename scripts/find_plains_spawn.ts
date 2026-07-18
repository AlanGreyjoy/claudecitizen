/**
 * One-shot scanner: find flat plains spawn candidates on a planet.
 * Usage: npx tsx scripts/find_plains_spawn.ts [planetId]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartesianFromLatLonAlt } from '../src/world/coordinates';
import { samplePlanetSurface } from '../src/world/planet_surface';
import { activatePlanetDocument } from '../src/world/planets/runtime';
import { parsePlanetDocument } from '../src/world/planets/schema';
import { warmRiverNetwork } from '../src/world/rivers';
import { sampleTerrainRegions } from '../src/world/terrain_regions';

const PLANET_ID = process.argv[2] ?? 'asteron';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const planetPath = path.join(
    ROOT,
    'src',
    'world',
    'planets',
    'data',
    `${PLANET_ID}.planet.json`,
  );
  const document = parsePlanetDocument(JSON.parse(await readFile(planetPath, 'utf8')));
  if (!document) throw new Error(`Invalid planet: ${planetPath}`);
  const { planet, seed } = activatePlanetDocument(document);
  warmRiverNetwork(planet, seed);

  function slopeMetric(lat: number, lon: number): { h0: number; maxDelta: number } {
    const d = 0.0012;
    const h0 = samplePlanetSurface(
      planet,
      seed,
      cartesianFromLatLonAlt(lat, lon, 0, planet.radiusMeters),
    ).heightMeters;
    const samples = [
      [lat + d, lon],
      [lat - d, lon],
      [lat, lon + d],
      [lat, lon - d],
    ].map(
      ([la, lo]) =>
        samplePlanetSurface(
          planet,
          seed,
          cartesianFromLatLonAlt(la, lo, 0, planet.radiusMeters),
        ).heightMeters,
    );
    const maxDelta = Math.max(...samples.map((h) => Math.abs(h - h0)));
    return { h0, maxDelta };
  }

  const candidates: Array<{
    lat: number;
    lon: number;
    score: number;
    height: number;
    norm: number;
    mountain: number;
    hill: number;
    slope: number;
    trees: number;
    grass: number;
    moisture: number;
  }> = [];

  const latStep = 0.04;
  const lonStep = 0.04;
  for (let lat = -1.1; lat <= 1.1; lat += latStep) {
    for (let lon = -Math.PI; lon < Math.PI; lon += lonStep) {
      const probe = cartesianFromLatLonAlt(lat, lon, 0, planet.radiusMeters);
      const s = samplePlanetSurface(planet, seed, probe);
      if (s.biome !== 'plains') continue;
      if (s.mountainRegion > 0.28) continue;
      if (s.normalizedHeight < 0.03 || s.normalizedHeight > 0.35) continue;
      const len = Math.hypot(probe.x, probe.y, probe.z) || 1;
      const regions = sampleTerrainRegions(
        seed,
        probe.x / len,
        probe.y / len,
        probe.z / len,
      );
      if (regions.hillRegion > 0.35) continue;
      const { maxDelta } = slopeMetric(lat, lon);
      if (maxDelta > 45) continue;
      const score =
        (1 - s.mountainRegion) * 40 +
        (1 - regions.hillRegion) * 35 +
        (1 - Math.min(1, maxDelta / 45)) * 50 +
        (1 - s.treeDensity) * 20 +
        s.grassDensity * 8 -
        Math.abs(s.normalizedHeight - 0.12) * 25;
      candidates.push({
        lat,
        lon,
        score: Number(score.toFixed(2)),
        height: Math.round(s.heightMeters),
        norm: Number(s.normalizedHeight.toFixed(3)),
        mountain: Number(s.mountainRegion.toFixed(3)),
        hill: Number(regions.hillRegion.toFixed(3)),
        slope: Number(maxDelta.toFixed(1)),
        trees: Number(s.treeDensity.toFixed(3)),
        grass: Number(s.grassDensity.toFixed(3)),
        moisture: Number(s.moisture.toFixed(3)),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  console.log(`planet=${PLANET_ID} plainsCandidates=${candidates.length}`);
  console.log(JSON.stringify(candidates.slice(0, 12), null, 2));
  if (candidates[0]) {
    const best = candidates[0];
    console.log(
      `\nBest spawnHint:\n  "latRadians": ${best.lat.toFixed(6)},\n  "lonRadians": ${best.lon.toFixed(6)}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
