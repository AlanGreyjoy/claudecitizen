import { cartesianFromLatLonAlt } from './coordinates';
import { samplePlanetSurface } from './planet_surface';
import type { Biome, LandingSite, LandingSiteHint, Planet, PlanetSurfaceSample } from '../types';

export const DEFAULT_SPAWN_SITE: LandingSiteHint = {
  latRadians: -0.18,
  lonRadians: 1.0524073464102095,
};

interface LandingCandidate {
  dryNeighbors: number;
  latRadians: number;
  lonRadians: number;
  surface: PlanetSurfaceSample;
}

const landingSiteCache = new Map<string, LandingSite>();

function makeCacheKey(planet: Planet, seed: number, hint: LandingSiteHint): string {
  return [
    planet.name ?? 'planet',
    seed,
    hint.latRadians.toFixed(6),
    hint.lonRadians.toFixed(6),
  ].join(':');
}

function isDryBiome(biome: Biome): boolean {
  return biome !== 'ocean' && biome !== 'beach' && biome !== 'lake';
}

function sampleCandidate(
  planet: Planet,
  seed: number,
  latRadians: number,
  lonRadians: number,
): LandingCandidate {
  const probe = cartesianFromLatLonAlt(latRadians, lonRadians, 0, planet.radiusMeters);
  const surface = samplePlanetSurface(planet, seed, probe);
  const offsets: [number, number][] = [
    [-0.0015, 0],
    [0.0015, 0],
    [0, -0.0015],
    [0, 0.0015],
  ];

  let dryNeighbors = isDryBiome(surface.biome) ? 1 : 0;
  for (const [dLat, dLon] of offsets) {
    const nearbyProbe = cartesianFromLatLonAlt(
      latRadians + dLat,
      lonRadians + dLon,
      0,
      planet.radiusMeters,
    );
    const nearbySurface = samplePlanetSurface(planet, seed, nearbyProbe);
    if (isDryBiome(nearbySurface.biome)) dryNeighbors += 1;
  }

  return {
    dryNeighbors,
    latRadians,
    lonRadians,
    surface,
  };
}

export function resolveLandingSite(
  planet: Planet,
  seed: number,
  hint: LandingSiteHint = DEFAULT_SPAWN_SITE,
): LandingSite {
  const cacheKey = makeCacheKey(planet, seed, hint);
  const cached = landingSiteCache.get(cacheKey);
  if (cached) return cached;

  let best = sampleCandidate(planet, seed, hint.latRadians, hint.lonRadians);
  const stepRadians = 0.002;
  const searchRadius = 24;

  for (let latStep = -searchRadius; latStep <= searchRadius; latStep += 1) {
    for (let lonStep = -searchRadius; lonStep <= searchRadius; lonStep += 1) {
      const candidate = sampleCandidate(
        planet,
        seed,
        hint.latRadians + latStep * stepRadians,
        hint.lonRadians + lonStep * stepRadians,
      );
      const candidateScore =
        candidate.dryNeighbors * 10_000 +
        (isDryBiome(candidate.surface.biome) ? 2_000 : 0) +
        candidate.surface.fertility * 1_000 +
        candidate.surface.heightMeters * 0.01;
      const bestScore =
        best.dryNeighbors * 10_000 +
        (isDryBiome(best.surface.biome) ? 2_000 : 0) +
        best.surface.fertility * 1_000 +
        best.surface.heightMeters * 0.01;
      if (candidateScore > bestScore) best = candidate;
    }
  }

  const resolved: LandingSite = {
    latRadians: best.latRadians,
    lonRadians: best.lonRadians,
  };
  landingSiteCache.set(cacheKey, resolved);
  return resolved;
}
