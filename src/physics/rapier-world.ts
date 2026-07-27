import * as RAPIER from "@dimforge/rapier3d";
import * as THREE from "three";
import type { Vec3 } from "../types";
import {
  loadMeshAsset,
  resolveColliderWorldMatrix,
  type GameplayCollider,
  type MeshGameplayCollider,
  type ShipColliderRigState,
} from "./colliders";

/**
 * Thin wrapper around a Rapier physics world.
 *
 * Coordinates map 1:1 to gameplay axes: x = right, y = up, z = forward.
 * The world is stepped at a fixed rate and interpolated for rendering.
 */
export interface RapierWorldHandle {
  world: RAPIER.World;
  characterController: RAPIER.KinematicCharacterController;
  playerCollider: RAPIER.Collider;
  playerBody: RAPIER.RigidBody;
  dispose(): void;
}

export interface PhysicsRayHit {
  distance: number;
  normal: Vec3;
  point: Vec3;
}

/**
 * Interaction-group membership bit reserved for NPC capsules.
 *
 * Static geometry and the player keep Rapier's default all-bits membership, so
 * adding NPC bodies changes nothing for them: only NPC capsules carry this
 * single membership bit. Scene queries drop NPCs by passing
 * `QUERY_GROUPS_EXCLUDE_NPCS`, while the player's character controller runs
 * unfiltered and therefore still collides with them.
 */
export const NPC_CAPSULE_MEMBERSHIP = 0x0004;

/** NPC capsule groups: own membership bit, interacts with everything. */
const NPC_CAPSULE_GROUPS = ((NPC_CAPSULE_MEMBERSHIP << 16) | 0xffff) >>> 0;

/**
 * Query interaction groups that hit every collider except NPC capsules.
 *
 * Weapon rays, camera occlusion, and the NPC path probe all use this. NPCs have
 * no health model, so a weapon ray stopping on one would spawn a station impact
 * in mid-air with no damage feedback, and the third-person camera would jump
 * every time an NPC walked between the player and the eye.
 */
export const QUERY_GROUPS_EXCLUDE_NPCS =
  ((0xffff << 16) | (0xffff & ~NPC_CAPSULE_MEMBERSHIP)) >>> 0;

export function castRapierWorldRay(
  world: RAPIER.World,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  excludeCollider?: RAPIER.Collider,
  filterGroups?: number,
): PhysicsRayHit | null {
  const directionLength = Math.hypot(direction.x, direction.y, direction.z);
  if (directionLength < 1e-9 || maxDistance <= 0) return null;
  const dir = {
    x: direction.x / directionLength,
    y: direction.y / directionLength,
    z: direction.z / directionLength,
  };
  const hit = world.castRayAndGetNormal(
    new RAPIER.Ray(origin, dir),
    maxDistance,
    true,
    undefined,
    filterGroups,
    excludeCollider,
  );
  if (!hit) return null;
  return {
    distance: hit.timeOfImpact,
    point: {
      x: origin.x + dir.x * hit.timeOfImpact,
      y: origin.y + dir.y * hit.timeOfImpact,
      z: origin.z + dir.z * hit.timeOfImpact,
    },
    normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
  };
}

export const PLAYER_CAPSULE_RADIUS = 0.42;
export const PLAYER_CAPSULE_HEIGHT = 1.75;
export const PLAYER_CAPSULE_HALF_HEIGHT = PLAYER_CAPSULE_HEIGHT / 2;

/** Tallest ledge the walker steps over instead of colliding with. */
const AUTOSTEP_MAX_HEIGHT_METERS = 0.5;
/** Minimum landable tread depth; below this the step is treated as a wall. */
const AUTOSTEP_MIN_WIDTH_METERS = 0.2;
/** Downward reach that keeps the walker stuck to ground over crests/dips. */
const SNAP_TO_GROUND_METERS = 0.3;

export function createRapierWorld(): RAPIER.World {
  return new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));
}

export function createPlayerCharacter(
  world: RAPIER.World,
  spawnPosition: { x: number; y: number; z: number },
): RapierWorldHandle {
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
    .setRotation({ w: 1, x: 0, y: 0, z: 0 });
  const playerBody = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.capsule(
    PLAYER_CAPSULE_HALF_HEIGHT - PLAYER_CAPSULE_RADIUS,
    PLAYER_CAPSULE_RADIUS,
  )
    .setTranslation(0, PLAYER_CAPSULE_HALF_HEIGHT, 0)
    .setFriction(0.0)
    .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
    .setRestitution(0.0);
  const playerCollider = world.createCollider(colliderDesc, playerBody);

  const characterController = world.createCharacterController(0.05);
  characterController.setUp({ x: 0, y: 1, z: 0 });
  characterController.setSlideEnabled(true);
  characterController.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
  characterController.setMinSlopeSlideAngle((65 * Math.PI) / 180);
  // Stair risers, deck lips, and door sills are authored well under half a
  // metre; without autostep the capsule catches on every one of them.
  characterController.enableAutostep(
    AUTOSTEP_MAX_HEIGHT_METERS,
    AUTOSTEP_MIN_WIDTH_METERS,
    true,
  );
  // Keeps the controller grounded over crests and small dips. Without it
  // `computedGrounded()` flickers false and the walker plays a fall.
  characterController.enableSnapToGround(SNAP_TO_GROUND_METERS);

  return {
    world,
    characterController,
    playerCollider,
    playerBody,
    dispose() {
      world.removeCharacterController(characterController);
      world.removeCollider(playerCollider, true);
      world.removeRigidBody(playerBody);
    },
  };
}

/**
 * Slimmer than the player capsule on purpose: two bodies at the full 0.42 m
 * radius cannot pass each other in the narrower authored corridors, so a
 * roaming NPC would wedge the player against a wall.
 */
export const NPC_CAPSULE_RADIUS = 0.32;
export const NPC_CAPSULE_HEIGHT = 1.75;
const NPC_CAPSULE_HALF_HEIGHT = NPC_CAPSULE_HEIGHT / 2;

export interface NpcCapsuleHandle {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

/**
 * Kinematic capsule that makes an NPC solid to the walking player. There is no
 * character controller behind it — the NPC's own motion stays the analytic
 * wander step in `npc/station-population.ts`; this body only exists so the
 * player's controller has something to slide along.
 */
export function createNpcCapsule(
  world: RAPIER.World,
  position: { x: number; y: number; z: number },
): NpcCapsuleHandle {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ w: 1, x: 0, y: 0, z: 0 }),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(
      NPC_CAPSULE_HALF_HEIGHT - NPC_CAPSULE_RADIUS,
      NPC_CAPSULE_RADIUS,
    )
      .setTranslation(0, NPC_CAPSULE_HALF_HEIGHT, 0)
      .setFriction(0.0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0.0)
      .setCollisionGroups(NPC_CAPSULE_GROUPS),
    body,
  );
  return { body, collider };
}

function gameplayMatrixToRapier(
  baseLocalToSpace: THREE.Matrix4,
): {
  translation: RAPIER.Vector3;
  rotation: RAPIER.Quaternion;
  scale: THREE.Vector3;
} {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  baseLocalToSpace.decompose(position, quaternion, scale);
  return {
    translation: new RAPIER.Vector3(position.x, position.y, position.z),
    rotation: new RAPIER.Quaternion(
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
    ),
    scale,
  };
}

function extractTrimeshData(
  geometry: THREE.BufferGeometry,
  scale: THREE.Vector3,
): { vertices: Float32Array; indices: Uint32Array } {
  const position = geometry.getAttribute("position");
  const src = position.array as Float32Array;
  const vertices = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    vertices[i] = src[i] * scale.x;
    vertices[i + 1] = src[i + 1] * scale.y;
    vertices[i + 2] = src[i + 2] * scale.z;
  }

  const index = geometry.getIndex();
  const baseIndices = index
    ? new Uint32Array(index.array)
    : new Uint32Array(position.count);
  if (!index) {
    for (let i = 0; i < position.count; i += 1) {
      baseIndices[i] = i;
    }
  }

  // Three.js decomposes as M = T * R * S. Baking S into the vertices leaves
  // T * R for the body. A negative scale flips the mesh, so reverse triangle
  // winding to keep collision normals pointing outward.
  const sign = Math.sign(scale.x * scale.y * scale.z);
  if (sign < 0) {
    for (let i = 0; i < baseIndices.length; i += 3) {
      const tmp = baseIndices[i + 1];
      baseIndices[i + 1] = baseIndices[i + 2];
      baseIndices[i + 2] = tmp;
    }
  }

  // Ship / station art meshes are often single-sided shells. Rapier's kinematic
  // character controller will tunnel through and then stay embedded — emit both
  // windings so interior faces block as solidly as exterior ones.
  const indices = new Uint32Array(baseIndices.length * 2);
  indices.set(baseIndices, 0);
  for (let i = 0; i < baseIndices.length; i += 3) {
    indices[baseIndices.length + i] = baseIndices[i];
    indices[baseIndices.length + i + 1] = baseIndices[i + 2];
    indices[baseIndices.length + i + 2] = baseIndices[i + 1];
  }

  return { vertices, indices };
}

async function createMeshCollider(
  world: RAPIER.World,
  collider: MeshGameplayCollider,
  rig?: ShipColliderRigState,
): Promise<RAPIER.Collider | null> {
  const asset = await loadMeshAsset(collider);
  if (!asset) return null;
  const worldMatrix = resolveColliderWorldMatrix(collider, rig);
  const { translation, rotation, scale } = gameplayMatrixToRapier(worldMatrix);
  const { vertices, indices } = extractTrimeshData(asset.geometry, scale);
  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(translation.x, translation.y, translation.z)
    .setRotation(rotation);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
    .setFriction(0.5)
    .setRestitution(0.0);
  return world.createCollider(colliderDesc, body);
}

export async function addCollider(
  world: RAPIER.World,
  collider: GameplayCollider,
  rig?: ShipColliderRigState,
): Promise<RAPIER.Collider | null> {
  if (collider.kind === "box") {
    const worldMatrix =
      rig && collider.animation
        ? resolveColliderWorldMatrix(collider, rig)
        : collider.baseLocalToSpace;
    const { translation, rotation, scale } = gameplayMatrixToRapier(worldMatrix);
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(translation.x, translation.y, translation.z)
      .setRotation(rotation);
    const body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      collider.halfSize.x * Math.abs(scale.x),
      collider.halfSize.y * Math.abs(scale.y),
      collider.halfSize.z * Math.abs(scale.z),
    )
      .setFriction(0.5)
      .setRestitution(0.0);
    return world.createCollider(colliderDesc, body);
  }

  return createMeshCollider(world, collider, rig);
}

export function removeCollider(
  world: RAPIER.World,
  collider: RAPIER.Collider,
): void {
  const body = collider.parent();
  world.removeCollider(collider, false);
  if (body) {
    world.removeRigidBody(body);
  }
}

export async function syncStaticColliders(
  world: RAPIER.World,
  colliders: readonly GameplayCollider[],
): Promise<RAPIER.Collider[]> {
  const out: RAPIER.Collider[] = [];
  for (const collider of colliders) {
    const rapierCollider = await addCollider(world, collider);
    if (rapierCollider) out.push(rapierCollider);
  }
  return out;
}

export function removeStaticColliders(
  world: RAPIER.World,
  colliders: RAPIER.Collider[],
): void {
  for (const collider of colliders) {
    removeCollider(world, collider);
  }
}

export function stepPhysics(world: RAPIER.World): void {
  world.step();
}
