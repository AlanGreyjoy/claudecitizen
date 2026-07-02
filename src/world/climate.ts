import { altitudeForPosition, latLonForPosition, radialUp } from './coordinates';
import { sampleLakeSurface } from './lakes';
import { clamp01, fbm3d, getNoise3D } from './terrain_noise';
import type { Biome, Planet, PlanetSurfaceSample, Vec3 } from '../types';

export function sampleSurfaceClimate(
  planet: Planet,
  seed: number,
  position: Vec3,
  heightMeters: number,
): PlanetSurfaceSample {
  const { latRadians } = latLonForPosition(position);
  const noise3D = getNoise3D(seed + 1234);
  const surfaceRadiusMeters = planet.radiusMeters + heightMeters;
  const altitudeMeters = altitudeForPosition(position, surfaceRadiusMeters);
  const normalizedHeight = heightMeters / planet.terrainAmplitudeMeters;
  const unit = radialUp(position);

  const tempNoise = fbm3d(noise3D, unit.x, unit.y, unit.z, 3, 0.5, 2.0, 2.0);
  const latFactor = Math.abs(latRadians) / (Math.PI / 2);
  const altitudeFactor = Math.max(0, normalizedHeight);
  let temperature = 1.0 - latFactor - altitudeFactor * 0.5 + tempNoise * 0.2;
  temperature = clamp01(temperature);

  const moistureNoise = getNoise3D(seed + 5678);
  const mNoise = fbm3d(moistureNoise, unit.x, unit.y, unit.z, 4, 0.5, 2.0, 1.5);
  let moisture = mNoise * 0.5 + 0.5;
  moisture += Math.cos(latRadians * 3) * 0.2;
  moisture -= Math.max(0, normalizedHeight) * 0.2;
  moisture = clamp01(moisture);

  const lake = sampleLakeSurface(planet, seed, position, heightMeters, normalizedHeight, moisture);

  let biome: Biome = 'rock';
  if (normalizedHeight < 0.0) {
    biome = 'ocean';
  } else if (
    lake.lakeWaterLevelMeters != null &&
    heightMeters < lake.lakeWaterLevelMeters - 0.5
  ) {
    biome = 'lake';
  } else if (normalizedHeight < 0.05) {
    biome = 'beach';
  } else if (normalizedHeight > 0.6) {
    biome = temperature < 0.3 ? 'peak' : 'highlands';
  } else if (temperature < 0.2) {
    biome = 'tundra';
  } else if (moisture > 0.6) {
    biome = 'forest';
  } else if (moisture > 0.3) {
    biome = 'plains';
  } else {
    biome = 'desert';
  }

  let fertility = 0;
  if (biome === 'forest') fertility = 0.8 + moisture * 0.2;
  else if (biome === 'plains') fertility = 0.4 + moisture * 0.4;
  else if (biome === 'beach' || biome === 'tundra' || biome === 'desert') fertility = 0.1;

  const grassDensity = clamp01(fertility);
  // Plains fertility lands around 0.5-0.65, so the old `(fertility - 0.5) * 0.5`
  // produced near-zero tree density and visibly barren grasslands.
  const treeDensity =
    biome === 'forest'
      ? clamp01(fertility)
      : biome === 'plains'
        ? clamp01(fertility - 0.4) * 0.9
        : 0;

  return {
    altitudeMeters,
    biome,
    fertility,
    grassDensity,
    heightMeters,
    lakeDepth: lake.lakeDepth,
    lakeStrength: lake.lakeStrength,
    lakeWaterLevelMeters: lake.lakeWaterLevelMeters,
    moisture,
    normalizedHeight,
    surfaceRadiusMeters,
    temperature,
    treeDensity,
  };
}
