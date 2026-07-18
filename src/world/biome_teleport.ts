import type { Biome, Planet } from '../types';
import { cartesianFromLatLonAlt } from './coordinates';
import { samplePlanetSurface } from './planet_surface';

/** Land + hydrology biomes useful for Planet Authoring surface playtest. */
export const BIOME_TELEPORT_TARGETS: readonly Biome[] = [
  'plains',
  'forest',
  'desert',
  'tundra',
  'beach',
  'highlands',
  'peak',
  'lake',
  'river',
] as const;

const MAX_ATTEMPTS = 320;
const visitCounters = new Map<Biome, number>();

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
  // Final XOR is a signed int32 in JS; force uint32 before normalizing.
  return (state >>> 0) / 0x1_0000_0000;
}

export interface BiomeTeleportLocation {
  biome: Biome;
  latRadians: number;
  lonRadians: number;
}

/**
 * Find a surface lat/lon classified as `biome`. Bounded random sphere sampling —
 * safe for a button click, not for the frame loop. Repeated calls rotate the
 * visit salt so QA can hop between different sites of the same biome.
 */
export function findBiomeLocation(
  planet: Planet,
  seed: number,
  biome: Biome,
): BiomeTeleportLocation | null {
  const visit = visitCounters.get(biome) ?? 0;
  visitCounters.set(biome, visit + 1);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const u = hash01(seed, visit, attempt, 1);
    const v = hash01(seed, visit, attempt, 2);
    const latRadians = Math.asin(Math.min(1, Math.max(-1, 2 * u - 1)));
    const lonRadians = (v * 2 - 1) * Math.PI;
    if (!Number.isFinite(latRadians) || !Number.isFinite(lonRadians)) continue;
    const probe = cartesianFromLatLonAlt(latRadians, lonRadians, 0, planet.radiusMeters);
    const surface = samplePlanetSurface(planet, seed, probe);
    if (
      surface.biome === biome &&
      Number.isFinite(surface.heightMeters) &&
      Number.isFinite(surface.surfaceRadiusMeters)
    ) {
      return { biome, latRadians, lonRadians };
    }
  }

  return null;
}
