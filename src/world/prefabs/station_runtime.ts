import { mulQuat, quatIdentity, rotateVec3ByQuat, type Quat } from '../../math/quat';
import { vec3 } from '../../math/vec3';
import {
  type HangarSpec,
  type StationDir2,
  type StationElevatorMarker,
  type StationFloorId,
  type StationInfoMarker,
  type StationAvmsMarker,
  type StationLayoutOverride,
  type StationRoom,
  type StationSpawnPose,
} from '../station';
import type { PrefabDocument, PrefabEntity } from './schema';
import type { Vec3 } from '../../types';

/**
 * Derives gameplay layout (walk rooms, spawn, elevators, hangar pads, info
 * prompts) from a station prefab's components.
 *
 * Prefab/scene axes map to station-local gameplay axes as right = -x,
 * up = y, forward = z (matching the render group orientation from
 * updateShipPlacement). Walk volumes are axis-aligned in station space;
 * entity rotation is ignored for them.
 */

const DEFAULT_WALK_VOLUME_HEIGHT = 4;
const MARKER_RADIUS = 2.4;

interface FlattenedComponents {
  rooms: StationRoom[];
  spawnCandidates: {
    floorId: StationFloorId;
    right: number;
    up: number;
    forward: number;
    face: StationDir2;
  }[];
  elevatorSeeds: {
    pairId: string;
    targetFloor: StationFloorId;
    right: number;
    up: number;
    forward: number;
    face: StationDir2;
  }[];
  hangarSeeds: {
    hangarId: string;
    padIndex: number;
    right: number;
    up: number;
    forward: number;
  }[];
  infoSeeds: {
    id: string;
    prompt: string;
    radius: number;
    right: number;
    up: number;
    forward: number;
  }[];
  avmsSeeds: {
    id: string;
    radius: number;
    right: number;
    up: number;
    forward: number;
  }[];
}

function sceneToStationDir2(worldRotation: Quat): StationDir2 {
  const forward = rotateVec3ByQuat(vec3(0, 0, 1), worldRotation);
  const right = -forward.x;
  const fwd = forward.z;
  const len = Math.hypot(right, fwd);
  if (len < 1e-4) return { right: 0, forward: 1 };
  return { right: right / len, forward: fwd / len };
}

function collect(
  entity: PrefabEntity,
  parentPosition: Vec3,
  parentRotation: Quat,
  parentScale: Vec3,
  out: FlattenedComponents,
): void {
  const scaledLocal = vec3(
    entity.transform.position.x * parentScale.x,
    entity.transform.position.y * parentScale.y,
    entity.transform.position.z * parentScale.z,
  );
  const rotated = rotateVec3ByQuat(scaledLocal, parentRotation);
  const position = vec3(
    parentPosition.x + rotated.x,
    parentPosition.y + rotated.y,
    parentPosition.z + rotated.z,
  );
  const rotation = mulQuat(parentRotation, entity.transform.rotation);
  const scale = vec3(
    parentScale.x * entity.transform.scale.x,
    parentScale.y * entity.transform.scale.y,
    parentScale.z * entity.transform.scale.z,
  );

  const right = -position.x;
  const forward = position.z;

  for (const component of entity.components ?? []) {
    switch (component.type) {
      case 'walk-volume': {
        // Scene x-range [minX, maxX] flips into station right as [-maxX, -minX].
        // Entity scale is applied so walk volumes on scaled models (e.g. a
        // hangar GLB with non-uniform scale) match the editor viewport.
        const minX = position.x + component.min.x * scale.x;
        const maxX = position.x + component.max.x * scale.x;
        out.rooms.push({
          id: entity.id,
          floorId: component.floorId,
          minRight: -maxX,
          maxRight: -minX,
          minForward: position.z + component.min.z * scale.z,
          maxForward: position.z + component.max.z * scale.z,
          floorUp: position.y,
          height: (component.height ?? DEFAULT_WALK_VOLUME_HEIGHT) * scale.y,
          ...(component.open && component.open.length > 0 ? { openSides: component.open } : {}),
        });
        break;
      }
      case 'spawn-point':
        out.spawnCandidates.push({
          floorId: component.floorId,
          right,
          up: position.y,
          forward,
          face: sceneToStationDir2(rotation),
        });
        break;
      case 'elevator':
        out.elevatorSeeds.push({
          pairId: component.id,
          targetFloor: component.targetFloor,
          right,
          up: position.y,
          forward,
          face: sceneToStationDir2(rotation),
        });
        break;
      case 'hangar-pad':
        out.hangarSeeds.push({
          hangarId: component.hangarId,
          padIndex: component.padIndex,
          right,
          up: position.y,
          forward,
        });
        break;
      case 'interaction':
        out.infoSeeds.push({
          id: component.id,
          prompt: component.prompt,
          radius: component.radius,
          right,
          up: position.y,
          forward,
        });
        break;
      case 'avms-terminal':
        out.avmsSeeds.push({
          id: component.id,
          radius: component.radius,
          right,
          up: position.y,
          forward,
        });
        break;
      case 'station-frame':
      case 'collider':
        break;
    }
  }

  for (const child of entity.children ?? []) {
    collect(child, position, rotation, scale, out);
  }
}

/** Marker containment respects the vertical band of each volume so stacked floors resolve correctly. */
function roomContaining(
  rooms: StationRoom[],
  right: number,
  up: number,
  forward: number,
  floorId?: StationFloorId,
): StationRoom | null {
  for (const room of rooms) {
    if (floorId && room.floorId !== floorId) continue;
    if (right < room.minRight || right > room.maxRight) continue;
    if (forward < room.minForward || forward > room.maxForward) continue;
    if (up < room.floorUp - 1 || up > room.floorUp + room.height) continue;
    return room;
  }
  return null;
}

/**
 * Builds the gameplay layout override for a station prefab. Returns null when
 * the prefab has no walk volumes (nothing for the character to stand on).
 */
export function buildStationLayoutFromPrefab(doc: PrefabDocument): StationLayoutOverride | null {
  const out: FlattenedComponents = {
    rooms: [],
    spawnCandidates: [],
    elevatorSeeds: [],
    hangarSeeds: [],
    infoSeeds: [],
    avmsSeeds: [],
  };
  collect(doc.root, vec3(0, 0, 0), quatIdentity(), vec3(1, 1, 1), out);

  if (out.rooms.length === 0) {
    console.warn(`Prefab "${doc.id}" has no walk-volume components; cannot walk this station.`);
    return null;
  }

  let spawn: StationSpawnPose | null = null;
  for (const candidate of out.spawnCandidates) {
    const room = roomContaining(
      out.rooms,
      candidate.right,
      candidate.up,
      candidate.forward,
      candidate.floorId,
    );
    if (!room) {
      console.warn(`Prefab "${doc.id}" spawn-point lies outside every walk volume; skipping it.`);
      continue;
    }
    spawn = { roomId: room.id, right: candidate.right, forward: candidate.forward, face: candidate.face };
    break;
  }
  if (!spawn) {
    const room = out.rooms[0];
    spawn = {
      roomId: room.id,
      right: (room.minRight + room.maxRight) / 2,
      forward: (room.minForward + room.maxForward) / 2,
      face: { right: 0, forward: 1 },
    };
    if (out.spawnCandidates.length === 0) {
      console.warn(`Prefab "${doc.id}" has no spawn-point; spawning at the first walk volume.`);
    }
  }

  const elevatorMarkers: StationElevatorMarker[] = [];
  for (const seed of out.elevatorSeeds) {
    const room = roomContaining(out.rooms, seed.right, seed.up, seed.forward);
    if (!room) {
      console.warn(
        `Prefab "${doc.id}" elevator "${seed.pairId}" lies outside every walk volume; skipping it.`,
      );
      continue;
    }
    elevatorMarkers.push({
      pairId: seed.pairId,
      floorId: room.floorId,
      roomId: room.id,
      right: seed.right,
      forward: seed.forward,
      radius: MARKER_RADIUS,
      targetFloor: seed.targetFloor,
      face: seed.face,
    });
  }

  const hangars: HangarSpec[] = [];
  for (const seed of out.hangarSeeds) {
    const room = roomContaining(out.rooms, seed.right, seed.up, seed.forward, 'hangar');
    if (!room) {
      console.warn(
        `Prefab "${doc.id}" hangar-pad "${seed.hangarId}" is not inside a hangar walk volume; skipping it.`,
      );
      continue;
    }
    // hangar-pad markers are placed at pad surface height; the parked ship's
    // rest offset above it comes from the active ship layout at call time.
    hangars.push({
      index: seed.padIndex,
      roomId: room.id,
      centerRight: seed.right,
      lobbyDoorForward: 0,
      padSurfaceLocal: {
        right: seed.right,
        up: seed.up,
        forward: seed.forward,
      },
    });
  }

  const infoMarkers: StationInfoMarker[] = [];
  for (const seed of out.infoSeeds) {
    const room = roomContaining(out.rooms, seed.right, seed.up, seed.forward);
    if (!room) continue;
    infoMarkers.push({
      id: seed.id,
      floorId: room.floorId,
      right: seed.right,
      forward: seed.forward,
      radius: seed.radius,
      prompt: seed.prompt,
    });
  }

  const avmsMarkers: StationAvmsMarker[] = [];
  for (const seed of out.avmsSeeds) {
    const room = roomContaining(out.rooms, seed.right, seed.up, seed.forward);
    if (!room) continue;
    avmsMarkers.push({
      id: seed.id,
      floorId: room.floorId,
      right: seed.right,
      forward: seed.forward,
      radius: seed.radius,
    });
  }

  return {
    rooms: out.rooms,
    doorways: [],
    hangars,
    spawn,
    elevatorMarkers,
    infoMarkers,
    avmsMarkers,
  };
}
