import * as RAPIER from "@dimforge/rapier3d";
import type { FlightBody, Vec3 } from "../types";
import { cross, dot, normalize } from "../math/vec3";
import {
  DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD,
  type GameplayCollider,
} from "./colliders";
import {
  addCollider,
  createPlayerCharacter,
  createRapierWorld,
  removeStaticColliders,
  type RapierWorldHandle,
} from "./rapier_world";

function shipRight(ship: FlightBody): Vec3 {
  return normalize(cross(ship.forward, ship.up));
}

export interface ShipLocalPose {
  right: number;
  up: number;
  forward: number;
}

export interface ShipPhysics {
  world: RAPIER.World;
  player: RapierWorldHandle;
  /** Disable (or re-enable) every static collider bound to the given door id. */
  setDoorColliderEnabled(doorId: string, enabled: boolean): void;
  /**
   * Swap ramp colliders: `open` enables the lowered walk mesh and disables the
   * closed door blocker (and vice versa).
   */
  setRampOpen(open: boolean): void;
  dispose(): void;
}

/**
 * Ship-local Rapier world for collider-deck walking.
 * Axes match gameplay: x = right, y = up, z = forward. Hull bodies stay fixed
 * while the flight body moves in world space; character pose is reconstructed
 * from ship basis + local translation.
 */
export async function createShipPhysics(
  spawnLocal: ShipLocalPose,
  colliders: readonly GameplayCollider[],
): Promise<ShipPhysics> {
  const world = createRapierWorld();
  const player = createPlayerCharacter(world, {
    x: spawnLocal.right,
    y: spawnLocal.up,
    z: spawnLocal.forward,
  });
  // Ramp mesh can exceed the station default 50° climb limit in places.
  player.characterController.setMaxSlopeClimbAngle((70 * Math.PI) / 180);
  player.characterController.setMinSlopeSlideAngle((75 * Math.PI) / 180);

  const staticColliders: RAPIER.Collider[] = [];
  const doorColliderHandles = new Map<string, RAPIER.Collider[]>();
  const rampOpenHandles: RAPIER.Collider[] = [];
  const rampClosedHandles: RAPIER.Collider[] = [];
  const openRampRig = { ramp01: 1 };
  const closedRampRig = { ramp01: 0 };

  for (const collider of colliders) {
    const isRamp = collider.animation?.kind === "ramp";
    if (isRamp) {
      // Closed pose blocks the doorway; open pose is the walkable ramp.
      const closedCollider = await addCollider(world, collider, closedRampRig);
      if (closedCollider) {
        staticColliders.push(closedCollider);
        rampClosedHandles.push(closedCollider);
      }
      const openCollider = await addCollider(world, collider, openRampRig);
      if (openCollider) {
        staticColliders.push(openCollider);
        openCollider.setEnabled(false);
        rampOpenHandles.push(openCollider);
      }
      continue;
    }

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

  const physics: ShipPhysics = {
    world,
    player,
    setDoorColliderEnabled(doorId: string, enabled: boolean) {
      const handles = doorColliderHandles.get(doorId);
      if (!handles) return;
      for (const handle of handles) handle.setEnabled(enabled);
    },
    setRampOpen(open: boolean) {
      for (const handle of rampOpenHandles) handle.setEnabled(open);
      for (const handle of rampClosedHandles) handle.setEnabled(!open);
    },
    dispose() {
      removeStaticColliders(world, staticColliders);
      player.dispose();
    },
  };
  return physics;
}

/** Sync door/ramp Rapier enable flags from the current articulation blends. */
export function syncShipArticulationColliders(
  physics: ShipPhysics,
  rig: { ramp01?: number; doors?: Record<string, number> },
  doorIds: readonly string[],
): void {
  const rampOpen =
    (rig.ramp01 ?? 0) >= DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD;
  physics.setRampOpen(rampOpen);
  for (const doorId of doorIds) {
    const open01 = rig.doors?.[doorId] ?? 0;
    physics.setDoorColliderEnabled(
      doorId,
      open01 < DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD,
    );
  }
}

export function stepShipPhysics(physics: ShipPhysics): void {
  physics.world.step();
  depenetrateShipPlayer(physics);
}

/**
 * Push the kinematic capsule out of any static overlap. Rapier's character
 * controller prevents *new* penetration on the move, but once a thin hull
 * triangle is breached the controller will happily walk around inside the wall.
 */
export function depenetrateShipPlayer(physics: ShipPhysics): void {
  const body = physics.player.playerBody;
  const playerCollider = physics.player.playerCollider;
  const pos = body.translation();
  // Sample torso height — walls are vertical; floor recovery is gravity's job.
  const origin = { x: pos.x, y: pos.y + 0.95, z: pos.z };
  const radius = 0.42;
  const skin = 0.02;
  const dirs: Array<{ x: number; z: number }> = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
    { x: 0.707, z: 0.707 },
    { x: -0.707, z: 0.707 },
    { x: 0.707, z: -0.707 },
    { x: -0.707, z: -0.707 },
  ];
  let pushX = 0;
  let pushZ = 0;
  for (const dir of dirs) {
    const ray = new RAPIER.Ray(origin, { x: dir.x, y: 0, z: dir.z });
    const hit = physics.world.castRay(
      ray,
      radius,
      true,
      undefined,
      undefined,
      playerCollider,
    );
    if (!hit) continue;
    const depth = radius - hit.timeOfImpact;
    if (depth <= skin) continue;
    pushX -= dir.x * (depth + skin);
    pushZ -= dir.z * (depth + skin);
  }
  if (Math.abs(pushX) < 1e-5 && Math.abs(pushZ) < 1e-5) return;
  // Cap so a bad frame can't yeet the player across the cabin.
  const len = Math.hypot(pushX, pushZ);
  const maxPush = radius;
  const scale = len > maxPush ? maxPush / len : 1;
  body.setTranslation(
    {
      x: pos.x + pushX * scale,
      y: pos.y,
      z: pos.z + pushZ * scale,
    },
    true,
  );
}

export function moveShipPlayer(
  physics: ShipPhysics,
  ship: FlightBody,
  velocity: Vec3,
  dt: number,
): void {
  const right = shipRight(ship);
  const localVelocity = new RAPIER.Vector3(
    dot(velocity, right),
    dot(velocity, ship.up),
    dot(velocity, ship.forward),
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

export function isShipPlayerGrounded(physics: ShipPhysics): boolean {
  return physics.player.characterController.computedGrounded();
}

/**
 * True when the player is standing on (or still over) a ship static collider.
 * Used to leave deck mode when walking off the ramp / hull — Rapier only.
 */
export function shipHasFloorBelow(
  physics: ShipPhysics,
  maxDropMeters = 1.25,
): boolean {
  if (isShipPlayerGrounded(physics)) return true;
  const pos = physics.player.playerBody.translation();
  // Capsule body Y is feet; probe from mid-torso downward.
  const origin = { x: pos.x, y: pos.y + 0.95, z: pos.z };
  const ray = new RAPIER.Ray(origin, { x: 0, y: -1, z: 0 });
  const hit = physics.world.castRay(
    ray,
    maxDropMeters + 0.95,
    true,
    undefined,
    undefined,
    physics.player.playerCollider,
  );
  return hit !== null;
}

export function getShipPlayerLocal(physics: ShipPhysics): ShipLocalPose {
  const pos = physics.player.playerBody.translation();
  return { right: pos.x, up: pos.y, forward: pos.z };
}

export function getShipPlayerWorldPosition(
  physics: ShipPhysics,
  ship: FlightBody,
): Vec3 {
  const local = getShipPlayerLocal(physics);
  const right = shipRight(ship);
  return {
    x:
      ship.position.x +
      right.x * local.right +
      ship.up.x * local.up +
      ship.forward.x * local.forward,
    y:
      ship.position.y +
      right.y * local.right +
      ship.up.y * local.up +
      ship.forward.y * local.forward,
    z:
      ship.position.z +
      right.z * local.right +
      ship.up.z * local.up +
      ship.forward.z * local.forward,
  };
}

export function teleportShipPlayerLocal(
  physics: ShipPhysics,
  local: ShipLocalPose,
): void {
  physics.player.playerBody.setTranslation(
    { x: local.right, y: local.up, z: local.forward },
    true,
  );
}
