import * as RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import type {
  PlanetSpawnLayer,
  SurfaceSpawnInstance,
  SurfaceSpawnMeshCollision,
  Vec3,
} from '../types';
import { add, cross, distance, normalize, scale, vec3 } from '../math/vec3';
import {
  createPlayerCharacter,
  createRapierWorld,
  removeCollider,
  type RapierWorldHandle,
} from './rapier_world';

const COLLIDER_RADIUS_METERS = 36;
const MAX_ACTIVE_COLLIDERS = 220;
const SUPPORT_PROBE_METERS = 2.4;
/**
 * Rebase the Rapier world when the player walks this far from the physics
 * origin. Absolute planet-radius coords (~6e6 m) destroy float32 precision for
 * sub-meter prop colliders — same reason surface-spawn visuals use a floating
 * origin.
 */
const PHYSICS_REBASE_METERS = 32;

export interface PlanetPropCollisionLookup {
  /** Mesh AABB colliders keyed by assetUrl (from loaded GLBs). */
  meshByAssetUrl?: ReadonlyMap<string, SurfaceSpawnMeshCollision>;
}

export interface PlanetPhysics {
  world: RAPIER.World;
  player: RapierWorldHandle;
  /** Rebuild nearby prop colliders from streamed instances. */
  syncNearby: (
    focus: Vec3,
    instances: readonly SurfaceSpawnInstance[],
    layers: readonly PlanetSpawnLayer[],
    collisionLookup?: PlanetPropCollisionLookup,
  ) => void;
  /** Filter a world-space displacement against prop colliders. */
  filterMovement: (from: Vec3, desiredDelta: Vec3, up: Vec3) => Vec3;
  /**
   * Cast down along -up from slightly above the feet. Returns support distance
   * along -up from `from` when a prop is hit within range; otherwise null.
   */
  probeSupport: (from: Vec3, up: Vec3) => number | null;
  /** Active prop collider count (debug). */
  getActiveColliderCount: () => number;
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

/** Rotate the kinematic body so its +Y (capsule axis) matches planet up. */
function quaternionAlignBodyYToUp(up: Vec3): RAPIER.Quaternion {
  const y = normalize(up);
  const reference =
    Math.abs(y.y) > 0.92 ? vec3(1, 0, 0) : vec3(0, 1, 0);
  const x = normalize(cross(reference, y));
  const z = normalize(cross(x, y));
  return quaternionFromBasis(x, y, z);
}

function layerById(
  layers: readonly PlanetSpawnLayer[],
): Map<string, PlanetSpawnLayer> {
  const map = new Map<string, PlanetSpawnLayer>();
  if (!Array.isArray(layers)) return map;
  for (const layer of layers) {
    if (layer?.id) map.set(layer.id, layer);
  }
  return map;
}

function authoredVolume(layer: PlanetSpawnLayer): number {
  const c = layer.collider;
  if (!c) return 0;
  if (c.shape === 'capsule') {
    const r = c.radius ?? 0.4;
    const h = c.halfHeight ?? 0.5;
    return r * r * (h + r);
  }
  const he = c.halfExtents ?? [0.5, 0.5, 0.5];
  return he[0] * he[1] * he[2];
}

function meshVolume(mesh: SurfaceSpawnMeshCollision): number {
  const [hx, hy, hz] = mesh.halfExtents;
  return hx * hy * hz;
}

export function createPlanetPhysics(spawnPosition: Vec3): PlanetPhysics {
  // Gravity is handled by character locomotion; keep Rapier gravity off.
  const world = createRapierWorld();
  world.gravity = new RAPIER.Vector3(0, 0, 0);

  /** Rapier-space origin in world meters (floating origin). */
  let physicsOrigin: Vec3 = {
    x: spawnPosition.x,
    y: spawnPosition.y,
    z: spawnPosition.z,
  };

  // Player starts at local origin of the physics frame.
  const player = createPlayerCharacter(world, { x: 0, y: 0, z: 0 });

  const active = new Map<
    string,
    {
      collider: RAPIER.Collider;
      instance: SurfaceSpawnInstance;
      /** Changes when mesh bounds load → forces recreate. */
      shapeSig: string;
    }
  >();

  function toLocal(worldPos: Vec3): Vec3 {
    return {
      x: worldPos.x - physicsOrigin.x,
      y: worldPos.y - physicsOrigin.y,
      z: worldPos.z - physicsOrigin.z,
    };
  }

  function clearAll(): void {
    for (const entry of active.values()) {
      removeCollider(world, entry.collider);
    }
    active.clear();
  }

  function rebaseOrigin(focus: Vec3): void {
    physicsOrigin = { x: focus.x, y: focus.y, z: focus.z };
    clearAll();
  }

  function resolveShape(
    layer: PlanetSpawnLayer,
    mesh: SurfaceSpawnMeshCollision | undefined,
  ): {
    shapeSig: string;
    halfExtents: [number, number, number];
    center: [number, number, number];
    useCapsule: boolean;
    capsuleRadius: number;
    capsuleHalfHeight: number;
  } {
    const authored = layer.collider;
    const preferMesh =
      mesh != null &&
      (authored?.shape !== 'capsule') &&
      meshVolume(mesh) >= Math.max(authoredVolume(layer), 0.01);

    if (preferMesh && mesh) {
      return {
        shapeSig: `mesh:${mesh.halfExtents.map((v) => v.toFixed(3)).join('x')}:${mesh.center.map((v) => v.toFixed(3)).join('x')}`,
        halfExtents: mesh.halfExtents,
        center: mesh.center,
        useCapsule: false,
        capsuleRadius: 0,
        capsuleHalfHeight: 0,
      };
    }

    if (authored?.shape === 'capsule') {
      const radius = authored.radius ?? 0.4;
      const halfHeight = authored.halfHeight ?? 0.5;
      return {
        shapeSig: `capsule:${radius.toFixed(3)}:${halfHeight.toFixed(3)}`,
        halfExtents: [radius, halfHeight + radius, radius],
        center: [0, halfHeight + radius, 0],
        useCapsule: true,
        capsuleRadius: radius,
        capsuleHalfHeight: halfHeight,
      };
    }

    const he = (authored?.halfExtents ?? [0.5, 0.5, 0.5]) as [
      number,
      number,
      number,
    ];
    return {
      shapeSig: `box:${he.map((v) => v.toFixed(3)).join('x')}`,
      halfExtents: he,
      center: [0, he[1], 0],
      useCapsule: false,
      capsuleRadius: 0,
      capsuleHalfHeight: 0,
    };
  }

  function addInstanceCollider(
    key: string,
    instance: SurfaceSpawnInstance,
    layer: PlanetSpawnLayer,
    mesh: SurfaceSpawnMeshCollision | undefined,
  ): void {
    if (active.size >= MAX_ACTIVE_COLLIDERS) return;
    const shape = resolveShape(layer, mesh);
    const { x, y, z } = basisFromNormalYaw(instance.normal, instance.yawRadians);
    const rotation = quaternionFromBasis(x, y, z);
    const localPos = toLocal(instance.position);
    const s = Math.max(1e-3, instance.scale);

    // Body at surface contact; collider offset matches visual (mesh center / authored).
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(localPos.x, localPos.y, localPos.z)
      .setRotation(rotation);
    const body = world.createRigidBody(bodyDesc);

    let colliderDesc: RAPIER.ColliderDesc | null = null;
    if (shape.useCapsule) {
      const radius = Math.max(0.05, shape.capsuleRadius * s);
      const halfHeight = Math.max(0.05, shape.capsuleHalfHeight * s);
      colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(
        0,
        halfHeight + radius,
        0,
      );
    } else {
      const hx = Math.max(0.05, shape.halfExtents[0] * s);
      const hy = Math.max(0.05, shape.halfExtents[1] * s);
      const hz = Math.max(0.05, shape.halfExtents[2] * s);
      colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(
        shape.center[0] * s,
        shape.center[1] * s,
        shape.center[2] * s,
      );
    }
    if (!colliderDesc) {
      world.removeRigidBody(body);
      return;
    }
    colliderDesc.setFriction(0.6).setRestitution(0);
    const rapierCollider = world.createCollider(colliderDesc, body);
    active.set(key, {
      collider: rapierCollider,
      instance,
      shapeSig: shape.shapeSig,
    });
  }

  const physics: PlanetPhysics = {
    world,
    player,
    syncNearby(focus, instances, layers, collisionLookup) {
      if (distance(focus, physicsOrigin) >= PHYSICS_REBASE_METERS) {
        rebaseOrigin(focus);
      }

      const lookup = layerById(layers);
      const meshByUrl = collisionLookup?.meshByAssetUrl;
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
        const layer = lookup.get(instance.layerId);
        if (!layer) continue;
        const mesh = meshByUrl?.get(layer.assetUrl);
        const shape = resolveShape(layer, mesh);
        const existing = active.get(key);
        if (existing) {
          if (existing.shapeSig === shape.shapeSig) continue;
          removeCollider(world, existing.collider);
          active.delete(key);
        }
        addInstanceCollider(key, instance, layer, mesh);
      }
    },
    filterMovement(from, desiredDelta, up) {
      if (active.size === 0) return add(from, desiredDelta);

      const localFrom = toLocal(from);
      // Capsule is authored along body +Y; without this, on mid-latitude
      // surfaces the capsule lies nearly sideways vs rock colliders.
      player.playerBody.setRotation(quaternionAlignBodyYToUp(up), true);
      player.playerBody.setTranslation(
        { x: localFrom.x, y: localFrom.y, z: localFrom.z },
        true,
      );
      player.characterController.setUp({ x: up.x, y: up.y, z: up.z });

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
      player.playerBody.setRotation(quaternionAlignBodyYToUp(up), true);
      const worldOrigin = add(from, scale(up, 0.35));
      const localOrigin = toLocal(worldOrigin);
      const dir = scale(up, -1);
      const ray = new RAPIER.Ray(
        { x: localOrigin.x, y: localOrigin.y, z: localOrigin.z },
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
    getActiveColliderCount() {
      return active.size;
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
