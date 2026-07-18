import { cross, distance, dot, length, lerp, normalize, scale, sub, vec3 } from '../math/vec3';
import {
  altitudeForPosition,
  eastVector,
  radialUp,
} from '../world/coordinates';
import {
  destinationWorldPosition,
  getQuantumDestination,
  listQuantumDestinations,
  SPIKE_QUANTUM_DESTINATION_ID,
  systemPlanetDestinationId,
  systemStationDestinationId,
  type QuantumDestination,
} from '../world/quantum_destinations';
import type { FlightBody, Planet, Vec3 } from '../types';
import type { ShipFlightMode } from './flight_modes';
import { FLIGHT_CONFIG } from './flight_config';
import { clearNavRoute, getNavRoute } from './nav_route';

export interface NavDestinationMarker {
  id: string;
  name: string;
  position: Vec3;
}

export const MIN_QUANTUM_DISTANCE_METERS = 50_000;
export const MAX_ALIGNMENT_DOT = Math.cos((15 * Math.PI) / 180);
export const QUANTUM_ENGAGE_HOLD_SECONDS = 2;
export const QUANTUM_SPOOL_BASE_SECONDS = 3;
export const QUANTUM_SPOOL_DISTANCE_SCALE = 1 / 100_000;
export const QUANTUM_SPOOL_MAX_SECONDS = 6;
export const QUANTUM_DROP_OUT_SECONDS = 1.2;

export type QuantumPhase = 'idle' | 'spooling' | 'traveling' | 'dropOut';

export type QuantumBlockReason =
  | 'not-nav-mode'
  | 'in-atmosphere'
  | 'too-close'
  | 'too-far'
  | 'no-destination'
  | 'already-traveling'
  | 'misaligned'
  | 'already-here';

export interface QuantumRoute {
  startDir: Vec3;
  endDir: Vec3;
  startAlt: number;
  endAlt: number;
  progress: number;
  travelDuration: number;
}

export interface QuantumTravelState {
  phase: QuantumPhase;
  destinationId: string | null;
  route: QuantumRoute | null;
  spoolElapsed: number;
  spoolDuration: number;
  dropOutElapsed: number;
  entryFlash: number;
  exitFlash: number;
  /** Set when drop-out completes a planet handoff; consumed by play/game loop. */
  pendingHandoffPlanetId: string | null;
}

export interface QuantumEligibilityContext {
  body: FlightBody;
  flightMode: ShipFlightMode;
  quantum: QuantumTravelState;
  planet: Planet;
  seed: number;
  destinationId?: string | null;
}

export function createQuantumTravelState(): QuantumTravelState {
  return {
    phase: 'idle',
    destinationId: null,
    route: null,
    spoolElapsed: 0,
    spoolDuration: 0,
    dropOutElapsed: 0,
    entryFlash: 0,
    exitFlash: 0,
    pendingHandoffPlanetId: null,
  };
}

export function atmosphereFactorForPosition(position: Vec3, planet: Planet): number {
  const altitudeMeters = altitudeForPosition(position, planet.radiusMeters);
  return Math.max(0, 1 - Math.max(0, altitudeMeters) / planet.atmosphereHeightMeters);
}

export function isOutsideAtmosphere(position: Vec3, planet: Planet): boolean {
  return atmosphereFactorForPosition(position, planet) <= FLIGHT_CONFIG.SPACE_ATMOSPHERE_THRESHOLD;
}

function slerpDirection(a: Vec3, b: Vec3, t: number): Vec3 {
  const dotVal = Math.max(-1, Math.min(1, dot(a, b)));
  const omega = Math.acos(dotVal);
  if (omega < 1e-6) return normalize(lerp(a, b, t));
  const sinOmega = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / sinOmega;
  const wb = Math.sin(t * omega) / sinOmega;
  return normalize(
    vec3(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb),
  );
}

function planarForward(body: FlightBody): Vec3 {
  const up = radialUp(body.position);
  const forward = sub(body.forward, scale(up, dot(body.forward, up)));
  if (length(forward) < 1e-6) return eastVector(body.position);
  return normalize(forward);
}

function bearingToDestination(body: FlightBody, destination: Vec3): Vec3 {
  const up = radialUp(body.position);
  const toDest = sub(destination, body.position);
  const planar = sub(toDest, scale(up, dot(toDest, up)));
  if (length(planar) < 1e-6) return planarForward(body);
  return normalize(planar);
}

function alignmentDot(body: FlightBody, destination: Vec3): number {
  return dot(planarForward(body), bearingToDestination(body, destination));
}

function spoolDurationForDistance(distanceMeters: number): number {
  return Math.min(
    QUANTUM_SPOOL_MAX_SECONDS,
    QUANTUM_SPOOL_BASE_SECONDS + distanceMeters * QUANTUM_SPOOL_DISTANCE_SCALE,
  );
}

function travelDurationForDistance(distanceMeters: number): number {
  return Math.max(8, Math.min(20, distanceMeters / 15_000));
}

export function spikeDestinationId(): string {
  return SPIKE_QUANTUM_DESTINATION_ID;
}

/** Map HaloBand Set Route target → quantum destination id. */
export function quantumDestinationIdFromNavRoute(): string | null {
  const route = getNavRoute();
  if (!route) return null;
  if (route.kind === 'system-station') return systemStationDestinationId(route.id);
  if (route.kind === 'system-planet') return systemPlanetDestinationId(route.id);
  if (route.kind === 'surface-poi') return route.id;
  return null;
}

/**
 * Pick the destination the ship nose is most aligned with (planar bearing).
 * Prefers an active System Map route when set.
 */
export function resolveNavDestinationId(
  body: FlightBody,
  planet: Planet,
  seed: number,
): string | null {
  const routed = quantumDestinationIdFromNavRoute();
  if (routed && getQuantumDestination(planet, seed, routed)) {
    return routed;
  }

  const destinations = listQuantumDestinations(planet, seed).filter(
    (dest) => !(dest.kind === 'system-planet' && !dest.handoff),
  );
  if (destinations.length === 0) return null;

  let bestId: string | null = null;
  let bestDot = -Infinity;
  for (const dest of destinations) {
    const position = destinationWorldPosition(planet, seed, dest);
    const align = alignmentDot(body, position);
    if (align > bestDot) {
      bestDot = align;
      bestId = dest.id;
    }
  }
  return bestId;
}

export function resolveLockedDestinationId(
  flightMode: ShipFlightMode,
  quantum: QuantumTravelState,
  body?: FlightBody,
  planet?: Planet,
  seed?: number,
): string | null {
  if (quantum.destinationId) return quantum.destinationId;
  if (flightMode !== 'nav') return null;
  if (body && planet !== undefined && seed !== undefined) {
    return resolveNavDestinationId(body, planet, seed);
  }
  return SPIKE_QUANTUM_DESTINATION_ID;
}

export function evaluateQuantumEligibility(
  ctx: QuantumEligibilityContext,
): { ok: true; destinationId: string } | { ok: false; reason: QuantumBlockReason } {
  if (ctx.quantum.phase !== 'idle') {
    return { ok: false, reason: 'already-traveling' };
  }
  if (ctx.flightMode !== 'nav') {
    return { ok: false, reason: 'not-nav-mode' };
  }
  const destinationId =
    ctx.destinationId ?? resolveNavDestinationId(ctx.body, ctx.planet, ctx.seed);
  if (!destinationId) {
    return { ok: false, reason: 'no-destination' };
  }
  const destination = getQuantumDestination(ctx.planet, ctx.seed, destinationId);
  if (!destination) {
    return { ok: false, reason: 'no-destination' };
  }
  if (destination.kind === 'system-planet' && !destination.handoff) {
    return { ok: false, reason: 'already-here' };
  }
  if (!isOutsideAtmosphere(ctx.body.position, ctx.planet)) {
    return { ok: false, reason: 'in-atmosphere' };
  }
  if (destination.handoff) {
    // Interplanetary handoff: no live body to align toward — engage when routed + in space.
    return { ok: true, destinationId };
  }
  const destPosition = destinationWorldPosition(ctx.planet, ctx.seed, destination);
  const dist = distance(ctx.body.position, destPosition);
  if (dist < MIN_QUANTUM_DISTANCE_METERS) {
    return { ok: false, reason: 'too-close' };
  }
  if (alignmentDot(ctx.body, destPosition) < MAX_ALIGNMENT_DOT) {
    return { ok: false, reason: 'misaligned' };
  }
  return { ok: true, destinationId };
}

export function quantumBlockReasonLabel(reason: QuantumBlockReason): string {
  switch (reason) {
    case 'not-nav-mode':
      return 'Switch to Nav mode (tap U)';
    case 'in-atmosphere':
      return 'Outside atmosphere required';
    case 'too-close':
      return `Too close (min ${Math.round(MIN_QUANTUM_DISTANCE_METERS / 1000)} km)`;
    case 'too-far':
      return 'Destination out of range';
    case 'no-destination':
      return 'No quantum destination';
    case 'already-traveling':
      return 'Quantum drive active';
    case 'misaligned':
      return 'Align toward destination';
    case 'already-here':
      return 'Already at that planet';
  }
}

export function buildNavPrompt(ctx: QuantumEligibilityContext): string {
  if (ctx.quantum.phase === 'spooling') return 'Spooling…';
  if (ctx.quantum.phase === 'traveling') return 'Quantum travel';
  if (ctx.quantum.phase === 'dropOut') return 'Drop out';

  const eligibility = evaluateQuantumEligibility(ctx);
  if (eligibility.ok) {
    const destination = getQuantumDestination(
      ctx.planet,
      ctx.seed,
      eligibility.destinationId,
    );
    const shortName = destination?.name ?? 'destination';
    return `Hold U (2s) · Quantum to ${shortName}`;
  }

  if (eligibility.reason === 'misaligned') {
    const bestId = resolveNavDestinationId(ctx.body, ctx.planet, ctx.seed);
    const destination = bestId
      ? getQuantumDestination(ctx.planet, ctx.seed, bestId)
      : null;
    if (destination) {
      return `Nav · Align toward ${destination.name}`;
    }
  }

  return `Nav · ${quantumBlockReasonLabel(eligibility.reason)}`;
}

export function tryBeginQuantumTravel(
  quantum: QuantumTravelState,
  body: FlightBody,
  planet: Planet,
  seed: number,
  destinationId: string,
): QuantumTravelState {
  const destination = getQuantumDestination(planet, seed, destinationId);
  if (!destination) return quantum;

  let endPosition = destinationWorldPosition(planet, seed, destination);
  // Handoff targets have no live world body — travel outward then reload planet.
  if (destination.handoff) {
    const bearing = planarForward(body);
    endPosition = {
      x: body.position.x + bearing.x * 400_000,
      y: body.position.y + bearing.y * 400_000,
      z: body.position.z + bearing.z * 400_000,
    };
  }

  const dist = distance(body.position, endPosition);
  const startDir = normalize(body.position);
  const endDir = normalize(endPosition);
  const startAlt = altitudeForPosition(body.position, planet.radiusMeters);
  const endAlt = altitudeForPosition(endPosition, planet.radiusMeters);

  return {
    ...quantum,
    phase: 'spooling',
    destinationId,
    route: {
      startDir,
      endDir,
      startAlt,
      endAlt,
      progress: 0,
      travelDuration: travelDurationForDistance(dist),
    },
    spoolElapsed: 0,
    spoolDuration: spoolDurationForDistance(dist),
    dropOutElapsed: 0,
    entryFlash: 0,
    exitFlash: 0,
    pendingHandoffPlanetId: null,
  };
}

function positionAlongRoute(route: QuantumRoute, planet: Planet, progress: number): Vec3 {
  const dir = slerpDirection(route.startDir, route.endDir, progress);
  const alt = route.startAlt + (route.endAlt - route.startAlt) * progress;
  return scale(dir, planet.radiusMeters + alt);
}

function routeTangent(route: QuantumRoute, planet: Planet, progress: number): Vec3 {
  const epsilon = 0.001;
  const a = positionAlongRoute(route, planet, Math.max(0, progress - epsilon));
  const b = positionAlongRoute(route, planet, Math.min(1, progress + epsilon));
  return normalize(sub(b, a));
}

function orientToward(body: FlightBody, targetForward: Vec3, blend: number): FlightBody {
  const up = radialUp(body.position);
  const blended = normalize(lerp(body.forward, targetForward, blend));
  const planar = sub(blended, scale(up, dot(blended, up)));
  const forward = length(planar) > 1e-6 ? normalize(planar) : eastVector(body.position);
  const right = normalize(cross(forward, up));
  const shipUp = normalize(cross(right, forward));
  return { ...body, forward, up: shipUp };
}

export interface QuantumAdvanceResult {
  body: FlightBody;
  quantum: QuantumTravelState;
  screenFade: number;
}

export function advanceQuantumTravel(
  body: FlightBody,
  quantum: QuantumTravelState,
  dt: number,
  planet: Planet,
  seed: number,
): QuantumAdvanceResult {
  let nextQuantum = quantum;
  let nextBody = body;
  let screenFade = 0;

  if (quantum.phase === 'idle' || !quantum.route) {
    return { body, quantum, screenFade: 0 };
  }

  const route = quantum.route;
  const destination = quantum.destinationId
    ? getQuantumDestination(planet, seed, quantum.destinationId)
    : null;
  const endPosition = destination
    ? destinationWorldPosition(planet, seed, destination)
    : null;

  if (quantum.phase === 'spooling') {
    const spoolElapsed = quantum.spoolElapsed + dt;
    const spoolT = Math.min(1, spoolElapsed / Math.max(quantum.spoolDuration, 0.001));
    if (endPosition) {
      const targetBearing = bearingToDestination(body, endPosition);
      nextBody = orientToward(body, targetBearing, Math.min(1, dt * 2.5));
    }
    nextBody = {
      ...nextBody,
      velocity: scale(nextBody.velocity, Math.max(0, 1 - dt * 6)),
    };
    screenFade = Math.min(0.35, spoolT * 0.35);

    if (spoolElapsed >= quantum.spoolDuration) {
      nextQuantum = {
        ...quantum,
        phase: 'traveling',
        spoolElapsed,
        entryFlash: 1,
      };
      screenFade = 0.55;
    } else {
      nextQuantum = { ...quantum, spoolElapsed };
    }
    return { body: nextBody, quantum: nextQuantum, screenFade };
  }

  if (quantum.phase === 'traveling') {
    const progress = Math.min(1, route.progress + dt / Math.max(route.travelDuration, 0.001));
    const position = positionAlongRoute(route, planet, progress);
    const tangent = routeTangent(route, planet, progress);
    const nominalSpeed =
      distance(body.position, endPosition ?? position) / route.travelDuration;
    const up = radialUp(position);
    const right = normalize(cross(tangent, up));
    const shipUp = normalize(cross(right, tangent));

    nextBody = {
      ...nextBody,
      position,
      forward: tangent,
      up: shipUp,
      velocity: scale(tangent, nominalSpeed),
      grounded: false,
    };

    const entryFlash = Math.max(0, quantum.entryFlash - dt * 2.5);
    screenFade = entryFlash > 0 ? entryFlash * 0.7 : 0.15;

    if (progress >= 1) {
      nextQuantum = {
        ...quantum,
        phase: 'dropOut',
        route: { ...route, progress: 1 },
        dropOutElapsed: 0,
        entryFlash: 0,
        exitFlash: 1,
      };
      // Cover the first destination frame so terrain/water can repopulate
      // behind the hyperspace shell before the drop-out reveal begins.
      screenFade = 0.85;
    } else {
      nextQuantum = {
        ...quantum,
        route: { ...route, progress },
        entryFlash,
      };
    }
    return { body: nextBody, quantum: nextQuantum, screenFade };
  }

  if (quantum.phase === 'dropOut') {
    const dropOutElapsed = quantum.dropOutElapsed + dt;
    const dropT = Math.min(1, dropOutElapsed / QUANTUM_DROP_OUT_SECONDS);
    if (endPosition) {
      nextBody = {
        ...nextBody,
        position: endPosition,
        velocity: scale(nextBody.velocity, Math.max(0, 1 - dropT)),
        grounded: dropT > 0.85,
      };
      nextBody = orientToward(nextBody, bearingToDestination(nextBody, endPosition), dropT);
    }
    const exitFlash = Math.max(0, 1 - dropT);
    screenFade = exitFlash * 0.85;

    if (dropOutElapsed >= QUANTUM_DROP_OUT_SECONDS) {
      const handoffPlanetId =
        destination?.handoff && destination.planetDocumentId
          ? destination.planetDocumentId
          : null;
      if (!handoffPlanetId) {
        clearNavRoute();
      }
      nextQuantum = {
        ...createQuantumTravelState(),
        pendingHandoffPlanetId: handoffPlanetId,
      };
    } else {
      nextQuantum = { ...quantum, dropOutElapsed, exitFlash };
    }
    return { body: nextBody, quantum: nextQuantum, screenFade };
  }

  return { body, quantum, screenFade: 0 };
}

export function listNavDestinationMarkers(
  planet: Planet,
  seed: number,
): NavDestinationMarker[] {
  const routedId = quantumDestinationIdFromNavRoute();
  const destinations = listQuantumDestinations(planet, seed).filter((dest) => {
    if (dest.kind === 'system-planet' && !dest.handoff) return false;
    // Always show the active route; otherwise surface POIs + local stations.
    if (routedId && dest.id === routedId) return true;
    if (dest.kind === 'system-station') return true;
    if (dest.kind === 'surface-poi') return true;
    if (dest.handoff && dest.id === routedId) return true;
    return false;
  });

  return destinations.map((dest) => ({
    id: dest.id,
    name: dest.name,
    position: destinationWorldPosition(planet, seed, dest),
  }));
}

export function consumePendingHandoffPlanetId(
  quantum: QuantumTravelState,
): { quantum: QuantumTravelState; planetId: string | null } {
  const planetId = quantum.pendingHandoffPlanetId;
  if (!planetId) return { quantum, planetId: null };
  return {
    quantum: { ...quantum, pendingHandoffPlanetId: null },
    planetId,
  };
}

export type { QuantumDestination };
