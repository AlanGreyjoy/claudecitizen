import { getActiveShip } from "../../player/world_state";
import { getShipLayoutForPrefab } from "../../player/ship_layout";
import { worldToShipLocal } from "../../player/ship_interaction";
import { getStationLayoutOverride, worldToStationLocal } from "../../world/station";
import type { SoundListenerPose } from "../../audio/sound_scene";
import {
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_ENTERING_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ENTERING_BED,
  MODE_IN_BED,
  MODE_LEAVING_BED,
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_RIDING_ELEVATOR,
} from "../../player/modes";
import type {
  GameMode,
  NetworkRenderEntity,
  StationNpcRenderState,
  Vec3,
} from "../../types";
import type { LoopContext } from "../loop_context";
import {
  scenePointFromShip,
  sceneVectorFromShip,
  sceneVectorFromStation,
} from "./scene_transforms";
import {
  localFootstepActor,
  remoteFootstepActors,
  stationFootstepActors,
} from "./footstep_actors";

export const STATION_SOUND_MODES = new Set<GameMode>([
  MODE_IN_STATION,
  MODE_RIDING_ELEVATOR,
]);
export const SHIP_SOUND_MODES = new Set<GameMode>([
  MODE_IN_SHIP,
  MODE_ON_SHIP_DECK,
  MODE_ENTERING_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ENTERING_BED,
  MODE_IN_BED,
  MODE_LEAVING_BED,
]);

export interface SceneSounds {
  updateSceneSounds: (
    focusPosition: Vec3,
    stationNpcs: readonly StationNpcRenderState[],
    networkEntities: readonly NetworkRenderEntity[],
    dtSeconds: number,
  ) => void;
}

function resolveListenerWorld(
  ctx: LoopContext,
  focusPosition: Vec3,
): { listenerWorld: Vec3; listenerForward: Vec3; listenerUp: Vec3 } {
  const camera = ctx.renderer?.getCamera();
  const renderScale = ctx.renderer?.getRenderScale() ?? 1;
  const listenerWorld = camera
    ? {
        x: focusPosition.x + camera.position.x / renderScale,
        y: focusPosition.y + camera.position.y / renderScale,
        z: focusPosition.z + camera.position.z / renderScale,
      }
    : ctx.world.character.position;
  const matrix = camera?.matrixWorld.elements;
  const listenerForward = matrix
    ? { x: -matrix[8], y: -matrix[9], z: -matrix[10] }
    : ctx.world.character.forward;
  const listenerUp = matrix
    ? { x: matrix[4], y: matrix[5], z: matrix[6] }
    : ctx.world.character.up;
  return { listenerWorld, listenerForward, listenerUp };
}

function updateStationSounds(
  ctx: LoopContext,
  listenerWorld: Vec3,
  listenerForward: Vec3,
  listenerUp: Vec3,
  stationNpcs: readonly StationNpcRenderState[],
  networkEntities: readonly NetworkRenderEntity[],
  dtSeconds: number,
): void {
  const layout = getStationLayoutOverride();
  const local = worldToStationLocal(ctx.stationFrame, listenerWorld);
  const pose: SoundListenerPose = {
    position: { x: -local.right, y: local.up, z: local.forward },
    forward: sceneVectorFromStation(ctx, listenerForward),
    up: sceneVectorFromStation(ctx, listenerUp),
  };
  ctx.soundScene.setScene(
    ctx.stationPrefab ? `station:${ctx.stationPrefab.id}` : null,
    layout?.sounds ?? [],
  );
  ctx.soundScene.update(pose);
  ctx.footsteps.update(
    dtSeconds,
    pose,
    stationFootstepActors(ctx, stationNpcs, networkEntities),
  );
}

function updateShipSounds(
  ctx: LoopContext,
  listenerWorld: Vec3,
  listenerForward: Vec3,
  listenerUp: Vec3,
  networkEntities: readonly NetworkRenderEntity[],
  dtSeconds: number,
): void {
  const shipInstance = getActiveShip(ctx.world);
  const ship = shipInstance.body;
  const layout = getShipLayoutForPrefab(shipInstance.prefabId);
  const local = worldToShipLocal(ship, listenerWorld);
  ctx.soundScene.setScene(
    `ship:${shipInstance.id}:${shipInstance.prefabId}`,
    layout.sounds,
  );
  const pose: SoundListenerPose = {
    position: { x: -local.right, y: local.up, z: local.forward },
    forward: sceneVectorFromShip(listenerForward, ship),
    up: sceneVectorFromShip(listenerUp, ship),
  };
  ctx.soundScene.update(pose);
  ctx.footsteps.update(dtSeconds, pose, [
    ...(ctx.world.mode === MODE_ON_SHIP_DECK
      ? [
          localFootstepActor(
            ctx,
            scenePointFromShip(ctx.world.character.position, ship),
            "metal",
          ),
        ]
      : []),
    ...remoteFootstepActors(
      networkEntities,
      "metal",
      (position) => scenePointFromShip(position, ship),
      (entity) => entity.shipZoneId !== null,
    ),
  ]);
}

function updatePlanetSounds(
  ctx: LoopContext,
  listenerWorld: Vec3,
  listenerForward: Vec3,
  listenerUp: Vec3,
  networkEntities: readonly NetworkRenderEntity[],
  dtSeconds: number,
): void {
  ctx.soundScene.setScene(null, []);
  const pose: SoundListenerPose = {
    position: listenerWorld,
    forward: listenerForward,
    up: listenerUp,
  };
  ctx.footsteps.update(dtSeconds, pose, [
    ...(ctx.world.mode === MODE_ON_FOOT
      ? [localFootstepActor(ctx, ctx.world.character.position, "terrain")]
      : []),
    ...remoteFootstepActors(
      networkEntities,
      "terrain",
      (position) => position,
      (entity) =>
        entity.mode === MODE_ON_FOOT &&
        entity.stationRoomId === null &&
        entity.shipZoneId === null,
    ),
  ]);
}

/** Spatial sound scene + footstep actor collection for the active mode. */
export function createSceneSounds(ctx: LoopContext): SceneSounds {
  function updateSceneSounds(
    focusPosition: Vec3,
    stationNpcs: readonly StationNpcRenderState[],
    networkEntities: readonly NetworkRenderEntity[],
    dtSeconds: number,
  ): void {
    const { listenerWorld, listenerForward, listenerUp } = resolveListenerWorld(
      ctx,
      focusPosition,
    );

    if (STATION_SOUND_MODES.has(ctx.world.mode)) {
      updateStationSounds(
        ctx,
        listenerWorld,
        listenerForward,
        listenerUp,
        stationNpcs,
        networkEntities,
        dtSeconds,
      );
      return;
    }

    if (SHIP_SOUND_MODES.has(ctx.world.mode)) {
      updateShipSounds(
        ctx,
        listenerWorld,
        listenerForward,
        listenerUp,
        networkEntities,
        dtSeconds,
      );
      return;
    }

    updatePlanetSounds(
      ctx,
      listenerWorld,
      listenerForward,
      listenerUp,
      networkEntities,
      dtSeconds,
    );
  }

  return { updateSceneSounds };
}
