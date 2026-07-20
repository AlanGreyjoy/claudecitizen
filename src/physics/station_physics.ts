import * as RAPIER from "@dimforge/rapier3d";
import type { GameplayCollider } from "./colliders";
import type { StationFrame } from "../world/station";
import { stationLocalToWorld, worldToStationLocal } from "../world/station";
import type { Vec3 } from "../types";
import { dot } from "../math/vec3";
import {
  addCollider,
  createPlayerCharacter,
  createRapierWorld,
  removeCollider,
  removeStaticColliders,
  type RapierWorldHandle,
} from "./rapier_world";
import { castCameraOcclusion } from "./camera_occlusion";

export interface StationPhysics {
  world: RAPIER.World;
  player: RapierWorldHandle;
  dynamicColliders: RAPIER.Collider[];
  /** Disable (or re-enable) every static collider bound to the given animation/door id. */
  setDoorColliderEnabled(doorId: string, enabled: boolean): void;
  dispose(): void;
}

export async function createStationPhysics(
  frame: StationFrame,
  spawnWorldPosition: Vec3,
  colliders: readonly GameplayCollider[],
): Promise<StationPhysics> {
  const world = createRapierWorld();
  const local = worldToStationLocal(frame, spawnWorldPosition);
  const player = createPlayerCharacter(world, {
    x: local.right,
    y: local.up,
    z: local.forward,
  });

  // Bake static colliders and track which ones are bound to a door animation
  // so the game loop can toggle them when the door opens/closes.
  const staticColliders: RAPIER.Collider[] = [];
  const doorColliderHandles = new Map<string, RAPIER.Collider[]>();
  for (const collider of colliders) {
    const rapierCollider = await addCollider(world, collider);
    if (!rapierCollider) continue;
    staticColliders.push(rapierCollider);
    if (collider.animation?.kind === "door") {
      const doorId = collider.animation.doorId;
      const list = doorColliderHandles.get(doorId) ?? [];
      list.push(rapierCollider);
      doorColliderHandles.set(doorId, list);
    }
  }

  const physics: StationPhysics = {
    world,
    player,
    dynamicColliders: [],
    setDoorColliderEnabled(doorId: string, enabled: boolean) {
      const handles = doorColliderHandles.get(doorId);
      if (!handles) return;
      for (const collider of handles) collider.setEnabled(enabled);
    },
    dispose() {
      for (const collider of physics.dynamicColliders) {
        removeCollider(world, collider);
      }
      physics.dynamicColliders.length = 0;
      removeStaticColliders(world, staticColliders);
      player.dispose();
      // Rapier has no explicit world destroy in the JS API; remove bodies/colliders above.
    },
  };
  return physics;
}

export async function syncDynamicColliders(
  physics: StationPhysics,
  colliders: readonly GameplayCollider[],
): Promise<void> {
  for (const collider of physics.dynamicColliders) {
    removeCollider(physics.world, collider);
  }
  physics.dynamicColliders.length = 0;
  for (const collider of colliders) {
    const rapierCollider = await addCollider(physics.world, collider);
    if (rapierCollider) physics.dynamicColliders.push(rapierCollider);
  }
}

export function stepStationPhysics(physics: StationPhysics): void {
  physics.world.step();
}

export function moveStationPlayer(
  physics: StationPhysics,
  frame: StationFrame,
  velocity: Vec3,
  dt: number,
): void {
  // velocity is in world/gameplay space; the Rapier world uses station-local
  // axes (x = right, y = up, z = forward). Project the displacement onto the
  // station frame so movement aligns with the rendered station.
  const localVelocity = new RAPIER.Vector3(
    dot(velocity, frame.right),
    dot(velocity, frame.up),
    dot(velocity, frame.forward),
  );
  const desired = new RAPIER.Vector3(
    localVelocity.x * dt,
    localVelocity.y * dt,
    localVelocity.z * dt,
  );
  physics.player.characterController.computeColliderMovement(
    physics.player.playerCollider,
    desired,
  );
  const movement = physics.player.characterController.computedMovement();
  const pos = physics.player.playerBody.translation();
  physics.player.playerBody.setNextKinematicTranslation({
    x: pos.x + movement.x,
    y: pos.y + movement.y,
    z: pos.z + movement.z,
  });
}

export function isStationPlayerGrounded(physics: StationPhysics): boolean {
  return physics.player.characterController.computedGrounded();
}

export function getStationPlayerPosition(
  physics: StationPhysics,
  frame: StationFrame,
): Vec3 {
  const pos = physics.player.playerBody.translation();
  return stationLocalToWorld(frame, {
    right: pos.x,
    up: pos.y,
    forward: pos.z,
  });
}

export function teleportStationPlayer(
  physics: StationPhysics,
  frame: StationFrame,
  worldPosition: Vec3,
): void {
  const local = worldToStationLocal(frame, worldPosition);
  physics.player.playerBody.setTranslation(
    { x: local.right, y: local.up, z: local.forward },
    true,
  );
}

/**
 * Pull a third-person camera in front of the first station collider along
 * the pivot→camera segment. `from`/`to` are world-space; the Rapier world
 * is station-local, so transform in and back out.
 */
export function occludeStationCamera(
  physics: StationPhysics,
  frame: StationFrame,
  from: Vec3,
  to: Vec3,
): Vec3 {
  const pivotLocal = worldToStationLocal(frame, from);
  const cameraLocal = worldToStationLocal(frame, to);
  const clamped = castCameraOcclusion(
    physics.world,
    { x: pivotLocal.right, y: pivotLocal.up, z: pivotLocal.forward },
    { x: cameraLocal.right, y: cameraLocal.up, z: cameraLocal.forward },
    { excludeCollider: physics.player.playerCollider },
  );
  return stationLocalToWorld(frame, {
    right: clamped.x,
    up: clamped.y,
    forward: clamped.z,
  });
}
