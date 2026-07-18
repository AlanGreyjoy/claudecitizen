import * as RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import type {
  PlanetSpawnLayer,
  SurfaceSpawnInstance,
  Vec3,
} from '../types';
import { add, cross, normalize, scale, vec3 } from '../math/vec3';
import {
  createPlayerCharacter,
  createRapierWorld,
  removeCollider,
  type RapierWorldHandle,
} from './rapier_world';

const COLLIDER_RADIUS_METERS = 36;
const MAX_ACTIVE_COLLIDERS = 220;
const SUPPORT_PROBE_METERS = 2.4;

export interface PlanetPhysics {
  world: RAPIER.World;
  player: RapierWorldHandle;
  /** Rebuild nearby prop colliders from streamed instances. */
  syncNearby: (
    focus: Vec3,
    instances: readonly SurfaceSpawnInstance[],
    layers: readonly PlanetSpawnLayer[],
  ) => void;
  /** Filter a world-space displacement against prop colliders. */
  filterMovement: (from: Vec3, desiredDelta: Vec3, up: Vec3) => Vec3;
  /**
   * Cast down along -up from slightly above the feet. Returns support distance
   * along -up from `from` when a prop is hit within range; otherwise null.
   */
  probeSupport: (from: Vec3, up: Vec3) => number | null;
  dispose: () => void;
}

function instanceKey(instance: SurfaceSpawnInstance): string {
  return [
    instance.layerId,
    instance.position.x.toFixed(2),
    instance.position.y.toFixed(2),
    instance.position.z.toFixed(2),
    instance.scale.toFixed(2),
  ].join('|');
}

function basisFromNormalYaw(
  normal: Vec3,
  yawRadians: number,
): { x: Vec3; y: Vec3; z: Vec3 } {
  const reference =
    Math.abs(normal.y) > 0.92
      ? vec3(1, 0, 0)
      : vec3(0, 1, 0);
  const tangent = normalize(cross(reference, normal));
  const bitangent = normalize(cross(normal, tangent));
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  const x = normalize(
    add(scale(tangent, cos), scale(bitangent, sin)),
  );
  const z = normalize(cross(x, normal));
  return { x, y: normalize(normal), z };
}

function quaternionFromBasis(x: Vec3, y: Vec3, z: Vec3): RAPIER.Quaternion {
  const matrix = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(x.x, x.y, x.z),
    new THREE.Vector3(y.x, y.y, y.z),
    new THREE.Vector3(z.x, z.y, z.z),
  );
  const quat = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return new RAPIER.Quaternion(quat.x, quat.y, quat.z, quat.w);
}

function layerById(
  layers: readonly PlanetSpawnLayer[],
): Map<string, PlanetSpawnLayer> {
  const map = new Map<string, PlanetSpawnLayer>();
  for (const layer of layers) map.set(layer.id, layer);
  return map;
}

export function createPlanetPhysics(spawnPosition: Vec3): PlanetPhysics {
  // Gravity is handled by character locomotion; keep Rapier gravity off.
  const world = createRapierWorld();
  world.gravity = new RAPIER.Vector3(0, 0, 0);

  const player = createPlayerCharacter(world, {
    x: spawnPosition.x,
    y: spawnPosition.y,
    z: spawnPosition.z,
  });

  const active = new Map<
    string,
    { collider: RAPIER.Collider; instance: SurfaceSpawnInstance }
  >();

  function clearAll(): void {
    for (const entry of active.values()) {
      removeCollider(world, entry.collider);
    }
    active.clear();
  }

  function addInstanceCollider(
    key: string,
    instance: SurfaceSpawnInstance,
    layer: PlanetSpawnLayer,
  ): void {
    if (active.size >= MAX_ACTIVE_COLLIDERS) return;
    const { x, y, z } = basisFromNormalYaw(instance.normal, instance.yawRadians);
    const rotation = quaternionFromBasis(x, y, z);
    // Sit the collider on the surface: local +Y is the surface normal.
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(
        instance.position.x,
        instance.position.y,
        instance.position.z,
      )
      .setRotation(rotation);
    const body = world.createRigidBody(bodyDesc);

    let colliderDesc: RAPIER.ColliderDesc | null = null;
    const s = instance.scale;
    if (layer.collider.shape === 'capsule') {
      const radius = (layer.collider.radius ?? 0.4) * s;
      const halfHeight = (layer.collider.halfHeight ?? 0.5) * s;
      colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(
        0,
        halfHeight + radius,
        0,
      );
    } else {
      const he = layer.collider.halfExtents ?? [0.5, 0.5, 0.5];
      colliderDesc = RAPIER.ColliderDesc.cuboid(
        he[0] * s,
        he[1] * s,
        he[2] * s,
      ).setTranslation(0, he[1] * s, 0);
    }
    if (!colliderDesc) {
      world.removeRigidBody(body);
      return;
    }
    colliderDesc.setFriction(0.6).setRestitution(0);
    const collider = world.createCollider(colliderDesc, body);
    active.set(key, { collider, instance });
  }

  const physics: PlanetPhysics = {
    world,
    player,
    syncNearby(focus, instances, layers) {
      const lookup = layerById(layers);
      const radiusSq = COLLIDER_RADIUS_METERS * COLLIDER_RADIUS_METERS;
      const wanted = new Map<string, SurfaceSpawnInstance>();

      for (const instance of instances) {
        const dx = instance.position.x - focus.x;
        const dy = instance.position.y - focus.y;
        const dz = instance.position.z - focus.z;
        if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
        const layer = lookup.get(instance.layerId);
        if (!layer?.enabled || !layer.assetUrl) continue;
        wanted.set(instanceKey(instance), instance);
      }

      for (const key of [...active.keys()]) {
        if (!wanted.has(key)) {
          const entry = active.get(key);
          if (entry) removeCollider(world, entry.collider);
          active.delete(key);
        }
      }

      for (const [key, instance] of wanted) {
        if (active.has(key)) continue;
        const layer = lookup.get(instance.layerId);
        if (!layer) continue;
        addInstanceCollider(key, instance, layer);
      }
    },
    filterMovement(from, desiredDelta, up) {
      if (active.size === 0) return add(from, desiredDelta);

      player.characterController.setUp({ x: up.x, y: up.y, z: up.z });
      player.playerBody.setTranslation(
        { x: from.x, y: from.y, z: from.z },
        true,
      );

      player.characterController.computeColliderMovement(
        player.playerCollider,
        new RAPIER.Vector3(desiredDelta.x, desiredDelta.y, desiredDelta.z),
      );
      const movement = player.characterController.computedMovement();
      return {
        x: from.x + movement.x,
        y: from.y + movement.y,
        z: from.z + movement.z,
      };
    },
    probeSupport(from, up) {
      if (active.size === 0) return null;
      const origin = add(from, scale(up, 0.35));
      const dir = scale(up, -1);
      const ray = new RAPIER.Ray(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: dir.x, y: dir.y, z: dir.z },
      );
      const hit = world.castRay(
        ray,
        SUPPORT_PROBE_METERS,
        true,
        undefined,
        undefined,
        player.playerCollider,
      );
      if (!hit) return null;
      // Distance from feet (`from`) along -up to the hit.
      return Math.max(0, hit.timeOfImpact - 0.35);
    },
    dispose() {
      clearAll();
      player.dispose();
    },
  };

  return physics;
}

export function planetPhysicsColliderRadiusMeters(): number {
  return COLLIDER_RADIUS_METERS;
}
