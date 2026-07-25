import type { Biome, Planet, PlanetSurfaceSample, WaterBody } from '../types';
import { biomeDisplayName } from './climate';
import { oceanWaterLevelMeters } from './coastal_profile';
import { cartesianFromLatLonAlt, latLonForPosition } from './coordinates';
import { samplePlanetSurface } from './planet_surface';
import { riverCenterlineDirectionAt } from './rivers';
import { getActivePlanetConfig } from './planets/runtime';

export type SurfaceDestination = Biome | 'coast' | 'lake' | 'river';

/** Land biomes plus walkable geographic feature destinations. */
export const SURFACE_DESTINATION_TARGETS: readonly SurfaceDestination[] = [
  'plains',
  'forest',
  'desert',
  'tundra',
  'coast',
  'highlands',
  'peak',
  'lake',
  'river',
] as const;

const LAND_MAX_ATTEMPTS = 768;
const FEATURE_MAX_ATTEMPTS = 4_096;
const visitCounters = new Map<SurfaceDestination, number>();

const SITE_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.707, 0.707],
  [0.707, -0.707],
  [-0.707, 0.707],
  [-0.707, -0.707],
];

interface SurfaceLocation {
  latRadians: number;
  lonRadians: number;
}

interface ShoreCandidate extends SurfaceLocation {
  dryReliefMeters: number;
  surface: PlanetSurfaceSample;
  waterNeighbors: number;
  waterDistanceMeters: number;
}

export interface SurfaceDestinationLocation extends SurfaceLocation {
  destination: SurfaceDestination;
}

function hash01(seed: number, ...values: number[]): number {
  let state = seed >>> 0;
  for (const value of values) {
    state ^= value + 0x9e3779b9 + ((state << 6) >>> 0) + (state >>> 2);
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
    state >>>= 0;
  }
  state ^= state >>> 16;
  state = Math.imul(state, 0x85ebca6b) >>> 0;
  state ^= state >>> 13;
  state = Math.imul(state, 0xc2b2ae35) >>> 0;
  state ^= state >>> 16;
  return (state >>> 0) / 0x1_0000_0000;
}

function offsetLocation(
  planet: Planet,
  location: SurfaceLocation,
  northMeters: number,
  eastMeters: number,
): SurfaceLocation {
  return {
    latRadians: location.latRadians + northMeters / planet.radiusMeters,
    lonRadians:
      location.lonRadians +
      eastMeters /
        (planet.radiusMeters * Math.max(Math.cos(location.latRadians), 0.1)),
  };
}

function sampleLocation(
  planet: Planet,
  seed: number,
  location: SurfaceLocation,
): PlanetSurfaceSample {
  return samplePlanetSurface(
    planet,
    seed,
    cartesianFromLatLonAlt(
      location.latRadians,
      location.lonRadians,
      0,
      planet.radiusMeters,
    ),
  );
}

function targetWaterBody(destination: SurfaceDestination): WaterBody | null {
  if (destination === 'coast') return 'ocean';
  if (destination === 'lake' || destination === 'river') return destination;
  return null;
}

function sampleLatLon(
  planet: Planet,
  seed: number,
  visit: number,
  attempt: number,
  destination: SurfaceDestination,
): SurfaceLocation {
  if (destination === 'river') {
    const direction = riverCenterlineDirectionAt(
      planet,
      seed,
      attempt + visit * 997,
    );
    if (direction) return latLonForPosition(direction);
  }
  const v = hash01(seed, visit, attempt, 2);
  const lonRadians = (v * 2 - 1) * Math.PI;
  if (destination === 'tundra') {
    const u = hash01(seed, visit, attempt, 1);
    const arcticLatMin =
      getActivePlanetConfig().biomes.arcticLatitudeStart * (Math.PI / 2);
    const sinMin = Math.sin(arcticLatMin);
    const sinLat = sinMin + u * (1 - sinMin);
    const hemisphere = hash01(seed, visit, attempt, 3) < 0.5 ? -1 : 1;
    return {
      latRadians: hemisphere * Math.asin(Math.min(1, Math.max(sinMin, sinLat))),
      lonRadians,
    };
  }
  const u = hash01(seed, visit, attempt, 1);
  return {
    latRadians: Math.asin(Math.min(1, Math.max(-1, 2 * u - 1))),
    lonRadians,
  };
}

function measureDryRelief(
  planet: Planet,
  seed: number,
  location: SurfaceLocation,
  center: PlanetSurfaceSample,
): number {
  let minimumHeight = center.heightMeters;
  let maximumHeight = center.heightMeters;
  for (const [north, east] of SITE_DIRECTIONS) {
    const nearby = sampleLocation(
      planet,
      seed,
      offsetLocation(planet, location, north * 75, east * 75),
    );
    if (nearby.waterBody != null) continue;
    minimumHeight = Math.min(minimumHeight, nearby.heightMeters);
    maximumHeight = Math.max(maximumHeight, nearby.heightMeters);
  }
  return maximumHeight - minimumHeight;
}

function measureWaterNeighbors(
  planet: Planet,
  seed: number,
  location: SurfaceLocation,
  waterBody: WaterBody,
  distanceMeters: number,
): number {
  let count = 0;
  for (const [north, east] of SITE_DIRECTIONS) {
    const nearby = sampleLocation(
      planet,
      seed,
      offsetLocation(
        planet,
        location,
        north * distanceMeters,
        east * distanceMeters,
      ),
    );
    if (nearby.waterBody === waterBody) count += 1;
  }
  return count;
}

function findDryShoreCandidate(
  planet: Planet,
  seed: number,
  waterLocation: SurfaceLocation,
  waterBody: WaterBody,
): ShoreCandidate | null {
  let best: ShoreCandidate | null = null;
  let bestScore = -Infinity;
  const searchRingsMeters = [75, 150, 300, 600, 1_200] as const;

  for (const distanceMeters of searchRingsMeters) {
    for (const [north, east] of SITE_DIRECTIONS) {
      const location = offsetLocation(
        planet,
        waterLocation,
        north * distanceMeters,
        east * distanceMeters,
      );
      const surface = sampleLocation(planet, seed, location);
      if (surface.waterBody != null) continue;
      const waterNeighbors = measureWaterNeighbors(
        planet,
        seed,
        location,
        waterBody,
        Math.max(75, Math.min(300, distanceMeters)),
      );
      if (waterNeighbors === 0) continue;
      const dryReliefMeters = measureDryRelief(planet, seed, location, surface);
      const score = waterNeighbors * 30 - dryReliefMeters * 8 - distanceMeters * 0.02;
      if (score <= bestScore) continue;
      bestScore = score;
      best = {
        ...location,
        dryReliefMeters,
        surface,
        waterDistanceMeters: distanceMeters,
        waterNeighbors,
      };
    }
    if (best && best.dryReliefMeters <= 20 && best.waterNeighbors >= 2) break;
  }
  return best;
}

function scoreLandSite(destination: Biome, surface: PlanetSurfaceSample): number {
  if (destination === 'tundra') {
    let score = 10;
    score += Math.min(Math.max(surface.normalizedHeight - 0.03, 0), 0.35) * 40;
    if (surface.normalizedHeight < 0.025) score -= 80;
    score += (0.28 - surface.temperature) * 35;
    score -= surface.mountainRegion * 8;
    return score;
  }
  if (destination === 'highlands' || destination === 'peak') {
    return surface.normalizedHeight * 20 + surface.mountainRegion * 10;
  }
  return 1;
}

function scoreShoreSite(destination: SurfaceDestination, candidate: ShoreCandidate): number {
  let score =
    candidate.waterNeighbors * 20 -
    candidate.dryReliefMeters * 25 -
    candidate.waterDistanceMeters * 0.02;
  if (destination === 'coast') {
    const oceanLevel = oceanWaterLevelMeters();
    score -= Math.abs(candidate.surface.heightMeters - (oceanLevel + 3)) * 8;
    score -= Math.max(
      oceanLevel + 1.5 - candidate.surface.heightMeters,
      0,
    ) * 1_000;
  }
  return score;
}

export function surfaceDestinationDisplayName(destination: SurfaceDestination): string {
  if (destination === 'coast') return 'coast';
  if (destination === 'lake' || destination === 'river') return destination;
  return biomeDisplayName(destination);
}

function findLandDestination(
  planet: Planet,
  seed: number,
  destination: Biome,
  visit: number,
): SurfaceDestinationLocation | null {
  let best: SurfaceDestinationLocation | null = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < LAND_MAX_ATTEMPTS; attempt += 1) {
    const location = sampleLatLon(planet, seed, visit, attempt, destination);
    if (!Number.isFinite(location.latRadians) || !Number.isFinite(location.lonRadians)) continue;
    const surface = sampleLocation(planet, seed, location);
    if (surface.waterBody != null || surface.biome !== destination) continue;
    const score = scoreLandSite(destination, surface);
    if (score > bestScore) {
      bestScore = score;
      best = { destination, ...location };
    }
  }
  return best;
}

function findHydrologyDestination(
  planet: Planet,
  seed: number,
  destination: 'coast' | 'lake' | 'river',
  waterBody: WaterBody,
  visit: number,
): SurfaceDestinationLocation | null {
  let best: SurfaceDestinationLocation | null = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < FEATURE_MAX_ATTEMPTS; attempt += 1) {
    const location = sampleLatLon(planet, seed, visit, attempt, destination);
    if (!Number.isFinite(location.latRadians) || !Number.isFinite(location.lonRadians)) continue;
    const surface = sampleLocation(planet, seed, location);
    if (surface.waterBody !== waterBody) continue;
    const shore = findDryShoreCandidate(planet, seed, location, waterBody);
    if (!shore) continue;
    const score = scoreShoreSite(destination, shore);
    if (score > bestScore) {
      bestScore = score;
      best = {
        destination,
        latRadians: shore.latRadians,
        lonRadians: shore.lonRadians,
      };
      const walkableShore = shore.dryReliefMeters <= 20 && shore.waterNeighbors >= 2;
      const usefulCoastHeight =
        destination !== 'coast' ||
        (shore.surface.heightMeters >= oceanWaterLevelMeters() + 1.5 &&
          shore.surface.heightMeters <= oceanWaterLevelMeters() + 12);
      if (walkableShore && usefulCoastHeight) return best;
    }
  }
  return best;
}

/** Find walkable land in a biome or beside a generated hydrology feature. */
export function findSurfaceDestination(
  planet: Planet,
  seed: number,
  destination: SurfaceDestination,
): SurfaceDestinationLocation | null {
  const visit = visitCounters.get(destination) ?? 0;
  visitCounters.set(destination, visit + 1);
  return findSurfaceDestinationVariant(planet, seed, destination, visit);
}

/** Deterministic variant lookup for authoring tools and reproducible diagnostics. */
export function findSurfaceDestinationVariant(
  planet: Planet,
  seed: number,
  destination: SurfaceDestination,
  visit: number,
): SurfaceDestinationLocation | null {
  const waterBody = targetWaterBody(destination);
  return waterBody == null
    ? findLandDestination(planet, seed, destination as Biome, visit)
    : findHydrologyDestination(
        planet,
        seed,
        destination as 'coast' | 'lake' | 'river',
        waterBody,
        visit,
      );
}
