import {
  add,
  cross,
  dot,
  length,
  lerp,
  normalize,
  scale,
  sub,
  vec3,
} from "../math/vec3";
import {
  integrateCharacterLocomotion,
  SPRINT_SPEED_METERS_PER_SECOND,
  WALK_SPEED_METERS_PER_SECOND,
} from "./character_controller";
import {
  resolveCharacterAgainstColliders,
  type ShipColliderRigState,
} from "./colliders";
import {
  getShipLayout,
  type ShipSeatSpec,
  type ShipWalkZone,
} from "./ship_layout";
import { getShipRight, worldToShipLocal } from "./ship_interaction";
import { orientedFloorUpAt, orientedZoneContains } from "./ship_zone_oriented";
import type {
  CharacterInput,
  CharacterState,
  FlightBody,
  Pose,
  Vec3,
} from "../types";

/**
 * Walkable ship interior driven by the active ship layout (ship_layout.ts):
 * axis-aligned and oriented walk zones in ship-local right/forward meters with
 * per-zone floor heights, optional slopes (ramps, doorway steps), and gates.
 */

export type ShipZoneId = string;

export type { ShipWalkZone } from "./ship_layout";

export interface DeckLocal {
  right: number;
  forward: number;
}

export interface DeckCharacterState extends CharacterState {
  deckLocal: DeckLocal;
  deckZone: ShipZoneId;
}

const TURN_SPEED = 10;
/** Matches the offset baked into getDeckWorldPose. */
const DECK_FLOOR_OFFSET_METERS = 0.02;

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

/** Floor height within a zone; slopes interpolate along forward; stairs snap to steps. */
function zoneFloorUpAt(
  zone: ShipWalkZone,
  right: number,
  forward: number,
): number {
  if (zone.oriented) return orientedFloorUpAt(zone.oriented, right, forward);
  if (zone.slopeMinUp === undefined) return zone.floorUp;
  const span = zone.maxForward - zone.minForward;
  if (span <= 1e-6) return zone.floorUp;
  const t = clamp((forward - zone.minForward) / span, 0, 1);
  if (zone.stepCount !== undefined && zone.stepCount > 0) {
    const stepIndex = Math.min(
      zone.stepCount,
      Math.floor(t * zone.stepCount + 1e-6),
    );
    const stepT = stepIndex / zone.stepCount;
    return zone.slopeMinUp + (zone.floorUp - zone.slopeMinUp) * stepT;
  }
  return zone.slopeMinUp + (zone.floorUp - zone.slopeMinUp) * t;
}

/**
 * Floor height at a deck point. Sloped zones (ramps, doorway steps) win over
 * flat rooms where they overlap so the character glides along the slope.
 * Ladder volumes are excluded — they are F-only, not walkable surfaces.
 */
export function shipFloorUpAt(local: DeckLocal): number {
  const zones = getShipLayout().walkZones;
  let flat: ShipWalkZone | null = null;
  for (const zone of zones) {
    if (zone.ladder) continue;
    if (!zoneContains(zone, local)) continue;
    if (zone.oriented)
      return orientedFloorUpAt(zone.oriented, local.right, local.forward);
    if (zone.slopeMinUp !== undefined)
      return zoneFloorUpAt(zone, local.right, local.forward);
    flat ??= zone;
  }
  if (flat) return flat.floorUp;
  // Off every zone (transitions, dismounts): nearest zone's edge height.
  let best: { distance: number; up: number } | null = null;
  for (const zone of zones) {
    if (zone.ladder) continue;
    const right = clamp(local.right, zone.minRight, zone.maxRight);
    const forward = clamp(local.forward, zone.minForward, zone.maxForward);
    const distance = Math.hypot(right - local.right, forward - local.forward);
    if (!best || distance < best.distance) {
      best = { distance, up: zoneFloorUpAt(zone, right, forward) };
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
  if (zone.gate === "ramp") return gates.rampWalkable;
  return gates.isDoorOpen(zone.gate.doorId);
}

function zoneContains(zone: ShipWalkZone, local: DeckLocal): boolean {
  if (zone.oriented) {
    return orientedZoneContains(zone.oriented, local.right, local.forward);
  }
  return (
    local.right >= zone.minRight &&
    local.right <= zone.maxRight &&
    local.forward >= zone.minForward &&
    local.forward <= zone.maxForward
  );
}

function ladderAnchor(zone: ShipWalkZone): DeckLocal {
  return {
    right: (zone.minRight + zone.maxRight) / 2,
    forward: (zone.minForward + zone.maxForward) / 2,
  };
}

function ladderZoneAt(
  local: DeckLocal,
  gates: ShipWalkGates,
): ShipWalkZone | null {
  for (const zone of getShipLayout().walkZones) {
    if (!zone.ladder || !zoneActive(zone, gates)) continue;
    if (!zoneContains(zone, local)) continue;
    return zone;
  }
  return null;
}

function insideActiveLadder(local: DeckLocal, gates: ShipWalkGates): boolean {
  return ladderZoneAt(local, gates) !== null;
}

/** Walkable zones for normal movement; ladder volumes are F-only traversals. */
function findWalkZone(
  local: DeckLocal,
  gates: ShipWalkGates,
): ShipWalkZone | null {
  let passage: ShipWalkZone | null = null;
  let flat: ShipWalkZone | null = null;
  for (const zone of getShipLayout().walkZones) {
    if (!zoneActive(zone, gates)) continue;
    if (zone.ladder) continue;
    if (!zoneContains(zone, local)) continue;
    if (zone.passage) {
      passage ??= zone;
      continue;
    }
    if (zone.slopeMinUp !== undefined) return zone;
    flat ??= zone;
  }
  return flat ?? passage;
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
    {
      right: state.deckLocal.right + deltaRight,
      forward: state.deckLocal.forward + deltaForward,
    },
    {
      right: state.deckLocal.right + deltaRight,
      forward: state.deckLocal.forward,
    },
    {
      right: state.deckLocal.right,
      forward: state.deckLocal.forward + deltaForward,
    },
  ];
  for (const candidate of candidates) {
    if (insideActiveLadder(candidate, gates)) continue;
    const zone = findWalkZone(candidate, gates);
    if (zone) {
      return {
        local: candidate,
        zone: zone.passage ? state.deckZone : zone.id,
      };
    }
  }
  return { local: state.deckLocal, zone: state.deckZone };
}

function resolveDeckColliderStep(
  resolved: ResolvedDeckStep,
  gates: ShipWalkGates,
  colliderRig: ShipColliderRigState | undefined,
): ResolvedDeckStep {
  const colliders = getShipLayout().colliders;
  if (colliders.length === 0) return resolved;
  const adjusted = resolveCharacterAgainstColliders({
    right: resolved.local.right,
    forward: resolved.local.forward,
    floorUp: shipFloorUpAt(resolved.local),
    colliders,
    rig: colliderRig,
    isAllowed: (local) =>
      !insideActiveLadder(local, gates) && findWalkZone(local, gates) !== null,
  });
  if (
    Math.abs(adjusted.right - resolved.local.right) < 1e-6 &&
    Math.abs(adjusted.forward - resolved.local.forward) < 1e-6
  ) {
    return resolved;
  }
  const zone = findWalkZone(adjusted, gates);
  if (!zone) return resolved;
  return {
    local: adjusted,
    zone: zone.passage ? resolved.zone : zone.id,
  };
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

function rotateToward(
  currentForward: Vec3,
  desiredForward: Vec3,
  up: Vec3,
  dt: number,
): Vec3 {
  if (length(desiredForward) < 1e-6) return normalize(currentForward);
  const current = normalize(tangentize(currentForward, up));
  const desired = normalize(tangentize(desiredForward, up));
  const mixed = normalize(lerp(current, desired, clamp(dt * TURN_SPEED, 0, 1)));
  if (length(mixed) < 1e-6) return desired;
  return mixed;
}

function localDistance(
  a: DeckLocal,
  b: { right: number; forward: number },
): number {
  return Math.hypot(a.right - b.right, a.forward - b.forward);
}

export function getDeckWorldPose(ship: FlightBody, local: DeckLocal): Pose {
  const right = getShipRight(ship);
  const floorUp = shipFloorUpAt(local) + DECK_FLOOR_OFFSET_METERS;
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
    animation: "Idle_Loop",
    deckLocal: { ...spot },
    deckZone: zone ?? findZoneIdAt(spot),
    forward: pose.forward,
    grounded: true,
    jumpPhase: "grounded",
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity: vec3(0, 0, 0),
  };
}

/** Non-gated zone lookup for spawn placement (ignores ramp/door state). */
function findZoneIdAt(local: DeckLocal): ShipZoneId {
  const zones = getShipLayout().walkZones;
  const hit = zones.find(
    (zone) =>
      !zone.gate && !zone.passage && !zone.ladder && zoneContains(zone, local),
  );
  return (
    (hit ?? zones.find((zone) => !zone.ladder && zoneContains(zone, local)))
      ?.id ?? "cabin"
  );
}

/**
 * Safe initial deck spawn: the seat-stand spot when it lies inside an
 * always-walkable zone, otherwise the center of the first ungated zone —
 * a spawn outside every zone would freeze the character (steps only resolve
 * into containing zones).
 */
export function getDefaultDeckSpawnLocal(): DeckLocal {
  const layout = getShipLayout();
  const pilot = layout.seats.find((seat) => seat.role === "pilot");
  const stand = pilot?.stand ?? layout.seatStand;
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
  return {
    ...pose,
    forward: normalize(tangentize(scale(ship.forward, -1), ship.up)),
  };
}

/** Prompt anchor sits just in front of the stand spot so you interact standing. */
const SEAT_INTERACT_FORWARD_OFFSET = 0.35;

function seatInteractPoint(seat: ShipSeatSpec): {
  right: number;
  forward: number;
} {
  const deltaRight = seat.seat.right - seat.stand.right;
  const deltaForward = seat.seat.forward - seat.stand.forward;
  const len = Math.hypot(deltaRight, deltaForward);
  if (len < 1e-4) {
    return {
      right: seat.stand.right,
      forward: seat.stand.forward + SEAT_INTERACT_FORWARD_OFFSET,
    };
  }
  const backset = Math.min(0.55, len * 0.35);
  return {
    right: seat.stand.right + (deltaRight / len) * backset,
    forward: seat.stand.forward + (deltaForward / len) * backset,
  };
}

/** Nearest authored seat within interact reach, or null. */
export function nearestSeat(deckLocal: DeckLocal): ShipSeatSpec | null {
  let best: { seat: ShipSeatSpec; distance: number } | null = null;
  for (const seat of getShipLayout().seats) {
    const anchor = seatInteractPoint(seat);
    const distance = localDistance(deckLocal, anchor);
    if (distance > seat.interactRadius) continue;
    if (!best || distance < best.distance) best = { seat, distance };
  }
  return best?.seat ?? null;
}

export function seatInteractPrompt(seat: ShipSeatSpec, interactLabel = "F"): string {
  switch (seat.role) {
    case "pilot":
      return `Press ${interactLabel} — take the seat`;
    case "copilot":
      return `Press ${interactLabel} — take the copilot seat`;
    case "turret":
      return `Press ${interactLabel} — man the turret`;
    default:
      return `Press ${interactLabel} — sit down`;
  }
}

/** True when near an authored pilot seat (not legacy fallback anchors). */
export function canReturnToPilot(deckLocal: DeckLocal): boolean {
  const nearby = nearestSeat(deckLocal);
  return nearby?.role === "pilot";
}
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
      panel.placement === "deck" &&
      localDistance(deckLocal, panel) <= panel.radius,
  );
}

export const LADDER_INTERACT_RADIUS = 1.45;
const LADDER_TRAVERSE_EPSILON = 0.15;

export type LadderDirection = "up" | "down";

export function ladderEndLocal(
  zone: ShipWalkZone,
  end: "bottom" | "top",
): DeckLocal {
  return {
    right: (zone.minRight + zone.maxRight) / 2,
    forward: end === "bottom" ? zone.minForward : zone.maxForward,
  };
}

function resolveLadderTraverseTarget(
  zone: ShipWalkZone,
  direction: LadderDirection,
  deckZone: ShipZoneId,
  gates: ShipWalkGates,
): ResolvedDeckStep | null {
  const anchor = ladderAnchor(zone);
  const forward =
    direction === "up"
      ? zone.maxForward + LADDER_TRAVERSE_EPSILON
      : zone.minForward - LADDER_TRAVERSE_EPSILON;
  const candidate: DeckLocal = { right: anchor.right, forward };
  const hit = findWalkZone(candidate, gates);
  if (!hit) return null;
  return {
    local: candidate,
    zone: hit.passage ? deckZone : hit.id,
  };
}

/** Nearest ladder end within interact reach, or null. */
export function resolveLadderInteraction(
  deckLocal: DeckLocal,
  gates: ShipWalkGates,
  deckZone: ShipZoneId = "cabin",
): { zone: ShipWalkZone; direction: LadderDirection } | null {
  let best: {
    zone: ShipWalkZone;
    direction: LadderDirection;
    distance: number;
  } | null = null;

  for (const zone of getShipLayout().walkZones) {
    if (!zone.ladder || !zoneActive(zone, gates)) continue;

    const bottomDist = localDistance(deckLocal, ladderEndLocal(zone, "bottom"));
    if (
      bottomDist <= LADDER_INTERACT_RADIUS &&
      resolveLadderTraverseTarget(zone, "up", deckZone, gates)
    ) {
      if (!best || bottomDist < best.distance) {
        best = { zone, direction: "up", distance: bottomDist };
      }
    }

    const topDist = localDistance(deckLocal, ladderEndLocal(zone, "top"));
    if (
      topDist <= LADDER_INTERACT_RADIUS &&
      resolveLadderTraverseTarget(zone, "down", deckZone, gates)
    ) {
      if (!best || topDist < best.distance) {
        best = { zone, direction: "down", distance: topDist };
      }
    }
  }

  return best ? { zone: best.zone, direction: best.direction } : null;
}

export function ladderInteractPrompt(direction: LadderDirection, interactLabel = "F"): string {
  return direction === "up"
    ? `Press ${interactLabel} to go up`
    : `Press ${interactLabel} to go down`;
}

/** Snap the character to the opposite ladder end on a connected walk zone. */
export function traverseLadder(
  state: DeckCharacterState,
  zone: ShipWalkZone,
  direction: LadderDirection,
  gates: ShipWalkGates,
  ship: FlightBody,
): DeckCharacterState | null {
  const target = resolveLadderTraverseTarget(
    zone,
    direction,
    state.deckZone,
    gates,
  );
  if (!target) return null;
  const pose = getDeckWorldPose(ship, target.local);
  return {
    ...state,
    animation: "Idle_Loop",
    deckLocal: target.local,
    deckZone: target.zone,
    forward: pose.forward,
    grounded: true,
    jumpPhase: "grounded",
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity: vec3(0, 0, 0),
  };
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
  gravityMetersPerSecond2: number,
  colliderRig?: ShipColliderRigState,
): DeckUpdateResult {
  const moveX = input.moveX ?? 0;
  const moveY = input.moveY ?? 0;
  const wantsSprint = Boolean(input.sprint);
  const desiredDirection = deckMovementDirection(
    ship,
    moveX,
    moveY,
    input.cameraYawRadians ?? 0,
  );
  const moveMagnitude = Math.min(1, Math.hypot(moveX, moveY));
  const moveSpeed =
    (wantsSprint
      ? SPRINT_SPEED_METERS_PER_SECOND
      : WALK_SPEED_METERS_PER_SECOND) * moveMagnitude;

  const right = getShipRight(ship);
  const up = ship.up;
  const deckForward = normalize(tangentize(ship.forward, up));
  const desiredFacing = input.faceCameraYaw
    ? deckCameraForward(ship, input.cameraYawRadians ?? 0)
    : desiredDirection;

  let resolved: ResolvedDeckStep = {
    local: state.deckLocal,
    zone: state.deckZone,
  };
  const isMoving = moveMagnitude > 0.08;

  const motion = integrateCharacterLocomotion(
    state,
    {
      wantsJump: Boolean(input.jumpPressed),
      wantsSprint,
      isMoving,
      desiredDirection,
      moveSpeed,
    },
    dt,
    up,
    gravityMetersPerSecond2,
    {
      onGroundedStep: () => {
        if (isMoving && !insideActiveLadder(state.deckLocal, gates)) {
          const step = scale(desiredDirection, moveSpeed * dt);
          resolved = resolveDeckStep(
            state,
            dot(step, right),
            dot(step, deckForward),
            gates,
          );
        } else {
          resolved = { local: state.deckLocal, zone: state.deckZone };
        }
        resolved = resolveDeckColliderStep(resolved, gates, colliderRig);
        const pose = getDeckWorldPose(ship, resolved.local);
        return { position: pose.position, up: pose.up };
      },
      tryLand: (candidate) => {
        const local = worldToShipLocal(ship, candidate);
        const floorUp =
          shipFloorUpAt({ right: local.right, forward: local.forward }) +
          DECK_FLOOR_OFFSET_METERS;
        if (local.up > floorUp) return null;
        const landedLocal = { right: local.right, forward: local.forward };
        if (insideActiveLadder(landedLocal, gates)) return null;
        const zone = findWalkZone(landedLocal, gates);
        resolved = {
          local: landedLocal,
          zone: zone
            ? zone.passage
              ? state.deckZone
              : zone.id
            : state.deckZone,
        };
        resolved = resolveDeckColliderStep(resolved, gates, colliderRig);
        const pose = getDeckWorldPose(ship, resolved.local);
        return { position: pose.position, up: pose.up };
      },
    },
  );

  let forward = rotateToward(state.forward, desiredFacing, motion.up, dt);
  if (length(forward) < 1e-6) {
    forward = normalize(tangentize(state.forward, motion.up));
  } else {
    forward = normalize(tangentize(forward, motion.up));
  }

  const layout = getShipLayout();
  const resolvedZone = getShipWalkZone(resolved.zone);
  const dismounted =
    motion.grounded &&
    resolvedZone?.gate === "ramp" &&
    resolved.local.forward <= layout.rampDismountForward;

  return {
    dismounted,
    state: {
      animation: motion.animation,
      deckLocal: resolved.local,
      deckZone: resolved.zone,
      forward,
      grounded: motion.grounded,
      jumpPhase: motion.jumpPhase,
      jumpPhaseTime: motion.jumpPhaseTime,
      position: motion.position,
      up: motion.up,
      velocity: motion.velocity,
    },
  };
}
