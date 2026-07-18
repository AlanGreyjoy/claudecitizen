import type { StationDir2, StationFloorId, StationLocalPoint } from './station';

export type StationNpcBehavior = 'stationary' | 'wander' | 'patrol';

export interface StationNpcSpawnerSpec extends StationLocalPoint {
  id: string;
  populationId: string;
  floorId: StationFloorId;
  minAlive: number;
  maxAlive: number;
  routeGroup: string;
  radius: number;
  face: StationDir2;
}

export interface StationNpcWaypointSpec extends StationLocalPoint {
  id: string;
  floorId: StationFloorId;
  routeGroup: string;
  links: string[];
  waitMinSeconds: number;
  waitMaxSeconds: number;
}

export interface StationNpcPlacementSpec extends StationLocalPoint {
  id: string;
  npcDefinitionId: string;
  displayName?: string;
  floorId: StationFloorId;
  behavior: StationNpcBehavior;
  routeGroup?: string;
  face: StationDir2;
}

export interface StationNpcLayout {
  spawners: StationNpcSpawnerSpec[];
  waypoints: StationNpcWaypointSpec[];
  placements: StationNpcPlacementSpec[];
}

function collectWaypoints(
  waypoints: readonly StationNpcWaypointSpec[],
  issues: string[],
): Map<string, StationNpcWaypointSpec> {
  const waypointById = new Map<string, StationNpcWaypointSpec>();
  for (const waypoint of waypoints) {
    if (!waypoint.id) {
      issues.push('NPC waypoint has an empty id.');
      continue;
    }
    if (waypointById.has(waypoint.id)) {
      issues.push(`NPC waypoint id "${waypoint.id}" is duplicated.`);
      continue;
    }
    if (!waypoint.routeGroup) {
      issues.push(`NPC waypoint "${waypoint.id}" has an empty route group.`);
    }
    waypointById.set(waypoint.id, waypoint);
  }
  return waypointById;
}

function groupAndValidateWaypointLinks(
  waypointById: ReadonlyMap<string, StationNpcWaypointSpec>,
  issues: string[],
): Map<string, StationNpcWaypointSpec[]> {
  const waypointsByGroup = new Map<string, StationNpcWaypointSpec[]>();
  for (const waypoint of waypointById.values()) {
    const group = waypointsByGroup.get(waypoint.routeGroup) ?? [];
    group.push(waypoint);
    waypointsByGroup.set(waypoint.routeGroup, group);
    for (const linkedId of waypoint.links) {
      if (linkedId === waypoint.id) {
        issues.push(`NPC waypoint "${waypoint.id}" links to itself.`);
        continue;
      }
      const linked = waypointById.get(linkedId);
      if (!linked) {
        issues.push(`NPC waypoint "${waypoint.id}" links to missing waypoint "${linkedId}".`);
        continue;
      }
      if (linked.routeGroup !== waypoint.routeGroup) {
        issues.push(
          `NPC waypoint "${waypoint.id}" links across route groups to "${linkedId}".`,
        );
      }
      if (linked.floorId !== waypoint.floorId) {
        issues.push(`NPC waypoint "${waypoint.id}" links across floors to "${linkedId}".`);
      }
    }
  }
  return waypointsByGroup;
}

function disconnectedWaypointIds(group: readonly StationNpcWaypointSpec[]): string[] {
  if (group.length <= 1) return [];
  const groupIds = new Set(group.map((waypoint) => waypoint.id));
  const neighbors = new Map(group.map((waypoint) => [waypoint.id, new Set<string>()]));
  for (const waypoint of group) {
    for (const linkedId of waypoint.links) {
      if (!groupIds.has(linkedId)) continue;
      neighbors.get(waypoint.id)?.add(linkedId);
      neighbors.get(linkedId)?.add(waypoint.id);
    }
  }
  const visited = new Set<string>();
  const pending = [group[0].id];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    for (const neighbor of neighbors.get(id) ?? []) pending.push(neighbor);
  }
  return group
    .filter((waypoint) => !visited.has(waypoint.id))
    .map((waypoint) => waypoint.id);
}

function validateRouteConnectivity(
  waypointsByGroup: ReadonlyMap<string, readonly StationNpcWaypointSpec[]>,
  issues: string[],
): void {
  for (const [routeGroup, group] of waypointsByGroup) {
    const disconnected = disconnectedWaypointIds(group);
    if (disconnected.length > 0) {
      issues.push(`NPC route group "${routeGroup}" is disconnected at: ${disconnected.join(', ')}.`);
    }
  }
}

function validateActorId(
  id: string,
  kind: 'spawner' | 'placement',
  actorIds: Set<string>,
  issues: string[],
): void {
  if (!id) {
    issues.push(`NPC ${kind} has an empty id.`);
  } else if (actorIds.has(id)) {
    issues.push(`NPC actor id "${id}" is duplicated.`);
  } else {
    actorIds.add(id);
  }
}

function validateRouteReference(
  actorLabel: string,
  routeGroup: string,
  floorId: StationFloorId,
  waypointsByGroup: ReadonlyMap<string, readonly StationNpcWaypointSpec[]>,
  issues: string[],
): void {
  const route = waypointsByGroup.get(routeGroup) ?? [];
  if (route.length === 0) {
    issues.push(
      `${actorLabel} references route group "${routeGroup}" with no waypoints.`,
    );
  } else if (route.every((waypoint) => waypoint.floorId !== floorId)) {
    issues.push(`${actorLabel} has no waypoint on floor "${floorId}".`);
  }
}

function validateSpawners(
  spawners: readonly StationNpcSpawnerSpec[],
  waypointsByGroup: ReadonlyMap<string, readonly StationNpcWaypointSpec[]>,
  actorIds: Set<string>,
  issues: string[],
): void {
  for (const spawner of spawners) {
    validateActorId(spawner.id, 'spawner', actorIds, issues);
    if (!spawner.populationId) {
      issues.push(`NPC spawner "${spawner.id}" has an empty population id.`);
    }
    validateRouteReference(
      `NPC spawner "${spawner.id}"`,
      spawner.routeGroup,
      spawner.floorId,
      waypointsByGroup,
      issues,
    );
  }
}

function validatePlacements(
  placements: readonly StationNpcPlacementSpec[],
  waypointsByGroup: ReadonlyMap<string, readonly StationNpcWaypointSpec[]>,
  actorIds: Set<string>,
  issues: string[],
): void {
  for (const placement of placements) {
    validateActorId(placement.id, 'placement', actorIds, issues);
    if (!placement.npcDefinitionId) {
      issues.push(`NPC placement "${placement.id}" has an empty definition id.`);
    }
    if (placement.behavior !== 'stationary') {
      validateRouteReference(
        `NPC placement "${placement.id}"`,
        placement.routeGroup ?? '',
        placement.floorId,
        waypointsByGroup,
        issues,
      );
    }
  }
}

/**
 * Reports authoring mistakes that the component parser cannot see in isolation.
 * Links are treated as undirected by the runtime, so authors only need to list
 * each edge once.
 */
export function validateStationNpcLayout(layout: StationNpcLayout): string[] {
  const issues: string[] = [];
  const waypointById = collectWaypoints(layout.waypoints, issues);
  const waypointsByGroup = groupAndValidateWaypointLinks(waypointById, issues);
  validateRouteConnectivity(waypointsByGroup, issues);
  const actorIds = new Set<string>();
  validateSpawners(layout.spawners, waypointsByGroup, actorIds, issues);
  validatePlacements(layout.placements, waypointsByGroup, actorIds, issues);

  return issues;
}
