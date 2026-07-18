import type { PlayerCharacterAppearanceV1 } from '../player/character_creator/player_character_appearance';
import type { StationNpcRenderState } from '../types';
import {
  stationDirToWorld,
  stationLocalToWorld,
  type StationDir2,
  type StationFloorId,
  type StationFrame,
  type StationLayoutOverride,
  type StationLocalPoint,
} from '../world/station';
import type {
  StationNpcBehavior,
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

interface StationNpcActor {
  id: string;
  displayName: string;
  appearance: PlayerCharacterAppearanceV1;
  behavior: StationNpcBehavior;
  floorId: StationFloorId;
  routeGroup: string | null;
  position: StationLocalPoint;
  face: StationDir2;
  currentWaypointId: string | null;
  previousWaypointId: string | null;
  targetWaypointId: string | null;
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

function nearestWaypoint(
  actor: StationNpcActor,
  waypoints: readonly StationNpcWaypointSpec[],
): StationNpcWaypointSpec | null {
  let nearest: StationNpcWaypointSpec | null = null;
  let nearestDistance = Infinity;
  for (const waypoint of waypoints) {
    if (waypoint.routeGroup !== actor.routeGroup || waypoint.floorId !== actor.floorId) continue;
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
    behavior,
    floorId,
    routeGroup,
    position,
    face,
  } = options;
  const actor: StationNpcActor = {
    id,
    displayName: '',
    appearance: createNpcAppearance(definition, () => 0.5),
    behavior,
    floorId,
    routeGroup,
    position: { ...position },
    face: { ...face },
    currentWaypointId: null,
    previousWaypointId: null,
    targetWaypointId: null,
    waitRemainingSeconds: 0,
    walkSpeedMetersPerSecond: 1.25,
    randomState: hashText(seed, id),
    moving: false,
  };
  const random01 = () => nextRandom(actor);
  actor.displayName = displayName?.trim() || chooseNpcDisplayName(definition, random01);
  actor.appearance = createNpcAppearance(definition, random01);
  actor.walkSpeedMetersPerSecond = chooseNpcWalkSpeed(definition, random01);
  return actor;
}

function spawnFromSpawner(
  spawner: StationNpcSpawnerSpec,
  index: number,
  seed: number,
): StationNpcActor {
  const id = `spawner:${spawner.id}:${index}`;
  const chooser = { randomState: hashText(seed, `${id}:definition`) };
  const definition = choosePopulationNpcDefinition(spawner.populationId, () => nextRandom(chooser));
  const actor = createActorBase({
    id,
    seed,
    definition,
    behavior: 'wander',
    floorId: spawner.floorId,
    routeGroup: spawner.routeGroup,
    position: spawner,
    face: spawner.face,
  });
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

export function createStationNpcPopulation(
  layout: StationLayoutOverride | null,
  frame: StationFrame,
  initialSeed: number,
): StationNpcPopulation {
  const spawners = layout?.npcSpawners ?? [];
  const placements = layout?.npcPlacements ?? [];
  const waypoints = layout?.npcWaypoints ?? [];
  const waypointById = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint]));
  const adjacency = buildAdjacency(waypoints);
  let seed = initialSeed;
  let actors: StationNpcActor[] = [];
  warnAboutNpcAuthoring(spawners, placements);

  function reset(nextSeed = seed): void {
    seed = nextSeed;
    actors = [];
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

    for (const actor of actors) {
      if (actor.behavior === 'stationary' || !actor.routeGroup) continue;
      actor.targetWaypointId = nearestWaypoint(actor, waypoints)?.id ?? null;
    }
  }

  function updateActor(actor: StationNpcActor, dtSeconds: number): void {
    actor.moving = false;
    if (actor.behavior === 'stationary' || !actor.routeGroup) return;
    if (actor.waitRemainingSeconds > 0) {
      actor.waitRemainingSeconds = Math.max(0, actor.waitRemainingSeconds - dtSeconds);
      return;
    }
    if (!actor.targetWaypointId) {
      actor.targetWaypointId = actor.currentWaypointId
        ? chooseNextWaypoint(actor, adjacency)
        : nearestWaypoint(actor, waypoints)?.id ?? null;
      if (!actor.targetWaypointId) return;
    }
    const target = waypointById.get(actor.targetWaypointId);
    if (!target) {
      actor.targetWaypointId = null;
      return;
    }

    const right = target.right - actor.position.right;
    const up = target.up - actor.position.up;
    const forward = target.forward - actor.position.forward;
    const distance = Math.hypot(right, up, forward);
    const maxStep = actor.walkSpeedMetersPerSecond * dtSeconds;
    if (distance <= Math.max(WAYPOINT_ARRIVAL_METERS, maxStep)) {
      actor.position = { right: target.right, up: target.up, forward: target.forward };
      actor.previousWaypointId = actor.currentWaypointId;
      actor.currentWaypointId = target.id;
      actor.targetWaypointId = null;
      actor.waitRemainingSeconds = randomBetween(
        actor,
        target.waitMinSeconds,
        target.waitMaxSeconds,
      );
      return;
    }

    const inverseDistance = 1 / distance;
    actor.position = {
      right: actor.position.right + right * inverseDistance * maxStep,
      up: actor.position.up + up * inverseDistance * maxStep,
      forward: actor.position.forward + forward * inverseDistance * maxStep,
    };
    const horizontalLength = Math.hypot(right, forward);
    if (horizontalLength > 0.0001) {
      actor.face = {
        right: right / horizontalLength,
        forward: forward / horizontalLength,
      };
    }
    actor.moving = true;
  }

  reset(initialSeed);

  return {
    reset,
    update(dtSeconds) {
      const dt = Math.max(0, Math.min(dtSeconds, 0.1));
      if (dt <= 0) return;
      for (const actor of actors) updateActor(actor, dt);
    },
    getRenderStates() {
      return actors.map((actor) => ({
        id: actor.id,
        displayName: actor.displayName,
        appearance: actor.appearance,
        animation: actor.moving ? 'Walk_Loop' : 'Idle_Loop',
        position: stationLocalToWorld(frame, {
          right: actor.position.right,
          up: actor.position.up + NPC_GROUND_OFFSET_METERS,
          forward: actor.position.forward,
        }),
        forward: stationDirToWorld(frame, actor.face),
        up: frame.up,
      }));
    },
  };
}
