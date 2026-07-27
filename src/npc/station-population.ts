import type { PlayerCharacterAppearanceV1 } from '../player/character_creator/player-character-appearance';
import type { StationNpcRenderState } from '../types';
import {
  writeStationDirToWorld,
  writeStationLocalToWorld,
  type StationDir2,
  type StationFloorId,
  type StationFrame,
  type StationLayoutOverride,
  type StationLocalPoint,
} from '../world/station';
import type {
  StationNpcBehavior,
  StationNpcNavProbe,
  StationNpcPlacementSpec,
  StationNpcSpawnerSpec,
  StationNpcWaypointSpec,
} from '../world/npc';
import {
  chooseNpcDisplayName,
  chooseNpcWalkSpeed,
  choosePopulationNpcDefinition,
  createNpcAppearance,
  getNpcDefinition,
  hasNpcDefinition,
  hasNpcPopulation,
  type NpcDefinition,
} from './catalog';

const NPC_GROUND_OFFSET_METERS = 0.05;
const WAYPOINT_ARRIVAL_METERS = 0.04;
const MAX_ACTIVE_STATION_NPCS = 32;
/**
 * Candidate roam targets tried per pick before the actor gives up for a beat.
 * Each attempt costs one shape cast, so this is the whole per-pick budget.
 */
const ROAM_TARGET_ATTEMPTS = 3;
/**
 * Backoff after every candidate was rejected. Without it a boxed-in actor would
 * re-probe on every frame — 3 casts × 32 actors × 60 Hz — which is exactly the
 * per-frame collision cost the probe-then-commit design exists to avoid.
 */
const ROAM_RETRY_WAIT_SECONDS = 0.75;
/** Shortest walk worth taking; below this the actor reads as twitching in place. */
const MIN_ROAM_STEP_METERS = 1;
/** Fraction of the disc radius used as the floor for the above on tight discs. */
const MIN_ROAM_STEP_RADIUS_FRACTION = 0.5;
/**
 * Height change an actor will accept between where it stands and a candidate
 * target's floor. Matches the player controller's autostep allowance, so an NPC
 * takes the same door sills and deck lips the player walks over — and refuses
 * the mezzanine edges and stairwell drops it would otherwise stroll off.
 */
const MAX_ROAM_STEP_HEIGHT_METERS = 0.5;
/**
 * Frames the spawn floor-snap keeps retrying before giving up. Bounded so a
 * population authored entirely off the deck costs a couple of seconds of rays
 * rather than one ray per actor per frame for the rest of the session.
 */
const FLOOR_SNAP_ATTEMPT_FRAMES = 120;
/**
 * Spacing of mid-walk path re-probes. One cast per actor at this rate is ~64
 * casts/second across a full population — cheap enough to keep NPCs honest when
 * a door shuts on them, far short of testing collision every frame.
 */
const ROAM_RECHECK_INTERVAL_SECONDS = 0.5;

interface StationNpcActor {
  id: string;
  displayName: string;
  appearance: PlayerCharacterAppearanceV1;
  /** Authored character GLB; null falls back to the modular Sidekick avatar. */
  modelUrl: string | null;
  behavior: StationNpcBehavior;
  floorId: StationFloorId;
  routeGroup: string | null;
  position: StationLocalPoint;
  face: StationDir2;
  currentWaypointId: string | null;
  previousWaypointId: string | null;
  targetWaypointId: string | null;
  /** Roam only: marker the wander disc is centred on. */
  anchor: StationLocalPoint;
  roamRadius: number;
  roamWaitMinSeconds: number;
  roamWaitMaxSeconds: number;
  /** Rewritten in place each time a roam target is picked — never reallocated. */
  roamTarget: StationLocalPoint;
  roamTargetActive: boolean;
  /** Countdown to the next mid-walk re-probe of the remaining roam segment. */
  roamRecheckRemainingSeconds: number;
  waitRemainingSeconds: number;
  walkSpeedMetersPerSecond: number;
  randomState: number;
  moving: boolean;
}

interface CreateActorOptions {
  id: string;
  seed: number;
  definition: NpcDefinition;
  displayName?: string;
  modelUrl?: string;
  behavior: StationNpcBehavior;
  floorId: StationFloorId;
  routeGroup: string | null;
  position: StationLocalPoint;
  face: StationDir2;
}

export interface StationNpcPopulation {
  reset(seed?: number): void;
  update(dtSeconds: number): void;
  getRenderStates(): StationNpcRenderState[];
  /**
   * Live station-local floor positions, one per actor, in a stable order until
   * the next `reset`. Handed to the Rapier capsule pool each frame; the entries
   * are the actors' own mutated points, so this allocates nothing.
   */
  getLocalPositions(): readonly StationLocalPoint[];
}

function hashText(seed: number, text: string): number {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
  }
  return hash >>> 0 || 1;
}

function nextRandom(actor: Pick<StationNpcActor, 'randomState'>): number {
  actor.randomState = (actor.randomState + 0x6d2b79f5) >>> 0;
  let value = actor.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function randomBetween(actor: StationNpcActor, min: number, max: number): number {
  return min + (max - min) * nextRandom(actor);
}

function localDistanceSquared(a: StationLocalPoint, b: StationLocalPoint): number {
  const right = b.right - a.right;
  const up = b.up - a.up;
  const forward = b.forward - a.forward;
  return right * right + up * up + forward * forward;
}

/** Waypoints only ever route within one group on one floor — see `buildAdjacency`. */
function routeBucketKey(routeGroup: string, floorId: StationFloorId): string {
  return `${routeGroup}\0${floorId}`;
}

function bucketWaypointsByRoute(
  waypoints: readonly StationNpcWaypointSpec[],
): Map<string, StationNpcWaypointSpec[]> {
  const buckets = new Map<string, StationNpcWaypointSpec[]>();
  for (const waypoint of waypoints) {
    const key = routeBucketKey(waypoint.routeGroup, waypoint.floorId);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(waypoint);
    else buckets.set(key, [waypoint]);
  }
  return buckets;
}

function nearestWaypoint(
  actor: StationNpcActor,
  candidates: readonly StationNpcWaypointSpec[],
): StationNpcWaypointSpec | null {
  let nearest: StationNpcWaypointSpec | null = null;
  let nearestDistance = Infinity;
  for (const waypoint of candidates) {
    const distance = localDistanceSquared(actor.position, waypoint);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = waypoint;
    }
  }
  return nearest;
}

function createActorBase(options: CreateActorOptions): StationNpcActor {
  const {
    id,
    seed,
    definition,
    displayName,
    modelUrl,
    behavior,
    floorId,
    routeGroup,
    position,
    face,
  } = options;
  // The draw order below is what makes a given (seed, id) reproducible; the
  // stream lives on a bare holder so the actor can be built in one pass.
  const stream = { randomState: hashText(seed, id) };
  const random01 = () => nextRandom(stream);
  return {
    id,
    displayName: displayName?.trim() || chooseNpcDisplayName(definition, random01),
    appearance: createNpcAppearance(definition, random01),
    modelUrl: modelUrl?.trim() || null,
    behavior,
    floorId,
    routeGroup,
    position: { right: position.right, up: position.up, forward: position.forward },
    face: { right: face.right, forward: face.forward },
    currentWaypointId: null,
    previousWaypointId: null,
    targetWaypointId: null,
    anchor: { right: position.right, up: position.up, forward: position.forward },
    roamRadius: 0,
    roamWaitMinSeconds: 0,
    roamWaitMaxSeconds: 0,
    roamTarget: { right: 0, up: 0, forward: 0 },
    roamTargetActive: false,
    roamRecheckRemainingSeconds: 0,
    waitRemainingSeconds: 0,
    walkSpeedMetersPerSecond: chooseNpcWalkSpeed(definition, random01),
    randomState: stream.randomState,
    moving: false,
  };
}

function spawnFromSpawner(
  spawner: StationNpcSpawnerSpec,
  index: number,
  seed: number,
): StationNpcActor {
  const id = `spawner:${spawner.id}:${index}`;
  const chooser = { randomState: hashText(seed, `${id}:definition`) };
  const definition = choosePopulationNpcDefinition(spawner.populationId, () => nextRandom(chooser));
  const roaming = spawner.behavior === 'roam';
  const actor = createActorBase({
    id,
    seed,
    definition,
    modelUrl: spawner.modelUrl,
    behavior: roaming ? 'roam' : 'wander',
    floorId: spawner.floorId,
    // Roamers never consult the waypoint graph, and carrying a route group would
    // make `updateActor` treat them as walkers the moment a group happens to exist.
    routeGroup: roaming ? null : spawner.routeGroup,
    position: spawner,
    face: spawner.face,
  });
  actor.roamRadius = spawner.roamRadius;
  actor.roamWaitMinSeconds = spawner.roamWaitMinSeconds;
  actor.roamWaitMaxSeconds = spawner.roamWaitMaxSeconds;
  // The anchor stays on the marker so the whole batch shares one wander disc
  // rather than each NPC roaming around wherever its spawn jitter dropped it.
  const angle = nextRandom(actor) * Math.PI * 2;
  const radius = Math.sqrt(nextRandom(actor)) * spawner.radius;
  actor.position.right += Math.cos(angle) * radius;
  actor.position.forward += Math.sin(angle) * radius;
  return actor;
}

function spawnFromPlacement(
  placement: StationNpcPlacementSpec,
  seed: number,
): StationNpcActor {
  return createActorBase({
    id: `placement:${placement.id}`,
    seed,
    definition: getNpcDefinition(placement.npcDefinitionId),
    displayName: placement.displayName,
    modelUrl: placement.modelUrl,
    behavior: placement.behavior,
    floorId: placement.floorId,
    routeGroup: placement.routeGroup ?? null,
    position: placement,
    face: placement.face,
  });
}

function buildAdjacency(
  waypoints: readonly StationNpcWaypointSpec[],
): Map<string, string[]> {
  const byId = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint]));
  const adjacency = new Map<string, Set<string>>();
  for (const waypoint of waypoints) adjacency.set(waypoint.id, new Set());
  for (const waypoint of waypoints) {
    for (const linkedId of waypoint.links) {
      const linked = byId.get(linkedId);
      if (
        !linked ||
        linked.floorId !== waypoint.floorId ||
        linked.routeGroup !== waypoint.routeGroup
      ) {
        continue;
      }
      adjacency.get(waypoint.id)?.add(linkedId);
      adjacency.get(linkedId)?.add(waypoint.id);
    }
  }
  return new Map(
    [...adjacency].map(([id, links]) => [id, [...links].sort()]),
  );
}

function chooseNextWaypoint(
  actor: StationNpcActor,
  adjacency: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (!actor.currentWaypointId) return null;
  const allNeighbors = adjacency.get(actor.currentWaypointId) ?? [];
  const forwardNeighbors = allNeighbors.filter((id) => id !== actor.previousWaypointId);
  const candidates = forwardNeighbors.length > 0 ? forwardNeighbors : allNeighbors;
  if (candidates.length === 0) return null;
  if (actor.behavior === 'patrol') return candidates[0];
  return candidates[Math.min(candidates.length - 1, Math.floor(nextRandom(actor) * candidates.length))];
}

function warnAboutNpcAuthoring(
  spawners: readonly StationNpcSpawnerSpec[],
  placements: readonly StationNpcPlacementSpec[],
): void {
  for (const spawner of spawners) {
    if (!hasNpcPopulation(spawner.populationId)) {
      console.warn(
        `NPC spawner "${spawner.id}" references unknown population "${spawner.populationId}"; using the default population.`,
      );
    }
  }
  for (const placement of placements) {
    if (!hasNpcDefinition(placement.npcDefinitionId)) {
      console.warn(
        `NPC placement "${placement.id}" references unknown definition "${placement.npcDefinitionId}"; using the default definition.`,
      );
    }
  }
  const authoredMaximum = placements.length + spawners.reduce(
    (total, spawner) => total + spawner.maxAlive,
    0,
  );
  if (authoredMaximum > MAX_ACTIVE_STATION_NPCS) {
    console.warn(
      `Station NPC population is capped at ${MAX_ACTIVE_STATION_NPCS}; authored maximum is ${authoredMaximum}.`,
    );
  }
}

function spawnActors(
  placements: readonly StationNpcPlacementSpec[],
  spawners: readonly StationNpcSpawnerSpec[],
  seed: number,
): StationNpcActor[] {
  const actors: StationNpcActor[] = [];
  const liveIds = new Set<string>();
  const addActor = (actor: StationNpcActor): void => {
    if (liveIds.has(actor.id)) return;
    liveIds.add(actor.id);
    actors.push(actor);
  };
  for (const placement of placements) {
    if (actors.length >= MAX_ACTIVE_STATION_NPCS) break;
    addActor(spawnFromPlacement(placement, seed));
  }
  for (const spawner of spawners) {
    const remainingCapacity = MAX_ACTIVE_STATION_NPCS - actors.length;
    if (remainingCapacity <= 0) break;
    const countPicker = { randomState: hashText(seed, `spawner:${spawner.id}:count`) };
    const count = Math.min(
      remainingCapacity,
      spawner.minAlive + Math.floor(
        nextRandom(countPicker) * (spawner.maxAlive - spawner.minAlive + 1),
      ),
    );
    for (let index = 0; index < count; index += 1) {
      addActor(spawnFromSpawner(spawner, index, seed));
    }
  }
  return actors;
}

/**
 * Pooled render states, rebuilt only when the population resets. `writeRenderStates`
 * then refreshes them in place: it runs once per animation frame and the allocating
 * station transforms cost a dozen vectors per actor. Consumers read the states
 * within the frame and never retain them.
 */
function createRenderStates(
  actors: readonly StationNpcActor[],
  frame: StationFrame,
): StationNpcRenderState[] {
  return actors.map((actor) => ({
    id: actor.id,
    displayName: actor.displayName,
    appearance: actor.appearance,
    modelUrl: actor.modelUrl,
    animation: 'Idle_Loop',
    position: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: 0 },
    up: frame.up,
    headLook: null,
  }));
}

function writeRenderStates(
  actors: readonly StationNpcActor[],
  renderStates: readonly StationNpcRenderState[],
  frame: StationFrame,
  groundLocal: StationLocalPoint,
): void {
  for (let index = 0; index < actors.length; index += 1) {
    const actor = actors[index];
    const state = renderStates[index];
    state.animation = actor.moving ? 'Walk_Loop' : 'Idle_Loop';
    groundLocal.right = actor.position.right;
    groundLocal.up = actor.position.up + NPC_GROUND_OFFSET_METERS;
    groundLocal.forward = actor.position.forward;
    writeStationLocalToWorld(frame, groundLocal, state.position);
    writeStationDirToWorld(frame, actor.face, state.forward);
  }
}

/**
 * Walk speed is a speed across the floor, so arrival and step length are measured
 * horizontally and height is simply followed. Stepping along the full 3D vector
 * instead would slow NPCs down whenever two waypoints sit at different heights and
 * slide them diagonally through the air between them.
 */
function stepActorTowardPoint(
  actor: StationNpcActor,
  target: StationLocalPoint,
  dtSeconds: number,
): boolean {
  const right = target.right - actor.position.right;
  const up = target.up - actor.position.up;
  const forward = target.forward - actor.position.forward;
  const horizontalDistance = Math.hypot(right, forward);
  const maxStep = actor.walkSpeedMetersPerSecond * dtSeconds;
  if (horizontalDistance <= Math.max(WAYPOINT_ARRIVAL_METERS, maxStep)) {
    actor.position.right = target.right;
    actor.position.up = target.up;
    actor.position.forward = target.forward;
    return true;
  }

  const stepFraction = maxStep / horizontalDistance;
  actor.position.right += right * stepFraction;
  actor.position.up += up * stepFraction;
  actor.position.forward += forward * stepFraction;
  actor.face.right = right / horizontalDistance;
  actor.face.forward = forward / horizontalDistance;
  actor.moving = true;
  return false;
}

function stepActorTowardTarget(
  actor: StationNpcActor,
  target: StationNpcWaypointSpec,
  dtSeconds: number,
): void {
  if (!stepActorTowardPoint(actor, target, dtSeconds)) return;
  actor.previousWaypointId = actor.currentWaypointId;
  actor.currentWaypointId = target.id;
  actor.targetWaypointId = null;
  actor.waitRemainingSeconds = randomBetween(
    actor,
    target.waitMinSeconds,
    target.waitMaxSeconds,
  );
}

/**
 * Draws a point in the wander disc and accepts it only if the actor can walk
 * there in a straight line. Candidates are written straight into `roamTarget`,
 * which is meaningless until `roamTargetActive` is set, so a rejected draw costs
 * no allocation and the next attempt simply overwrites it.
 *
 * There is still no navmesh: rejection sampling buys wall avoidance without one
 * because a validated straight segment needs no collision while it is walked.
 */
function pickRoamTarget(
  actor: StationNpcActor,
  probe: StationNpcNavProbe | null,
): boolean {
  // A disc smaller than the nominal step would reject every draw and leave the
  // actor permanently in backoff, so the floor scales down with the radius.
  const minimumStep = Math.min(
    MIN_ROAM_STEP_METERS,
    actor.roamRadius * MIN_ROAM_STEP_RADIUS_FRACTION,
  );
  for (let attempt = 0; attempt < ROAM_TARGET_ATTEMPTS; attempt += 1) {
    const angle = nextRandom(actor) * Math.PI * 2;
    const radius = Math.sqrt(nextRandom(actor)) * actor.roamRadius;
    actor.roamTarget.right = actor.anchor.right + Math.cos(angle) * radius;
    actor.roamTarget.up = actor.anchor.up;
    actor.roamTarget.forward = actor.anchor.forward + Math.sin(angle) * radius;
    const step = Math.hypot(
      actor.roamTarget.right - actor.position.right,
      actor.roamTarget.forward - actor.position.forward,
    );
    if (step < minimumStep) continue;
    if (!probe) return true;
    // Snap the draw down onto real floor before testing the walk. A candidate
    // with no floor under it is over a stairwell or off the deck edge; one at a
    // height the player could not step to is on another level that only looks
    // reachable because the disc is flat.
    const floorHeight = probe.sampleFloorHeight(actor.roamTarget);
    if (floorHeight === null) continue;
    if (Math.abs(floorHeight - actor.position.up) > MAX_ROAM_STEP_HEIGHT_METERS) {
      continue;
    }
    actor.roamTarget.up = floorHeight;
    if (!probe.isPathClear(actor.position, actor.roamTarget)) continue;
    return true;
  }
  return false;
}

/**
 * Re-validates the remaining segment mid-walk. A target is only clear as of the
 * moment it was picked, and station geometry moves: doors toggle their colliders
 * from articulation blends and build mode drops props into the room. Without
 * this an actor that set off through an open door keeps walking after it shuts.
 */
function roamSegmentStillClear(
  actor: StationNpcActor,
  dtSeconds: number,
  probe: StationNpcNavProbe | null,
): boolean {
  actor.roamRecheckRemainingSeconds -= dtSeconds;
  if (actor.roamRecheckRemainingSeconds > 0) return true;
  actor.roamRecheckRemainingSeconds = ROAM_RECHECK_INTERVAL_SECONDS;
  if (!probe) return true;
  return probe.isPathClear(actor.position, actor.roamTarget);
}

function stepRoamingActor(
  actor: StationNpcActor,
  dtSeconds: number,
  probe: StationNpcNavProbe | null,
): void {
  if (actor.roamRadius <= 0) return;
  if (!actor.roamTargetActive) {
    if (!pickRoamTarget(actor, probe)) {
      actor.waitRemainingSeconds = ROAM_RETRY_WAIT_SECONDS;
      return;
    }
    actor.roamTargetActive = true;
    actor.roamRecheckRemainingSeconds = ROAM_RECHECK_INTERVAL_SECONDS;
  } else if (!roamSegmentStillClear(actor, dtSeconds, probe)) {
    // Something closed across the path. Abandon the target and pick again after
    // a beat rather than continuing through it.
    actor.roamTargetActive = false;
    actor.waitRemainingSeconds = ROAM_RETRY_WAIT_SECONDS;
    return;
  }
  if (!stepActorTowardPoint(actor, actor.roamTarget, dtSeconds)) return;
  actor.roamTargetActive = false;
  actor.waitRemainingSeconds = randomBetween(
    actor,
    actor.roamWaitMinSeconds,
    actor.roamWaitMaxSeconds,
  );
}

export function createStationNpcPopulation(
  layout: StationLayoutOverride | null,
  frame: StationFrame,
  initialSeed: number,
  /**
   * Resolved per call rather than captured: station physics is built
   * asynchronously, so the probe is null on the first frames and roaming falls
   * back to the old walk-through-walls behaviour until it exists.
   */
  getNavProbe: () => StationNpcNavProbe | null = () => null,
): StationNpcPopulation {
  const spawners = layout?.npcSpawners ?? [];
  const placements = layout?.npcPlacements ?? [];
  const waypoints = layout?.npcWaypoints ?? [];
  const waypointById = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint]));
  const waypointsByRoute = bucketWaypointsByRoute(waypoints);
  const adjacency = buildAdjacency(waypoints);
  let seed = initialSeed;
  let actors: StationNpcActor[] = [];
  let renderStates: StationNpcRenderState[] = [];
  let localPositions: StationLocalPoint[] = [];
  let floorSnapAttemptsRemaining = 0;
  const groundLocal: StationLocalPoint = { right: 0, up: 0, forward: 0 };
  warnAboutNpcAuthoring(spawners, placements);

  function routeWaypointsFor(actor: StationNpcActor): readonly StationNpcWaypointSpec[] {
    if (!actor.routeGroup) return [];
    return waypointsByRoute.get(routeBucketKey(actor.routeGroup, actor.floorId)) ?? [];
  }

  /**
   * Drops actors onto the floor under their spawn marker. Required, not polish:
   * a marker authored above the deck leaves the actor hovering, and because the
   * candidate step-height check measures against `position.up`, every target
   * would then be rejected as unreachable and the actor would hover there
   * forever in retry backoff instead of walking down to the floor.
   *
   * Retried across frames rather than done once at reset. Station physics is
   * built asynchronously and Rapier only refreshes its broad phase during
   * `step`, so the first sample can legitimately find nothing; a single attempt
   * at reset would silently leave the whole population floating. One successful
   * sample proves the world is answering queries and ends the retries.
   */
  function trySnapActorsToFloor(probe: StationNpcNavProbe | null): void {
    if (floorSnapAttemptsRemaining <= 0) return;
    if (!probe) {
      floorSnapAttemptsRemaining -= 1;
      return;
    }
    let snapped = 0;
    for (const actor of actors) {
      const floorHeight = probe.sampleFloorHeight(actor.position);
      if (floorHeight === null) continue;
      actor.position.up = floorHeight;
      actor.anchor.up = floorHeight;
      snapped += 1;
    }
    if (snapped === 0) {
      floorSnapAttemptsRemaining -= 1;
      return;
    }
    floorSnapAttemptsRemaining = 0;
    if (snapped < actors.length) {
      console.warn(
        `${actors.length - snapped} station NPC(s) have no floor under their spawn marker; they will idle in place.`,
      );
    }
  }

  function reset(nextSeed = seed): void {
    seed = nextSeed;
    actors = spawnActors(placements, spawners, seed);
    floorSnapAttemptsRemaining = FLOOR_SNAP_ATTEMPT_FRAMES;
    trySnapActorsToFloor(getNavProbe());
    for (const actor of actors) {
      if (actor.behavior === 'stationary' || !actor.routeGroup) continue;
      actor.targetWaypointId = nearestWaypoint(actor, routeWaypointsFor(actor))?.id ?? null;
    }
    renderStates = createRenderStates(actors, frame);
    localPositions = actors.map((actor) => actor.position);
  }

  function updateActor(
    actor: StationNpcActor,
    dtSeconds: number,
    probe: StationNpcNavProbe | null,
  ): void {
    actor.moving = false;
    if (actor.behavior === 'stationary') return;
    if (actor.behavior !== 'roam' && !actor.routeGroup) return;
    if (actor.waitRemainingSeconds > 0) {
      actor.waitRemainingSeconds = Math.max(0, actor.waitRemainingSeconds - dtSeconds);
      return;
    }
    if (actor.behavior === 'roam') {
      stepRoamingActor(actor, dtSeconds, probe);
      return;
    }
    if (!actor.targetWaypointId) {
      actor.targetWaypointId = actor.currentWaypointId
        ? chooseNextWaypoint(actor, adjacency)
        : nearestWaypoint(actor, routeWaypointsFor(actor))?.id ?? null;
      if (!actor.targetWaypointId) return;
    }
    const target = waypointById.get(actor.targetWaypointId);
    if (!target) {
      actor.targetWaypointId = null;
      return;
    }
    stepActorTowardTarget(actor, target, dtSeconds);
  }

  reset(initialSeed);

  return {
    reset,
    update(dtSeconds) {
      const dt = Math.max(0, Math.min(dtSeconds, 0.1));
      if (dt <= 0) return;
      const probe = getNavProbe();
      trySnapActorsToFloor(probe);
      for (const actor of actors) updateActor(actor, dt, probe);
    },
    getRenderStates() {
      writeRenderStates(actors, renderStates, frame, groundLocal);
      return renderStates;
    },
    getLocalPositions() {
      return localPositions;
    },
  };
}
