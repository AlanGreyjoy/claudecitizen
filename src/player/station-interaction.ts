import { add, length, scale, sub, dot, vec3 } from '../math/vec3';
import {
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
  resolveOrbitCamera,
  CHARACTER_GROUND_OFFSET_METERS,
} from './character-controller';
import {
  getStationFrame,
  getStationHangars,
  getStationLayoutOverride,
  getStationRoom,
  STATION_ANCHORS,
  stationLocalToWorld,
  worldToStationLocal,
  type HangarSpec,
  type StationAnchor,
  type StationDoorSpec,
  type StationFrame,
  type StationSceneExitMarker,
} from '../world/station';
import { nearestLadderMount, type LadderSpec } from '../world/ladders';
import type { GameBootstrap } from '../net/api';
import { applyOwnedShipToInstance, ensurePlayerShipInstance } from '../world/ships';
import { getShipRestHeightMeters } from './ship-layout';
import type { StationCharacterState } from './station-walk';
import type { Planet, Vec3 } from '../types';
import { getShipInstance } from '../flight/ship-world';
import { PLAYER_SHIP_INSTANCE_ID, getActiveShip, type WorldState } from './world-state';

export interface StationDoorInteractAim {
  cameraPos: Vec3;
  cameraForward: Vec3;
}

export type StationInteraction =
  | { kind: 'terminal' }
  | { kind: 'scene-exit'; marker: StationSceneExitMarker }
  | { kind: 'ladder'; ladder: LadderSpec; along: number }
  | {
      kind: 'prefab-info';
      prompt: string;
      id?: string;
      interactionType?: 'info' | 'animation';
      targetAnimationId?: string;
      keyLabel?: string;
      proximitySoundUrl?: string;
      interactSoundUrl?: string;
    }
  | { kind: 'door'; door: StationDoorSpec }
  | { kind: 'avms-terminal' };

/** Build on-foot camera aim for station door raycasts. */
export function resolveStationDoorInteractAim(
  characterPosition: Vec3,
  yawRadians: number,
  pitchRadians: number,
  zoomDistance = 7.4,
): StationDoorInteractAim {
  const orbit = resolveOrbitCamera(
    characterPosition,
    yawRadians,
    pitchRadians,
    ORBIT_PITCH_LIMIT,
  );
  const rig = resolveCharacterCameraRig(orbit, zoomDistance);
  return {
    cameraPos: add(characterPosition, rig.positionOffset),
    cameraForward: orbit.forward,
  };
}

function scoreRaycastStationDoor(
  frame: StationFrame,
  door: StationDoorSpec,
  aim: StationDoorInteractAim,
): number | null {
  const worldPos = stationLocalToWorld(frame, {
    right: door.right,
    up: door.up,
    forward: door.forward,
  });
  const forward = aim.cameraForward;
  const toPoint = sub(worldPos, aim.cameraPos);
  const distance = length(toPoint);
  if (distance > door.radius || distance < 1e-4) return null;

  const along = dot(toPoint, forward);
  if (along < 0.05) return null;

  const closestOnRay = scale(forward, along);
  const perpDistance = length(sub(toPoint, closestOnRay));
  if (perpDistance > door.aimRadius) return null;

  const angular = perpDistance / Math.max(along, 0.05);
  return angular * 10 + along * 0.05;
}

function nearestStationDoor(
  character: StationCharacterState,
  frame: StationFrame,
  doors: StationDoorSpec[],
  localUp: number,
  aim?: StationDoorInteractAim | null,
): StationDoorSpec | null {
  let best: { door: StationDoorSpec; score: number } | null = null;
  for (const door of doors) {
    if (door.trigger === 'raycast') {
      if (!aim) continue;
      const hit = scoreRaycastStationDoor(frame, door, aim);
      if (hit == null) continue;
      if (!best || hit < best.score) best = { door, score: hit };
      continue;
    }
    const distance = Math.hypot(
      character.stationLocal.right - door.right,
      localUp - door.up,
      character.stationLocal.forward - door.forward,
    );
    if (distance > door.radius) continue;
    if (!best || distance < best.score) best = { door, score: distance };
  }
  return best?.door ?? null;
}

function nearAnchor(character: StationCharacterState, anchor: StationAnchor): boolean {
  const room = getStationRoom(character.stationRoomId);
  if (!room || room.floorId !== anchor.floorId) return false;
  return (
    Math.hypot(
      character.stationLocal.right - anchor.right,
      character.stationLocal.forward - anchor.forward,
    ) <= anchor.radius
  );
}

/** Prefab-driven stations resolve interactions from placed markers. */
function resolvePrefabInteraction(
  character: StationCharacterState,
  frame: StationFrame,
  doorAim?: StationDoorInteractAim | null,
): StationInteraction | null {
  const override = getStationLayoutOverride();
  if (!override) return null;

  // Walk volumes are gone; markers carry their own authored height, so use 3D
  // distance to disambiguate stacked floors.
  const localUp = worldToStationLocal(frame, character.position).up;

  for (const marker of override.sceneExitMarkers) {
    // Fly-through exits belong to the ship loop and must not offer an F prompt
    // on foot — a hangar mouth is not a door you press.
    if (marker.trigger !== 'interact') continue;
    const near =
      Math.hypot(
        character.stationLocal.right - marker.right,
        localUp - marker.up,
        character.stationLocal.forward - marker.forward,
      ) <= marker.radius;
    if (near) return { kind: 'scene-exit', marker };
  }

  // Ladders measure to the whole climb line, so the same marker offers a mount
  // at the foot and at the upper deck.
  const mount = nearestLadderMount(override.ladders, {
    right: character.stationLocal.right,
    up: localUp - CHARACTER_GROUND_OFFSET_METERS,
    forward: character.stationLocal.forward,
  });
  if (mount) return { kind: 'ladder', ladder: mount.ladder, along: mount.along };

  for (const avms of override.avmsMarkers) {
    const near =
      Math.hypot(
        character.stationLocal.right - avms.right,
        localUp - avms.up,
        character.stationLocal.forward - avms.forward,
      ) <= avms.radius;
    if (near) return { kind: 'avms-terminal' };
  }

  const door = nearestStationDoor(
    character,
    frame,
    override.doors,
    localUp,
    doorAim,
  );
  if (door) return { kind: 'door', door };

  for (const info of override.infoMarkers) {
    const near =
      Math.hypot(
        character.stationLocal.right - info.right,
        localUp - info.up,
        character.stationLocal.forward - info.forward,
      ) <= info.radius;
    if (near) {
      return {
        kind: 'prefab-info',
        prompt: info.prompt,
        id: info.id,
        interactionType: info.interactionType,
        targetAnimationId: info.targetAnimationId,
        keyLabel: info.keyLabel,
        proximitySoundUrl: info.proximitySoundUrl,
        interactSoundUrl: info.interactSoundUrl,
      };
    }
  }

  return null;
}

export function resolveStationInteraction(
  character: StationCharacterState,
  frame?: StationFrame,
  doorAim?: StationDoorInteractAim | null,
): StationInteraction | null {
  if (getStationLayoutOverride()) {
    return resolvePrefabInteraction(
      character,
      frame ?? getStationFrame({ name: '', radiusMeters: 0 } as Planet),
      doorAim,
    );
  }

  const room = getStationRoom(character.stationRoomId);
  if (!room) return null;

  if (room.floorId === 'lobby' && nearAnchor(character, STATION_ANCHORS.terminal)) {
    return { kind: 'terminal' };
  }
  return null;
}

/**
 * Assigns a hangar and parks the player's ship on its pad: engines off,
 * zero velocity, grounded, nose facing the hangar mouth. Returns null when
 * the active station layout has no hangar pads. If the ship instance was
 * stored (removed), it is recreated from the provided record.
 */
export async function callShipToHangar(
  world: WorldState,
  planet: Planet,
  seed: number,
  options: {
    ownedShip?: GameBootstrap['ships'][number];
    playerId?: string;
    hangarInstanceId?: string;
  } = {},
): Promise<HangarSpec | null> {
  const hangars = getStationHangars();
  if (hangars.length === 0) return null;

  const instance = getShipInstance(PLAYER_SHIP_INSTANCE_ID);
  const { ownedShip, playerId, hangarInstanceId } = options;
  if (!instance && ownedShip && playerId && hangarInstanceId) {
    await ensurePlayerShipInstance(ownedShip, playerId, hangarInstanceId);
  } else if (ownedShip && playerId) {
    await applyOwnedShipToInstance(ownedShip, playerId);
  }

  const hangar = hangars[Math.abs(seed) % hangars.length];
  const ship = getActiveShip(world);
  if (hangarInstanceId) {
    ship.instanceId = hangarInstanceId;
  }
  const frame = getStationFrame(planet);
  const restLocal = {
    ...hangar.padSurfaceLocal,
    up: hangar.padSurfaceLocal.up + getShipRestHeightMeters(),
  };
  ship.body = {
    forward: frame.forward,
    grounded: true,
    position: stationLocalToWorld(frame, restLocal),
    up: frame.up,
    velocity: vec3(0, 0, 0),
  };
  world.assignedHangar = hangar.index;
  return hangar;
}
