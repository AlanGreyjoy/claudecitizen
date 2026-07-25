import {
  footstepGaitFromAnimation,
  footstepGaitFromIntent,
  type FootstepActor,
  type FootstepSurface,
} from "../../audio/footsteps";
import { WALK_MOVE_THRESHOLD } from "../../player/character_locomotion";
import { getCharacterSettings } from "../../player/character_settings";
import { MODE_IN_STATION } from "../../player/modes";
import { length } from "../../math/vec3";
import type { NetworkRenderEntity, StationNpcRenderState, Vec3 } from "../../types";
import type { LoopContext } from "../loop_context";
import { scenePointFromStation } from "./scene_transforms";

export function localFootstepActor(
  ctx: LoopContext,
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

export function remoteFootstepActors(
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

export function stationFootstepActors(
  ctx: LoopContext,
  stationNpcs: readonly StationNpcRenderState[],
  networkEntities: readonly NetworkRenderEntity[],
): FootstepActor[] {
  const actors: FootstepActor[] = stationNpcs.map((npc) => ({
    id: `station-npc:${npc.id}`,
    position: scenePointFromStation(ctx, npc.position),
    grounded: true,
    gait: footstepGaitFromAnimation(npc.animation),
    surface: "metal",
    spatial: true,
    volume01: 0.72,
  }));
  if (ctx.world.mode === MODE_IN_STATION) {
    actors.push(
      localFootstepActor(
        ctx,
        scenePointFromStation(ctx, ctx.world.character.position),
        "metal",
      ),
    );
  }
  actors.push(
    ...remoteFootstepActors(
      networkEntities,
      "metal",
      (position) => scenePointFromStation(ctx, position),
      (entity) => entity.stationRoomId !== null,
    ),
  );
  return actors;
}
