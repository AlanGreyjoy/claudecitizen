import * as RAPIER from "@dimforge/rapier3d";
import * as THREE from "three";
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

const PLAYER_CAPSULE_RADIUS = 0.42;
const PLAYER_CAPSULE_HEIGHT = 1.75;
const PLAYER_CAPSULE_HALF_HEIGHT = PLAYER_CAPSULE_HEIGHT / 2;

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
  characterController.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  characterController.setMinSlopeSlideAngle((60 * Math.PI) / 180);
  characterController.disableAutostep();
  characterController.disableSnapToGround();

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
