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
  CHARACTER_COLLIDER_RADIUS_METERS,
  colliderPenetrationPushMagnitude,
  resolveCharacterAgainstColliders,
  sampleColliderGroundHeight,
  sampleColliderGroundHeightForAnimation,
  type ShipColliderRigState,
} from "../physics/colliders";
import {
  getShipLayout,
  usesColliderDeck,
  type ShipCameraBounds,
  type ShipSeatSpec,
  type ShipWalkZone,
} from "./ship_layout";
import {
  atShipGroundLevel,
  getShipRight,
  worldToShipLocal,
} from "./ship_interaction";
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
  /** Consecutive frames airborne with no deck collider below (collider-deck ships). */
  airborneOffDeckFrames?: number;
}

const TURN_SPEED = 10;
/** Matches the offset baked into getDeckWorldPose. */
const DECK_FLOOR_OFFSET_METERS = 0.02;
/** Max vertical step between collider floor samples when walking. */
const COLLIDER_STEP_HEIGHT_METERS = 0.55;
const COLLIDER_GROUND_PROBE_MARGIN = 0.75;
/** Fallback probe height when character ship-local up is unknown. */
const COLLIDER_GROUND_PROBE_FALLBACK_UP = 1.5;
/** Airborne frames below deck before auto-dismount (collider-deck ships). */
const AIRBORNE_OFF_DECK_DISMOUNT_FRAMES = 6;

function probeColliderDeckFloor(
  local: DeckLocal,
  rig?: ShipColliderRigState,
  probeUp?: number,
): number | null {
  return sampleColliderGroundHeight(
    local.right,
    colliderProbeUp(probeUp),
    local.forward,
    getShipLayout().colliders,
    rig,
  );
}

function lowestCameraBoundFloor(): number {
  const bounds = getShipLayout().cameraBounds;
  if (bounds.length === 0) return -Infinity;
  let lowest = Infinity;
  for (const bound of bounds) {
    const floor =
      bound.slopeMinUp !== undefined
        ? Math.min(bound.floorUp, bound.slopeMinUp)
        : bound.floorUp;
    if (floor < lowest) lowest = floor;
  }
  return lowest;
}

function deckSpawnCandidates(): DeckLocal[] {
  const layout = getShipLayout();
  const candidates: DeckLocal[] = [];
  if (layout.deckSpawn) candidates.push({ ...layout.deckSpawn });
  const pilot = layout.seats.find((seat) => seat.role === "pilot");
  if (pilot) {
    candidates.push({ right: pilot.stand.right, forward: pilot.stand.forward });
  }
  for (const bound of layout.cameraBounds) {
    if (bound.openToOutside) continue;
    candidates.push({
      right: (bound.minRight + bound.maxRight) / 2,
      forward: (bound.minForward + bound.maxForward) / 2,
    });
  }
  candidates.push({ right: 0, forward: 0 });
  return candidates;
}

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
function colliderProbeUp(localUp?: number): number {
  return (localUp ?? COLLIDER_GROUND_PROBE_FALLBACK_UP) + COLLIDER_GROUND_PROBE_MARGIN;
}

export function shipFloorUpAt(
  local: DeckLocal,
  rig?: ShipColliderRigState,
  localUp?: number,
): number {
  if (usesColliderDeck()) {
    const floor = colliderFloorAt(local, rig, localUp);
    return floor ?? 0;
  }
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

function cameraBoundContains(bound: ShipCameraBounds, local: DeckLocal): boolean {
  return (
    local.right >= bound.minRight &&
    local.right <= bound.maxRight &&
    local.forward >= bound.minForward &&
    local.forward <= bound.maxForward
  );
}

function findCameraBoundAt(local: DeckLocal): ShipCameraBounds | null {
  const bounds = getShipLayout().cameraBounds;
  for (const bound of bounds) {
    if (cameraBoundContains(bound, local)) return bound;
  }
  let best: { bound: ShipCameraBounds; distance: number } | null = null;
  for (const bound of bounds) {
    const right = clamp(local.right, bound.minRight, bound.maxRight);
    const forward = clamp(local.forward, bound.minForward, bound.maxForward);
    const distance = Math.hypot(right - local.right, forward - local.forward);
    if (!best || distance < best.distance) {
      best = { bound, distance };
    }
  }
  return best?.bound ?? null;
}

function isStandingOnRampCollider(
  local: DeckLocal,
  rig: ShipColliderRigState | undefined,
  localUp?: number,
): boolean {
  return (
    sampleColliderGroundHeightForAnimation(
      local.right,
      colliderProbeUp(localUp),
      local.forward,
      getShipLayout().colliders,
      "ramp",
      rig,
    ) !== null
  );
}

export function isOnShipRampDeck(
  deckLocal: DeckLocal,
  deckZone: ShipZoneId,
  rig: ShipColliderRigState | undefined,
): boolean {
  if (usesColliderDeck()) {
    return isStandingOnRampCollider(deckLocal, rig);
  }
  return getShipWalkZone(deckZone)?.gate === "ramp";
}

function colliderFloorAt(
  local: DeckLocal,
  rig: ShipColliderRigState | undefined,
  localUp?: number,
): number | null {
  return sampleColliderGroundHeight(
    local.right,
    colliderProbeUp(localUp),
    local.forward,
    getShipLayout().colliders,
    rig,
  );
}

function canStandOnCollider(
  local: DeckLocal,
  currentFloor: number | null,
  rig: ShipColliderRigState | undefined,
  localUp?: number,
): boolean {
  const inRamp = isStandingOnRampCollider(local, rig, localUp);
  // Probe from known deck height so horizontal wall slides still find the floor mesh.
  const probeFrom = currentFloor ?? localUp;
  const floor = colliderFloorAt(local, rig, probeFrom);
  if (floor === null) return false;
  if (currentFloor === null) return true;
  const stepLimit = inRamp ? 0.95 : COLLIDER_STEP_HEIGHT_METERS;
  if (floor <= currentFloor + 0.04) return true;
  return floor - currentFloor <= stepLimit;
}

/** Looser floor check for wall-slide destinations (mesh lips, wall edges). */
function canSlideOnColliderDeck(
  local: DeckLocal,
  fromLocal: DeckLocal,
  currentFloor: number | null,
  rig: ShipColliderRigState | undefined,
  localUp?: number,
): boolean {
  if (canStandOnCollider(local, currentFloor, rig, localUp)) return true;
  if (currentFloor === null) return false;
  const floor = colliderFloorAt(local, rig, currentFloor);
  if (floor !== null) {
    const stepLimit = COLLIDER_STEP_HEIGHT_METERS + 0.1;
    if (floor <= currentFloor + 0.08) return true;
    if (floor - currentFloor <= stepLimit) return true;
  }
  const slide = Math.hypot(
    local.right - fromLocal.right,
    local.forward - fromLocal.forward,
  );
  if (slide > CHARACTER_COLLIDER_RADIUS_METERS + 0.1) return false;
  return colliderFloorAt(fromLocal, rig, currentFloor) !== null;
}

function resolveColliderDeckStep(
  state: DeckCharacterState,
  deltaRight: number,
  deltaForward: number,
  rig: ShipColliderRigState | undefined,
  localUp?: number,
): ResolvedDeckStep {
  const currentFloor = colliderFloorAt(state.deckLocal, rig, localUp);
  const colliders = getShipLayout().colliders;
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
    if (!canStandOnCollider(candidate, currentFloor, rig, localUp)) continue;
    const floorAtCandidate =
      colliderFloorAt(candidate, rig, currentFloor ?? localUp) ?? currentFloor;
    const afterCollision = resolveCharacterAgainstColliders({
      right: candidate.right,
      forward: candidate.forward,
      floorUp: floorAtCandidate ?? 0,
      colliders,
      rig,
      isAllowed: (local) =>
        canSlideOnColliderDeck(local, candidate, currentFloor, rig, localUp),
    });
    if (
      !canSlideOnColliderDeck(
        afterCollision,
        candidate,
        currentFloor,
        rig,
        localUp,
      )
    ) {
      continue;
    }
    const bound = findCameraBoundAt(afterCollision);
    return {
      local: afterCollision,
      zone: bound?.id ?? state.deckZone,
    };
  }
  return { local: state.deckLocal, zone: state.deckZone };
}

function resolveDeckColliderStep(
  resolved: ResolvedDeckStep,
  gates: ShipWalkGates,
  colliderRig: ShipColliderRigState | undefined,
  localUp?: number,
  fallbackLocal?: DeckLocal,
): ResolvedDeckStep {
  const colliders = getShipLayout().colliders;
  if (colliders.length === 0) return resolved;
  const fromLocal = resolved.local;
  const currentFloor = usesColliderDeck()
    ? colliderFloorAt(fromLocal, colliderRig, localUp)
    : shipFloorUpAt(fromLocal, colliderRig, localUp);
  const beforePen = usesColliderDeck()
    ? colliderPenetrationPushMagnitude({
        right: fromLocal.right,
        forward: fromLocal.forward,
        floorUp: currentFloor ?? 0,
        colliders,
        rig: colliderRig,
      })
    : 0;
  const adjusted = resolveCharacterAgainstColliders({
    right: fromLocal.right,
    forward: fromLocal.forward,
    floorUp: currentFloor ?? 0,
    colliders,
    rig: colliderRig,
    isAllowed: (local) =>
      usesColliderDeck()
        ? canSlideOnColliderDeck(
            local,
            fromLocal,
            currentFloor,
            colliderRig,
            localUp,
          )
        : !insideActiveLadder(local, gates) && findWalkZone(local, gates) !== null,
  });
  if (usesColliderDeck()) {
    const afterPen = colliderPenetrationPushMagnitude({
      right: adjusted.right,
      forward: adjusted.forward,
      floorUp: currentFloor ?? 0,
      colliders,
      rig: colliderRig,
    });
    const moved =
      Math.abs(adjusted.right - fromLocal.right) > 1e-5 ||
      Math.abs(adjusted.forward - fromLocal.forward) > 1e-5;
    if (
      beforePen > 1e-4 &&
      afterPen > 1e-4 &&
      afterPen >= beforePen - 1e-4 &&
      !moved &&
      fallbackLocal
    ) {
      return { local: fallbackLocal, zone: resolved.zone };
    }
    if (
      !canSlideOnColliderDeck(
        adjusted,
        fromLocal,
        currentFloor,
        colliderRig,
        localUp,
      )
    ) {
      return fallbackLocal
        ? { local: fallbackLocal, zone: resolved.zone }
        : resolved;
    }
    const bound = findCameraBoundAt(adjusted);
    return {
      local: adjusted,
      zone: bound?.id ?? resolved.zone,
    };
  }
  if (
    Math.abs(adjusted.right - fromLocal.right) < 1e-6 &&
    Math.abs(adjusted.forward - fromLocal.forward) < 1e-6
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

export function getDeckWorldPose(
  ship: FlightBody,
  local: DeckLocal,
  rig?: ShipColliderRigState,
  localUp?: number,
): Pose {
  const right = getShipRight(ship);
  const floorUp = shipFloorUpAt(local, rig, localUp) + DECK_FLOOR_OFFSET_METERS;
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
  colliderRig?: ShipColliderRigState,
): DeckCharacterState {
  const spot = local ?? getDefaultDeckSpawnLocal(colliderRig);
  const floor = usesColliderDeck()
    ? probeColliderDeckFloor(spot, colliderRig)
    : null;
  const grounded = !usesColliderDeck() || floor !== null;
  const pose = getDeckWorldPose(ship, spot, colliderRig, floor ?? undefined);
  return {
    animation: "Idle_Loop",
    deckLocal: { ...spot },
    deckZone: zone ?? findZoneIdAt(spot),
    forward: pose.forward,
    grounded,
    jumpPhase: grounded ? "grounded" : "jump-loop",
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity: vec3(0, 0, 0),
    airborneOffDeckFrames: 0,
  };
}

/** Non-gated zone lookup for spawn placement (ignores ramp/door state). */
function findZoneIdAt(local: DeckLocal): ShipZoneId {
  if (usesColliderDeck()) {
    return findCameraBoundAt(local)?.id ?? "deck";
  }
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
export function getDefaultDeckSpawnLocal(
  rig?: ShipColliderRigState,
): DeckLocal {
  const layout = getShipLayout();
  if (usesColliderDeck()) {
    const seen = new Set<string>();
    for (const candidate of deckSpawnCandidates()) {
      const key = `${candidate.right},${candidate.forward}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!rig || probeColliderDeckFloor(candidate, rig) !== null) {
        return candidate;
      }
    }
    return deckSpawnCandidates()[0] ?? { right: 0, forward: 0 };
  }
  if (layout.deckSpawn) return { ...layout.deckSpawn };
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
  /** Set when the character fell off the collider deck with no landing surface. */
  fellOffDeck: boolean;
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
  const feetLocalUp = worldToShipLocal(ship, state.position).up;

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
          resolved = usesColliderDeck()
            ? resolveColliderDeckStep(
                state,
                dot(step, right),
                dot(step, deckForward),
                colliderRig,
                feetLocalUp,
              )
            : resolveDeckStep(
                state,
                dot(step, right),
                dot(step, deckForward),
                gates,
              );
        } else {
          resolved = { local: state.deckLocal, zone: state.deckZone };
        }
        resolved = resolveDeckColliderStep(
          resolved,
          gates,
          colliderRig,
          feetLocalUp,
          state.deckLocal,
        );
        const pose = getDeckWorldPose(ship, resolved.local, colliderRig, feetLocalUp);
        return { position: pose.position, up: pose.up };
      },
      tryLand: (candidate) => {
        const local = worldToShipLocal(ship, candidate);
        const floorUp =
          shipFloorUpAt(
            { right: local.right, forward: local.forward },
            colliderRig,
            local.up,
          ) + DECK_FLOOR_OFFSET_METERS;
        if (local.up > floorUp) return null;
        const landedLocal = { right: local.right, forward: local.forward };
        if (insideActiveLadder(landedLocal, gates)) return null;
        if (usesColliderDeck()) {
          if (!canStandOnCollider(landedLocal, null, colliderRig, local.up)) return null;
          const bound = findCameraBoundAt(landedLocal);
          resolved = {
            local: landedLocal,
            zone: bound?.id ?? state.deckZone,
          };
        } else {
          const zone = findWalkZone(landedLocal, gates);
          resolved = {
            local: landedLocal,
            zone: zone
              ? zone.passage
                ? state.deckZone
                : zone.id
              : state.deckZone,
          };
        }
        resolved = resolveDeckColliderStep(
          resolved,
          gates,
          colliderRig,
          feetLocalUp,
          state.deckLocal,
        );
        const pose = getDeckWorldPose(ship, resolved.local, colliderRig, feetLocalUp);
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
  const finalFeetLocalUp = worldToShipLocal(ship, motion.position).up;
  const onRamp = usesColliderDeck()
    ? isStandingOnRampCollider(resolved.local, colliderRig, finalFeetLocalUp)
    : resolved.zone === "ramp";
  const atOrPastRampExit =
    resolved.local.forward <= layout.rampDismountForward + 0.2;
  const groundedOnOutsidePad =
    motion.grounded &&
    onRamp &&
    atOrPastRampExit &&
    atShipGroundLevel(finalFeetLocalUp) &&
    usesColliderDeck() &&
    !canStandOnCollider(resolved.local, null, colliderRig, finalFeetLocalUp);
  const dismounted =
    onRamp &&
    (groundedOnOutsidePad ||
      (!motion.grounded && atShipGroundLevel(finalFeetLocalUp)) ||
      (motion.grounded &&
        resolved.local.forward <= layout.rampDismountForward));

  const lowestInteriorFloor = lowestCameraBoundFloor();
  const offColliderDeck =
    usesColliderDeck() &&
    !motion.grounded &&
    (finalFeetLocalUp < lowestInteriorFloor - 0.35 ||
      (atShipGroundLevel(finalFeetLocalUp) &&
        !canStandOnCollider(
          resolved.local,
          null,
          colliderRig,
          finalFeetLocalUp,
        )));
  const airborneOffDeckFrames = offColliderDeck
    ? (state.airborneOffDeckFrames ?? 0) + 1
    : 0;
  const fellOffDeck =
    usesColliderDeck() &&
    airborneOffDeckFrames >= AIRBORNE_OFF_DECK_DISMOUNT_FRAMES;

  return {
    dismounted,
    fellOffDeck,
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
      airborneOffDeckFrames,
    },
  };
}
