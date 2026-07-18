import { cartesianFromLatLonAlt } from './coordinates';
import { samplePlanetSurface } from './planet_surface';
import { getActivePlanetConfig } from './planets/runtime';
import { terrainFingerprint } from './terrain_fingerprint';
import type { Biome, LandingSite, LandingSiteHint, Planet, PlanetSurfaceSample } from '../types';

export const DEFAULT_SPAWN_SITE: LandingSiteHint = {
  latRadians: -0.852,
  lonRadians: 2.190407,
};

interface LandingCandidate {
  dryNeighbors: number;
  heightDeltaMeters: number;
  latRadians: number;
  lonRadians: number;
  surface: PlanetSurfaceSample;
}

const landingSiteCache = new Map<string, LandingSite>();

function makeCacheKey(planet: Planet, seed: number, hint: LandingSiteHint): string {
  return [
    planet.name ?? 'planet',
    seed,
    terrainFingerprint(planet, seed),
    hint.latRadians.toFixed(6),
    hint.lonRadians.toFixed(6),
  ].join(':');
}

function isDryBiome(biome: Biome): boolean {
  return biome !== 'ocean' && biome !== 'beach' && biome !== 'lake';
}

function biomePreference(biome: Biome): number {
  // Prefer open testable ground over dense forest / rugged biomes.
  if (biome === 'plains') return 8_000;
  if (biome === 'desert') return 5_500;
  if (biome === 'tundra') return 4_500;
  if (biome === 'forest') return 2_000;
  if (biome === 'highlands' || biome === 'rock') return 500;
  if (biome === 'peak') return 0;
  return -5_000;
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
  let heightDeltaMeters = 0;
  for (const [dLat, dLon] of offsets) {
    const nearbyProbe = cartesianFromLatLonAlt(
      latRadians + dLat,
      lonRadians + dLon,
      0,
      planet.radiusMeters,
    );
    const nearbySurface = samplePlanetSurface(planet, seed, nearbyProbe);
    if (isDryBiome(nearbySurface.biome)) dryNeighbors += 1;
    heightDeltaMeters = Math.max(
      heightDeltaMeters,
      Math.abs(nearbySurface.heightMeters - surface.heightMeters),
    );
  }

  return {
    dryNeighbors,
    latRadians,
    lonRadians,
    surface,
    heightDeltaMeters,
  };
}

function scoreCandidate(candidate: LandingCandidate): number {
  const flatness = Math.max(0, 80 - candidate.heightDeltaMeters);
  return (
    candidate.dryNeighbors * 10_000 +
    biomePreference(candidate.surface.biome) +
    flatness * 40 +
    (1 - candidate.surface.mountainRegion) * 1_500 +
    (1 - candidate.surface.treeDensity) * 800 +
    candidate.surface.grassDensity * 200 -
    // Mild preference for moderate elevation (not beach fringe, not alpine).
    Math.abs(candidate.surface.normalizedHeight - 0.1) * 1_200
  );
}

export function resolveLandingSite(
  planet: Planet,
  seed: number,
  hint?: LandingSiteHint,
): LandingSite {
  const resolvedHint =
    hint ?? getActivePlanetConfig().document.spawnHint ?? DEFAULT_SPAWN_SITE;
  const cacheKey = makeCacheKey(planet, seed, resolvedHint);
  const cached = landingSiteCache.get(cacheKey);
  if (cached) return cached;

  let best = sampleCandidate(planet, seed, resolvedHint.latRadians, resolvedHint.lonRadians);
  const stepRadians = 0.002;
  const searchRadius = 24;

  for (let latStep = -searchRadius; latStep <= searchRadius; latStep += 1) {
    for (let lonStep = -searchRadius; lonStep <= searchRadius; lonStep += 1) {
      const candidate = sampleCandidate(
        planet,
        seed,
        resolvedHint.latRadians + latStep * stepRadians,
        resolvedHint.lonRadians + lonStep * stepRadians,
      );
      if (scoreCandidate(candidate) > scoreCandidate(best)) best = candidate;
    }
  }

  const resolved: LandingSite = {
    latRadians: best.latRadians,
    lonRadians: best.lonRadians,
  };
  landingSiteCache.set(cacheKey, resolved);
  return resolved;
}
