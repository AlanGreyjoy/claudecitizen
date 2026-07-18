import { cartesianFromLatLonAlt } from './coordinates';
import { resolveLandingSite } from './landing_sites';
import { samplePlanetSurface } from './planet_surface';
import { getActivePlanetConfig } from './planets/runtime';
import type { Biome, Planet, Vec3 } from '../types';
import {
  getActiveSystemDocument,
  getSystemStationEntriesForPlanetDocument,
  resolveStationAltitudeMeters,
} from './systems/runtime';
import { orbitHintFromSystemOffset } from './station';
import type { SystemPlanetEntry, SystemStationEntry } from './systems/schema';

const OP1_SURFACE_OFFSET_METERS = 90_000;
const PAD_OFFSET_METERS = 3;
const POI_COUNT = 12;
const MAX_DRY_ATTEMPTS = 48;

/** Stand-off outside the station hull along the orbital altitude. */
const STATION_APPROACH_EXTRA_METERS = 2_000;

export type QuantumDestinationKind = 'surface-poi' | 'system-station' | 'system-planet';

export interface QuantumDestination {
  id: string;
  name: string;
  latRadians: number;
  lonRadians: number;
  kind: QuantumDestinationKind;
  /** Orbital altitude for stations; surface POIs omit this and use terrain height. */
  altitudeMeters?: number;
  /** Planet document id for handoff destinations. */
  planetDocumentId?: string;
  /** When true, quantum completes with a planet activation handoff. */
  handoff?: boolean;
}

/** Legacy id for the first outpost near the landing site. */
export const SPIKE_QUANTUM_DESTINATION_ID = 'asteron-op-1';

export function systemStationDestinationId(stationInstanceId: string): string {
  return `sys-station:${stationInstanceId}`;
}

export function systemPlanetDestinationId(planetEntryId: string): string {
  return `sys-planet:${planetEntryId}`;
}

const destinationListCache = new Map<string, QuantumDestination[]>();
const destinationPositionCache = new WeakMap<Planet, Map<string, Vec3>>();

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

function isDryBiome(biome: Biome): boolean {
  return biome !== 'ocean' && biome !== 'lake';
}

function sampleBiome(planet: Planet, seed: number, latRadians: number, lonRadians: number): Biome {
  const probe = cartesianFromLatLonAlt(latRadians, lonRadians, 0, planet.radiusMeters);
  return samplePlanetSurface(planet, seed, probe).biome;
}

function resolveOp1Placement(planet: Planet, seed: number): QuantumDestination {
  const landing = resolveLandingSite(planet, seed);
  const offsetRadians = OP1_SURFACE_OFFSET_METERS / planet.radiusMeters;
  let latRadians = landing.latRadians;
  let lonRadians = landing.lonRadians + offsetRadians;

  if (!isDryBiome(sampleBiome(planet, seed, latRadians, lonRadians))) {
    latRadians = landing.latRadians + offsetRadians * 0.35;
    lonRadians = landing.lonRadians + offsetRadians;
  }

  return {
    id: SPIKE_QUANTUM_DESTINATION_ID,
    name: 'Asteron OP-1',
    latRadians,
    lonRadians,
    kind: 'surface-poi',
  };
}

function pickDryLatLon(
  planet: Planet,
  seed: number,
  index: number,
): { latRadians: number; lonRadians: number } {
  for (let attempt = 0; attempt < MAX_DRY_ATTEMPTS; attempt += 1) {
    const u = hash01(seed, index, attempt, 1);
    const v = hash01(seed, index, attempt, 2);
    const latRadians = Math.asin(2 * u - 1);
    const lonRadians = (v * 2 - 1) * Math.PI;
    if (isDryBiome(sampleBiome(planet, seed, latRadians, lonRadians))) {
      return { latRadians, lonRadians };
    }
  }

  const landing = resolveLandingSite(planet, seed);
  const nudge = ((index + 1) * 120_000) / planet.radiusMeters;
  return {
    latRadians: landing.latRadians + nudge * 0.4,
    lonRadians: landing.lonRadians + nudge,
  };
}

function siteName(index: number): string {
  if (index === 0) return 'Asteron OP-1';
  return `Asteron Site ${String(index + 1).padStart(2, '0')}`;
}

function siteId(index: number): string {
  if (index === 0) return SPIKE_QUANTUM_DESTINATION_ID;
  return `asteron-site-${String(index + 1).padStart(2, '0')}`;
}

function generateAsteronPois(planet: Planet, seed: number): QuantumDestination[] {
  const destinations: QuantumDestination[] = [resolveOp1Placement(planet, seed)];

  for (let index = 1; index < POI_COUNT; index += 1) {
    const { latRadians, lonRadians } = pickDryLatLon(planet, seed, index);
    destinations.push({
      id: siteId(index),
      name: siteName(index),
      latRadians,
      lonRadians,
      kind: 'surface-poi',
    });
  }

  return destinations;
}

function stationDestination(station: SystemStationEntry): QuantumDestination {
  const hint = orbitHintFromSystemOffset(
    station.offsetMeters,
    resolveStationAltitudeMeters(station),
  );
  return {
    id: systemStationDestinationId(station.id),
    name: station.name,
    latRadians: hint.latRadians,
    lonRadians: hint.lonRadians,
    kind: 'system-station',
    altitudeMeters: hint.altitudeMeters + STATION_APPROACH_EXTRA_METERS,
  };
}

function planetDestination(
  entry: SystemPlanetEntry,
  activePlanetDocumentId: string,
): QuantumDestination {
  const isActive = entry.planetId === activePlanetDocumentId;
  return {
    id: systemPlanetDestinationId(entry.id),
    name: entry.name ?? entry.planetId,
    latRadians: 0,
    lonRadians: 0,
    kind: 'system-planet',
    planetDocumentId: entry.planetId,
    handoff: !isActive,
    altitudeMeters: isActive ? undefined : 250_000,
  };
}

/** System Map bodies that participate in Nav / quantum. */
export function listSystemQuantumDestinations(
  activePlanetDocumentId: string,
): QuantumDestination[] {
  const system = getActiveSystemDocument();
  const destinations: QuantumDestination[] = [];
  for (const planet of system.planets) {
    destinations.push(planetDestination(planet, activePlanetDocumentId));
  }
  for (const station of getSystemStationEntriesForPlanetDocument(system, activePlanetDocumentId)) {
    destinations.push(stationDestination(station));
  }
  return destinations;
}

function listSurfaceDestinations(planet: Planet, seed: number): QuantumDestination[] {
  const cacheKey = `${planet.name}:${seed}`;
  const cached = destinationListCache.get(cacheKey);
  if (cached) return cached;

  const destinations = generateAsteronPois(planet, seed);
  destinationListCache.set(cacheKey, destinations);
  return destinations;
}

export function listQuantumDestinations(planet: Planet, seed: number): QuantumDestination[] {
  const activeId = getActivePlanetConfig().planetId;
  return [
    ...listSurfaceDestinations(planet, seed),
    ...listSystemQuantumDestinations(activeId),
  ];
}

export function getQuantumDestination(
  planet: Planet,
  seed: number,
  id: string,
): QuantumDestination | null {
  return listQuantumDestinations(planet, seed).find((dest) => dest.id === id) ?? null;
}

export function destinationWorldPosition(
  planet: Planet,
  seed: number,
  destination: QuantumDestination,
): Vec3 {
  let planetCache = destinationPositionCache.get(planet);
  if (!planetCache) {
    planetCache = new Map<string, Vec3>();
    destinationPositionCache.set(planet, planetCache);
  }
  const cacheKey = `${seed}:${destination.id}:${destination.latRadians}:${destination.lonRadians}:${destination.altitudeMeters ?? 'surface'}`;
  const cached = planetCache.get(cacheKey);
  if (cached) return cached;

  if (destination.altitudeMeters != null) {
    const position = cartesianFromLatLonAlt(
      destination.latRadians,
      destination.lonRadians,
      destination.altitudeMeters,
      planet.radiusMeters,
    );
    planetCache.set(cacheKey, position);
    return position;
  }

  const probe = cartesianFromLatLonAlt(
    destination.latRadians,
    destination.lonRadians,
    0,
    planet.radiusMeters,
  );
  const surface = samplePlanetSurface(planet, seed, probe);
  const position = cartesianFromLatLonAlt(
    destination.latRadians,
    destination.lonRadians,
    surface.heightMeters + PAD_OFFSET_METERS,
    planet.radiusMeters,
  );
  planetCache.set(cacheKey, position);
  return position;
}
