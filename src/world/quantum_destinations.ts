import { cartesianFromLatLonAlt } from './coordinates';
import { resolveLandingSite } from './landing_sites';
import { samplePlanetSurface } from './planet_surface';
import type { Planet, Vec3 } from '../types';

const OP1_SURFACE_OFFSET_METERS = 90_000;
const OP1_PAD_OFFSET_METERS = 3;

export interface QuantumDestination {
  id: string;
  name: string;
  latRadians: number;
  lonRadians: number;
}

const ASTERON_OP1: QuantumDestination = {
  id: 'asteron-op-1',
  name: 'Asteron OP-1 (Outpost 1)',
  latRadians: 0,
  lonRadians: 0,
};

const destinationCache = new Map<string, QuantumDestination>();

function resolveOp1Placement(planet: Planet, seed: number): QuantumDestination {
  const cacheKey = `${planet.name}:${seed}`;
  const cached = destinationCache.get(cacheKey);
  if (cached) return cached;

  const landing = resolveLandingSite(planet, seed);
  const offsetRadians = OP1_SURFACE_OFFSET_METERS / planet.radiusMeters;
  let latRadians = landing.latRadians;
  let lonRadians = landing.lonRadians + offsetRadians;

  const probe = cartesianFromLatLonAlt(latRadians, lonRadians, 0, planet.radiusMeters);
  const surface = samplePlanetSurface(planet, seed, probe);
  if (surface.biome === 'ocean' || surface.biome === 'lake') {
    latRadians = landing.latRadians + offsetRadians * 0.35;
    lonRadians = landing.lonRadians + offsetRadians;
  }

  const resolved: QuantumDestination = {
    id: ASTERON_OP1.id,
    name: ASTERON_OP1.name,
    latRadians,
    lonRadians,
  };
  destinationCache.set(cacheKey, resolved);
  return resolved;
}

export function listQuantumDestinations(planet: Planet, seed: number): QuantumDestination[] {
  return [resolveOp1Placement(planet, seed)];
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
  const probe = cartesianFromLatLonAlt(
    destination.latRadians,
    destination.lonRadians,
    0,
    planet.radiusMeters,
  );
  const surface = samplePlanetSurface(planet, seed, probe);
  return cartesianFromLatLonAlt(
    destination.latRadians,
    destination.lonRadians,
    surface.heightMeters + OP1_PAD_OFFSET_METERS,
    planet.radiusMeters,
  );
}

export const SPIKE_QUANTUM_DESTINATION_ID = ASTERON_OP1.id;
