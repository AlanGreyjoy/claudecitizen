import { add, cross, dot, length, lerp, normalize, scale, sub, vec3 } from '../math/vec3';
import { getShipLayout, type ShipWalkZone } from './ship_layout';
import { getShipRight } from './ship_interaction';
import type { CharacterInput, CharacterState, FlightBody, Pose, Vec3 } from '../types';

/**
 * Walkable ship interior driven by the active ship layout (ship_layout.ts):
 * axis-aligned zones in ship-local right/forward meters with per-zone floor
 * heights, optional slopes (ramps, doorway steps), and gates (boarding ramp,
 * doors). The default layout is the Phobos Starhopper measured from its rig.
 */

export type ShipZoneId = string;

export type { ShipWalkZone } from './ship_layout';

export interface DeckLocal {
  right: number;
  forward: number;
}

export interface DeckCharacterState extends CharacterState {
  deckLocal: DeckLocal;
  deckZone: ShipZoneId;
}

const WALK_SPEED_METERS_PER_SECOND = 4.2;
const SPRINT_SPEED_METERS_PER_SECOND = 7.9;
const TURN_SPEED = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tangentize(vector: Vec3, up: Vec3): Vec3 {
  return sub(vector, scale(up, dot(vector, up)));
}

export function getShipWalkZones(): ShipWalkZone[] {
  return getShipLayout().walkZones;
}

export function getShipWalkZone(zoneId: string): ShipWalkZone | null {
  return getShipLayout().walkZones.find((zone) => zone.id === zoneId) ?? null;
}

/** Floor height within a zone; slopes interpolate along forward. */
function zoneFloorUpAt(zone: ShipWalkZone, forward: number): number {
  if (zone.slopeMinUp === undefined) return zone.floorUp;
  const span = zone.maxForward - zone.minForward;
  if (span <= 1e-6) return zone.floorUp;
  const t = clamp((forward - zone.minForward) / span, 0, 1);
  return zone.slopeMinUp + (zone.floorUp - zone.slopeMinUp) * t;
}

/**
 * Floor height at a deck point. Sloped zones (ramps, doorway steps) win over
 * flat rooms where they overlap so the character glides along the slope.
 */
export function shipFloorUpAt(local: DeckLocal): number {
  const zones = getShipLayout().walkZones;
  let flat: ShipWalkZone | null = null;
  for (const zone of zones) {
    if (!zoneContains(zone, local)) continue;
    if (zone.slopeMinUp !== undefined) return zoneFloorUpAt(zone, local.forward);
    flat ??= zone;
  }
  if (flat) return flat.floorUp;
  // Off every zone (transitions, dismounts): nearest zone's edge height.
  let best: { distance: number; up: number } | null = null;
  for (const zone of zones) {
    const right = clamp(local.right, zone.minRight, zone.maxRight);
    const forward = clamp(local.forward, zone.minForward, zone.maxForward);
    const distance = Math.hypot(right - local.right, forward - local.forward);
    if (!best || distance < best.distance) {
      best = { distance, up: zoneFloorUpAt(zone, forward) };
    }
  }
  return best?.up ?? 0;
}

export interface ShipWalkGates {
  /** Ramp lowered and the ship parked, so the ramp is a walkable surface. */
  rampWalkable: boolean;
  /** Whether the given prefab door is open enough to pass through. */
  isDoorOpen: (doorId: string) => boolean;
}

function zoneActive(zone: ShipWalkZone, gates: ShipWalkGates): boolean {
  if (zone.gate === undefined) return true;
  if (zone.gate === 'ramp') return gates.rampWalkable;
  return gates.isDoorOpen(zone.gate.doorId);
}

function zoneContains(zone: ShipWalkZone, local: DeckLocal): boolean {
  return (
    local.right >= zone.minRight &&
    local.right <= zone.maxRight &&
    local.forward >= zone.minForward &&
    local.forward <= zone.maxForward
  );
}

/** Real rooms win over passages so deckZone tracks a camera-safe box. */
function findZone(local: DeckLocal, gates: ShipWalkGates): ShipWalkZone | null {
  let passage: ShipWalkZone | null = null;
  for (const zone of getShipLayout().walkZones) {
    if (!zoneActive(zone, gates)) continue;
    if (!zoneContains(zone, local)) continue;
    if (zone.passage) {
      passage ??= zone;
      continue;
    }
    return zone;
  }
  return passage;
}

interface ResolvedDeckStep {
  local: DeckLocal;
  zone: ShipZoneId;
}

function resolveDeckStep(
  state: DeckCharacterState,
  deltaRight: number,
  deltaForward: number,
  gates: ShipWalkGates,
): ResolvedDeckStep {
  const candidates: DeckLocal[] = [
    { right: state.deckLocal.right + deltaRight, forward: state.deckLocal.forward + deltaForward },
    { right: state.deckLocal.right + deltaRight, forward: state.deckLocal.forward },
    { right: state.deckLocal.right, forward: state.deckLocal.forward + deltaForward },
  ];
  for (const candidate of candidates) {
    const zone = findZone(candidate, gates);
    if (zone) {
      return {
        local: candidate,
        zone: zone.passage ? state.deckZone : zone.id,
      };
    }
  }
  return { local: state.deckLocal, zone: state.deckZone };
}

function deckCameraForward(ship: FlightBody, cameraYawRadians: number): Vec3 {
  const up = ship.up;
  const right = getShipRight(ship);
  const deckForward = normalize(tangentize(ship.forward, up));
  const deckYawRadians = -cameraYawRadians;
  return normalize(
    add(
      scale(deckForward, Math.cos(deckYawRadians)),
      scale(right, Math.sin(deckYawRadians)),
    ),
  );
}

function deckMovementDirection(
  ship: FlightBody,
  moveX: number,
  moveY: number,
  cameraYawRadians: number,
): Vec3 {
  const up = ship.up;
  const cameraForward = deckCameraForward(ship, cameraYawRadians);
  const cameraRight = normalize(cross(cameraForward, up));
  const desired = add(scale(cameraRight, moveX), scale(cameraForward, moveY));
  const tangentDesired = tangentize(desired, up);
  if (length(tangentDesired) < 1e-6) return vec3(0, 0, 0);
  return normalize(tangentDesired);
}

function rotateToward(currentForward: Vec3, desiredForward: Vec3, up: Vec3, dt: number): Vec3 {
  if (length(desiredForward) < 1e-6) return normalize(currentForward);
  const current = normalize(tangentize(currentForward, up));
  const desired = normalize(tangentize(desiredForward, up));
  const mixed = normalize(lerp(current, desired, clamp(dt * TURN_SPEED, 0, 1)));
  if (length(mixed) < 1e-6) return desired;
  return mixed;
}

function localDistance(a: DeckLocal, b: { right: number; forward: number }): number {
  return Math.hypot(a.right - b.right, a.forward - b.forward);
}

export function getDeckWorldPose(ship: FlightBody, local: DeckLocal): Pose {
  const right = getShipRight(ship);
  const floorUp = shipFloorUpAt(local) + 0.02;
  const position = add(
    add(ship.position, scale(right, local.right)),
    add(scale(ship.up, floorUp), scale(ship.forward, local.forward)),
  );
  return {
    forward: normalize(tangentize(ship.forward, ship.up)),
    position,
    up: ship.up,
  };
}

export function createDeckCharacterState(
  ship: FlightBody,
  local?: DeckLocal,
  zone?: ShipZoneId,
): DeckCharacterState {
  const layout = getShipLayout();
  const spot = local ?? layout.seatStand;
  const pose = getDeckWorldPose(ship, spot);
  return {
    animation: 'Idle_Loop',
    deckLocal: { ...spot },
    deckZone: zone ?? findZoneIdAt(spot),
    forward: pose.forward,
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity: vec3(0, 0, 0),
  };
}

/** Non-gated zone lookup for spawn placement (ignores ramp/door state). */
function findZoneIdAt(local: DeckLocal): ShipZoneId {
  const zones = getShipLayout().walkZones;
  const hit = zones.find((zone) => !zone.passage && zoneContains(zone, local));
  return (hit ?? zones[0])?.id ?? 'cabin';
}

/**
 * Safe initial deck spawn: the seat-stand spot when it lies inside an
 * always-walkable zone, otherwise the center of the first ungated zone —
 * a spawn outside every zone would freeze the character (steps only resolve
 * into containing zones).
 */
export function getDefaultDeckSpawnLocal(): DeckLocal {
  const layout = getShipLayout();
  const stand = layout.seatStand;
  const zones = layout.walkZones;
  const standWalkable = zones.some(
    (zone) => !zone.gate && !zone.passage && zoneContains(zone, stand),
  );
  if (standWalkable) return { ...stand };
  const home = zones.find((zone) => !zone.gate && !zone.passage) ?? zones[0];
  if (!home) return { ...stand };
  return {
    right: (home.minRight + home.maxRight) / 2,
    forward: (home.minForward + home.maxForward) / 2,
  };
}

export function getLeavePilotStandPose(ship: FlightBody): Pose {
  const pose = getDeckWorldPose(ship, getShipLayout().seatStand);
  // Standing up out of the chair, you face back into the cabin.
  return { ...pose, forward: normalize(tangentize(scale(ship.forward, -1), ship.up)) };
}

export function nearChair(deckLocal: DeckLocal): boolean {
  const chair = getShipLayout().chairInteract;
  return localDistance(deckLocal, chair) <= chair.radius;
}

/** Nearest door whose interact anchor is within reach, or null. */
export function nearestDoor(deckLocal: DeckLocal): { doorId: string } | null {
  let best: { doorId: string; distance: number } | null = null;
  for (const door of getShipLayout().doors) {
    const distance = localDistance(deckLocal, {
      right: door.interact.right,
      forward: door.interact.forward,
    });
    if (distance > door.radius) continue;
    if (!best || distance < best.distance) best = { doorId: door.id, distance };
  }
  return best ? { doorId: best.doorId } : null;
}

export function nearRampPanel(deckLocal: DeckLocal): boolean {
  return getShipLayout().rampInteracts.some(
    (panel) =>
      panel.placement === 'deck' &&
      localDistance(deckLocal, panel) <= panel.radius,
  );
}

export function canReturnToPilot(deckLocal: DeckLocal): boolean {
  const layout = getShipLayout();
  return nearChair(deckLocal) && deckLocal.forward > layout.pilotSeat.forward - 2.4;
}

export interface DeckUpdateResult {
  state: DeckCharacterState;
  /** Set when the character walked off the bottom of the lowered ramp. */
  dismounted: boolean;
}

export function updateCharacterOnDeck(
  state: DeckCharacterState,
  ship: FlightBody,
  gates: ShipWalkGates,
  input: CharacterInput,
  dt: number,
): DeckUpdateResult {
  const moveX = input.moveX ?? 0;
  const moveY = input.moveY ?? 0;
  const wantsSprint = Boolean(input.sprint);
  const desiredDirection = deckMovementDirection(ship, moveX, moveY, input.cameraYawRadians ?? 0);
  const moveMagnitude = Math.min(1, Math.hypot(moveX, moveY));
  const moveSpeed =
    (wantsSprint ? SPRINT_SPEED_METERS_PER_SECOND : WALK_SPEED_METERS_PER_SECOND) * moveMagnitude;

  const right = getShipRight(ship);
  const up = ship.up;
  const desiredFacing = input.faceCameraYaw
    ? deckCameraForward(ship, input.cameraYawRadians ?? 0)
    : desiredDirection;
  let forward = rotateToward(state.forward, desiredFacing, up, dt);

  let resolved: ResolvedDeckStep = { local: state.deckLocal, zone: state.deckZone };
  if (moveMagnitude > 0.08) {
    const step = scale(desiredDirection, moveSpeed * dt);
    resolved = resolveDeckStep(
      state,
      dot(step, right),
      dot(step, normalize(tangentize(ship.forward, up))),
      gates,
    );
  }

  const layout = getShipLayout();
  const resolvedZone = getShipWalkZone(resolved.zone);
  const dismounted =
    resolvedZone?.gate === 'ramp' && resolved.local.forward <= layout.rampDismountForward;

  const pose = getDeckWorldPose(ship, resolved.local);
  const velocity = dt > 0 ? scale(sub(pose.position, state.position), 1 / dt) : vec3(0, 0, 0);
  const isMoving = moveMagnitude > 0.08;
  const animation = isMoving && wantsSprint ? 'Sprint_Loop' : isMoving ? 'Walk_Loop' : 'Idle_Loop';

  if (length(forward) < 1e-6) {
    forward = normalize(tangentize(state.forward, up));
  } else {
    forward = normalize(tangentize(forward, up));
  }

  return {
    dismounted,
    state: {
      animation,
      deckLocal: resolved.local,
      deckZone: resolved.zone,
      forward,
      grounded: true,
      jumpPhase: 'grounded',
      jumpPhaseTime: 0,
      position: pose.position,
      up: pose.up,
      velocity,
    },
  };
}
