import type { BuildArea } from '../../net/api';
import {
  HANGARS,
  getStationLayoutOverride,
  type StationLocalPoint,
  type StationRoom,
} from '../../world/station';
import { buildRoomForArea } from './validation';

export interface BuildPlacementFrame {
  /** Authored scene floor used by the pointer-placement plane. */
  runtimeFloorUp: number;
  /** Convert persisted/server coordinates into the active scene's station-local frame. */
  toRuntime: <T extends StationLocalPoint>(point: T) => T;
  /** Convert an active-scene pointer hit back into persisted/server coordinates. */
  toStorage: <T extends StationLocalPoint>(point: T) => T;
}

type PlacementAnchor = StationLocalPoint;

function roomCenter(room: StationRoom): PlacementAnchor {
  return {
    right: (room.minRight + room.maxRight) * 0.5,
    up: room.floorUp,
    forward: (room.minForward + room.maxForward) * 0.5,
  };
}

function isAreaRoom(area: BuildArea, roomId: string): boolean {
  if (area === 'apartment') return roomId === 'hab' || roomId === 'hab-room';
  return roomId === 'hangar' || roomId.startsWith('hangar-');
}

function runtimeAnchor(
  area: BuildArea,
  assignedHangar: number | null | undefined,
): { storage: PlacementAnchor; runtime: PlacementAnchor } | null {
  const layout = getStationLayoutOverride();
  if (!layout) return null;

  const storageRoom = buildRoomForArea(area, assignedHangar);
  const authoredRoom = layout.rooms.find((room) => isAreaRoom(area, room.id));
  if (authoredRoom) {
    return {
      storage: roomCenter(storageRoom),
      runtime: roomCenter(authoredRoom),
    };
  }

  if (area === 'hangar') {
    const hangarIndex =
      assignedHangar === 1 || assignedHangar === 2 || assignedHangar === 3
        ? assignedHangar
        : 2;
    const storagePad = HANGARS.find((hangar) => hangar.index === hangarIndex);
    const runtimePad = layout.hangars.find((hangar) => hangar.index === hangarIndex);
    if (storagePad && runtimePad) {
      return {
        storage: storagePad.padSurfaceLocal,
        runtime: runtimePad.padSurfaceLocal,
      };
    }
  }

  // Instanced hab/hangar scenes are collider-authored and intentionally have
  // no StationRoom AABB. Their spawn marker is the stable local anchor that
  // replaces the old procedural room's center.
  if (isAreaRoom(area, layout.spawn.roomId)) {
    return {
      storage: roomCenter(storageRoom),
      runtime: {
        right: layout.spawn.right,
        up: layout.spawn.up,
        forward: layout.spawn.forward,
      },
    };
  }

  return null;
}

function translate<T extends StationLocalPoint>(
  point: T,
  from: PlacementAnchor,
  to: PlacementAnchor,
): T {
  return {
    ...point,
    right: point.right + to.right - from.right,
    up: point.up + to.up - from.up,
    forward: point.forward + to.forward - from.forward,
  };
}

/**
 * Build placement persistence predates authored scene documents and therefore
 * uses the procedural room coordinates enforced by the server. This frame
 * keeps those coordinates canonical while translating visuals, colliders, and
 * pointer hits into the active instanced scene.
 */
export function createBuildPlacementFrame(
  area: BuildArea,
  assignedHangar: number | null | undefined,
): BuildPlacementFrame {
  const storageRoom = buildRoomForArea(area, assignedHangar);
  const anchors = runtimeAnchor(area, assignedHangar);
  if (!anchors) {
    return {
      runtimeFloorUp: storageRoom.floorUp,
      toRuntime: <T extends StationLocalPoint>(point: T): T => ({ ...point }),
      toStorage: <T extends StationLocalPoint>(point: T): T => ({ ...point }),
    };
  }

  return {
    runtimeFloorUp: storageRoom.floorUp + anchors.runtime.up - anchors.storage.up,
    toRuntime: <T extends StationLocalPoint>(point: T): T =>
      translate(point, anchors.storage, anchors.runtime),
    toStorage: <T extends StationLocalPoint>(point: T): T =>
      translate(point, anchors.runtime, anchors.storage),
  };
}
