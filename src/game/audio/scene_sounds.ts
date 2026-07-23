import {
  getActiveShip,
  type getActiveShipBody,
} from "../../player/world_state";
import { getShipLayoutForPrefab } from "../../player/ship_layout";
import { getShipRight, worldToShipLocal } from "../../player/ship_interaction";
import { getStationLayoutOverride, worldToStationLocal } from "../../world/station";
import { dot, length, normalize } from "../../math/vec3";
import type { SoundListenerPose } from "../../audio/sound_scene";
import {
  footstepGaitFromAnimation,
  footstepGaitFromIntent,
  type FootstepActor,
  type FootstepSurface,
} from "../../audio/footsteps";
import { WALK_MOVE_THRESHOLD } from "../../player/character_locomotion";
import { getCharacterSettings } from "../../player/character_settings";
import {
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_ENTERING_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ENTERING_BED,
  MODE_IN_BED,
  MODE_LEAVING_BED,
  MODE_IN_SHIP,
  MODE_RIDING_ELEVATOR,
} from "../../player/modes";
import type {
  GameMode,
  NetworkRenderEntity,
  StationNpcRenderState,
  Vec3,
} from "../../types";
import type { LoopContext } from "../loop_context";

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

/** Spatial sound scene + footstep actor collection for the active mode. */
export function createSceneSounds(ctx: LoopContext): SceneSounds {
  function sceneVectorFromStation(vector: Vec3): Vec3 {
    return {
      x: -dot(vector, ctx.stationFrame.right),
      y: dot(vector, ctx.stationFrame.up),
      z: dot(vector, ctx.stationFrame.forward),
    };
  }

  function scenePointFromStation(point: Vec3): Vec3 {
    const local = worldToStationLocal(ctx.stationFrame, point);
    return { x: -local.right, y: local.up, z: local.forward };
  }

  function sceneVectorFromShip(
    vector: Vec3,
    ship: ReturnType<typeof getActiveShipBody>,
  ): Vec3 {
    const shipForward = normalize(ship.forward);
    return {
      x: -dot(vector, getShipRight(ship)),
      y: dot(vector, ship.up),
      z: dot(vector, shipForward),
    };
  }

  function scenePointFromShip(
    point: Vec3,
    ship: ReturnType<typeof getActiveShipBody>,
  ): Vec3 {
    const local = worldToShipLocal(ship, point);
    return { x: -local.right, y: local.up, z: local.forward };
  }

  function localFootstepActor(
    position: Vec3,
    surface: FootstepSurface,
  ): FootstepActor {
    const speed = length(ctx.world.character.velocity);
    const sprintSpeed = getCharacterSettings().sprintSpeedMetersPerSecond;
    return {
      id: "local-player",
      position,
      grounded: ctx.world.character.grounded,
      gait: footstepGaitFromIntent({
        isMoving: speed > WALK_MOVE_THRESHOLD,
        isSprinting: speed >= sprintSpeed * 0.85,
      }),
      surface,
      spatial: false,
    };
  }

  function stationFootstepActors(
    stationNpcs: readonly StationNpcRenderState[],
    networkEntities: readonly NetworkRenderEntity[],
  ): FootstepActor[] {
    const actors: FootstepActor[] = stationNpcs.map((npc) => ({
      id: `station-npc:${npc.id}`,
      position: scenePointFromStation(npc.position),
      grounded: true,
      gait: footstepGaitFromAnimation(npc.animation),
      surface: "metal",
      spatial: true,
      volume01: 0.72,
    }));
    if (ctx.world.mode === MODE_IN_STATION) {
      actors.push(
        localFootstepActor(
          scenePointFromStation(ctx.world.character.position),
          "metal",
        ),
      );
    }
    actors.push(
      ...remoteFootstepActors(
        networkEntities,
        "metal",
        scenePointFromStation,
        (entity) => entity.stationRoomId !== null,
      ),
    );
    return actors;
  }

  function remoteFootstepActors(
    networkEntities: readonly NetworkRenderEntity[],
    surface: FootstepSurface,
    transformPosition: (position: Vec3) => Vec3,
    include: (entity: NetworkRenderEntity) => boolean,
  ): FootstepActor[] {
    const actors: FootstepActor[] = [];
    for (const entity of networkEntities) {
      if (!entity.character || !include(entity)) continue;
      actors.push({
        id: `remote-player:${entity.id}`,
        position: transformPosition(entity.character.position),
        grounded: true,
        gait: footstepGaitFromAnimation(entity.character.animation),
        surface,
        spatial: true,
        volume01: 0.85,
      });
    }
    return actors;
  }

  function updateSceneSounds(
    focusPosition: Vec3,
    stationNpcs: readonly StationNpcRenderState[],
    networkEntities: readonly NetworkRenderEntity[],
    dtSeconds: number,
  ): void {
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

    if (STATION_SOUND_MODES.has(ctx.world.mode)) {
      const layout = getStationLayoutOverride();
      const local = worldToStationLocal(ctx.stationFrame, listenerWorld);
      const pose: SoundListenerPose = {
        position: { x: -local.right, y: local.up, z: local.forward },
        forward: sceneVectorFromStation(listenerForward),
        up: sceneVectorFromStation(listenerUp),
      };
      ctx.soundScene.setScene(
        ctx.stationPrefab ? `station:${ctx.stationPrefab.id}` : null,
        layout?.sounds ?? [],
      );
      ctx.soundScene.update(pose);
      ctx.footsteps.update(
        dtSeconds,
        pose,
        stationFootstepActors(stationNpcs, networkEntities),
      );
      return;
    }

    if (SHIP_SOUND_MODES.has(ctx.world.mode)) {
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
      ctx.footsteps.update(
        dtSeconds,
        pose,
        [
          ...(ctx.world.mode === MODE_ON_SHIP_DECK
            ? [
                localFootstepActor(
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
        ],
      );
      return;
    }

    ctx.soundScene.setScene(null, []);
    const pose: SoundListenerPose = {
      position: listenerWorld,
      forward: listenerForward,
      up: listenerUp,
    };
    ctx.footsteps.update(
      dtSeconds,
      pose,
      [
        ...(ctx.world.mode === MODE_ON_FOOT
          ? [localFootstepActor(ctx.world.character.position, "terrain")]
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
      ],
    );
  }

  return { updateSceneSounds };
}
