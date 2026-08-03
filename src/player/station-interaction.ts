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
  type StationChestStorageMarker,
  type StationDoorSpec,
  type StationFrame,
  type StationSceneExitMarker,
} from '../world/station';
import { nearestLadderMount, type LadderSpec } from '../world/ladders';
import { type ChairSeatSpec } from '../world/chair-seats';
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
  | { kind: 'chair'; chair: ChairSeatSpec }
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
  | { kind: 'chest-storage'; marker: StationChestStorageMarker };

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
  door: Pick<StationDoorSpec, 'right' | 'up' | 'forward' | 'radius' | 'aimRadius'>,
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

function scoreRaycastChest(
  frame: StationFrame,
  chest: StationChestStorageMarker,
  aim: StationDoorInteractAim,
): number | null {
  return scoreRaycastStationDoor(frame, chest, aim);
}

function nearestChestStorage(
  character: StationCharacterState,
  frame: StationFrame,
  chests: StationChestStorageMarker[],
  localUp: number,
  aim?: StationDoorInteractAim | null,
): StationChestStorageMarker | null {
  let best: { chest: StationChestStorageMarker; score: number } | null = null;
  for (const chest of chests) {
    if (chest.trigger === 'raycast') {
      if (!aim) continue;
      const hit = scoreRaycastChest(frame, chest, aim);
      if (hit == null) continue;
      if (!best || hit < best.score) best = { chest, score: hit };
      continue;
    }
    const distance = Math.hypot(
      character.stationLocal.right - chest.right,
      localUp - chest.up,
      character.stationLocal.forward - chest.forward,
    );
    if (distance > chest.radius) continue;
    if (!best || distance < best.score) best = { chest, score: distance };
  }
  return best?.chest ?? null;
}

function nearestStationChair(
  character: StationCharacterState,
  frame: StationFrame,
  chairs: ChairSeatSpec[],
  localUp: number,
  aim?: StationDoorInteractAim | null,
): ChairSeatSpec | null {
  let best: { chair: ChairSeatSpec; score: number } | null = null;
  for (const chair of chairs) {
    if (chair.trigger === 'raycast') {
      if (!aim) continue;
      const hit = scoreRaycastStationDoor(
        frame,
        {
          right: chair.seat.right,
          up: chair.seat.up,
          forward: chair.seat.forward,
          radius: chair.radius,
          aimRadius: chair.aimRadius,
        },
        aim,
      );
      if (hit == null) continue;
      if (!best || hit < best.score) best = { chair, score: hit };
      continue;
    }
    const distance = Math.hypot(
      character.stationLocal.right - chair.seat.right,
      localUp - chair.seat.up,
      character.stationLocal.forward - chair.seat.forward,
    );
    if (distance > chair.radius) continue;
    if (!best || distance < best.score) best = { chair, score: distance };
  }
  return best?.chair ?? null;
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

  const chair = nearestStationChair(
    character,
    frame,
    override.chairs,
    localUp,
    doorAim,
  );
  if (chair) return { kind: 'chair', chair };

  const door = nearestStationDoor(
    character,
    frame,
    override.doors,
    localUp,
    doorAim,
  );
  if (door) return { kind: 'door', door };

  const chest = nearestChestStorage(
    character,
    frame,
    override.chestStorage,
    localUp,
    doorAim,
  );
  if (chest) return { kind: 'chest-storage', marker: chest };

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

/** Park the active ship on a hangar pad in the current station frame. */
export function parkShipOnHangarPad(
  world: WorldState,
  planet: Planet,
  hangar: HangarSpec,
  hangarInstanceId?: string,
): void {
  const ship = getActiveShip(world);
  if (hangarInstanceId) ship.instanceId = hangarInstanceId;
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
}

/**
 * Keep a delivered hull out of the current scene (Station concourse) until
 * the player enters the family hangar. Same far-away trick as AVMS store.
 */
export function stowShipPendingHangar(
  world: WorldState,
  hangarInstanceId?: string,
): void {
  const ship = getActiveShip(world);
  if (hangarInstanceId) ship.instanceId = hangarInstanceId;
  ship.body.position = { x: 0, y: -100000, z: 0 };
  ship.body.velocity = { x: 0, y: 0, z: 0 };
  ship.body.grounded = true;
}

/**
 * Assigns a hangar and parks the player's ship on its pad: engines off,
 * zero velocity, grounded, nose facing the hangar mouth. Returns null when
 * no hangar pads are available. Pads may come from the active layout or
 * (for Station-side AVMS) the family hangar scene via `options.hangars`.
 * When `parkInWorld` is false, only assigns the bay — hull stays stowed
 * until the hangar scene loads.
 */
export async function callShipToHangar(
  world: WorldState,
  planet: Planet,
  seed: number,
  options: {
    ownedShip?: GameBootstrap['ships'][number];
    playerId?: string;
    hangarInstanceId?: string;
    hangars?: HangarSpec[];
    parkInWorld?: boolean;
  } = {},
): Promise<HangarSpec | null> {
  const hangars = options.hangars ?? getStationHangars();
  if (hangars.length === 0) return null;

  const instance = getShipInstance(PLAYER_SHIP_INSTANCE_ID);
  const { ownedShip, playerId, hangarInstanceId } = options;
  if (!instance && ownedShip && playerId && hangarInstanceId) {
    await ensurePlayerShipInstance(ownedShip, playerId, hangarInstanceId);
  } else if (ownedShip && playerId) {
    await applyOwnedShipToInstance(ownedShip, playerId);
  }

  const hangar = hangars[Math.abs(seed) % hangars.length];
  const parkInWorld = options.parkInWorld !== false;
  if (parkInWorld) {
    parkShipOnHangarPad(world, planet, hangar, hangarInstanceId);
  } else {
    world.assignedHangar = hangar.index;
    stowShipPendingHangar(world, hangarInstanceId);
  }
  return hangar;
}
