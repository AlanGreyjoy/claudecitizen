import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import { MeshBVH, type HitPointInfo } from "three-mesh-bvh";
import type { Vec3 } from "../types";
import type { PrefabNodeOverride } from "../world/prefabs/schema";

export const CHARACTER_COLLIDER_RADIUS_METERS = 0.42;

/** GLTFLoader sanitizes node names (spaces -> underscores) via PropertyBinding.sanitizeNodeName.
 *  We must match that when looking up nodes by name. */
function sanitizeNodeName(name: string): string {
  return name.replace(/\s/g, '_');
}

/** When a door's open blend crosses this, its collider is skipped/disabled entirely. */
export const DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD = 0.85;

const CAPSULE_SAMPLE_HEIGHTS = [0.25, 0.95, 1.55] as const;
const SCENE_TO_GAMEPLAY = new THREE.Matrix4().makeScale(-1, 1, 1);
const gltfLoader = new GLTFLoader();
const meshAssetCache = new Map<string, Promise<MeshColliderAsset | null>>();
const meshAssetReady = new Map<string, MeshColliderAsset | null>();

export type ColliderAnimationBinding =
  | {
      kind: "door";
      doorId: string;
      motion: "slide" | "hinge";
      axis: "x" | "y" | "z";
      delta: number;
    }
  | { kind: "ramp"; axis: "x" | "y" | "z"; radians: number }
  | { kind: "gear"; axis: "x" | "y" | "z"; radians: number };

export interface ShipColliderRigState {
  gear01?: number;
  ramp01?: number;
  doors?: Record<string, number>;
}

interface ColliderBase {
  id: string;
  node?: string;
  baseLocalToSpace: THREE.Matrix4;
  animation?: ColliderAnimationBinding;
}

export interface BoxGameplayCollider extends ColliderBase {
  kind: "box";
  halfSize: Vec3;
}

export interface MeshGameplayCollider extends ColliderBase {
  kind: "mesh";
  assetUrl: string;
  convex: boolean;
  nodeOverrides?: PrefabNodeOverride[];
  /** Match ship_model.ts bbox recenter so colliders align with ship-local gameplay coords. */
  recenterHull?: boolean;
}

export type GameplayCollider = BoxGameplayCollider | MeshGameplayCollider;

export interface MeshColliderAsset {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
  convexHull?: ConvexHull;
  bounds: THREE.Box3;
  /** Node matrixWorld at bake (GLB scene space). */
  restNodeWorld: THREE.Matrix4;
  parentWorldAtBake: THREE.Matrix4;
  nodeBasePosition: THREE.Vector3;
  nodeBaseQuaternion: THREE.Quaternion;
  nodeBaseScale: THREE.Vector3;
}

interface ResolveCollisionParams {
  right: number;
  forward: number;
  floorUp: number;
  colliders: readonly GameplayCollider[];
  rig?: ShipColliderRigState;
  isAllowed?: (local: { right: number; forward: number }) => boolean;
}

const AXIS_ROTATIONS = {
  x: (radians: number) => new THREE.Matrix4().makeRotationX(radians),
  y: (radians: number) => new THREE.Matrix4().makeRotationY(radians),
  z: (radians: number) => new THREE.Matrix4().makeRotationZ(radians),
} as const;

const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function vecFromThree(vector: THREE.Vector3): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function horizontalLength(vector: THREE.Vector3): number {
  return Math.hypot(vector.x, vector.z);
}

function colliderScale(localToSpace: THREE.Matrix4): number {
  const elements = localToSpace.elements;
  const sx = Math.hypot(elements[0], elements[1], elements[2]);
  const sy = Math.hypot(elements[4], elements[5], elements[6]);
  const sz = Math.hypot(elements[8], elements[9], elements[10]);
  return Math.max(1e-6, Math.min(sx, sy, sz));
}

function matrixForAnimation(
  animation: ColliderAnimationBinding | undefined,
  rig: ShipColliderRigState | undefined,
): THREE.Matrix4 | null {
  if (!animation || !rig) return null;
  if (animation.kind === "door") {
    const open01 = rig.doors?.[animation.doorId] ?? 0;
    if (Math.abs(open01) < 1e-6) return null;
    if (animation.motion === "slide") {
      const distance = animation.delta * open01;
      switch (animation.axis) {
        case "x":
          return new THREE.Matrix4().makeTranslation(distance, 0, 0);
        case "y":
          return new THREE.Matrix4().makeTranslation(0, distance, 0);
        case "z":
          return new THREE.Matrix4().makeTranslation(0, 0, distance);
      }
    }
    return AXIS_ROTATIONS[animation.axis](animation.delta * open01);
  }
  const blend = animation.kind === "ramp" ? (rig.ramp01 ?? 0) : (rig.gear01 ?? 0);
  if (Math.abs(blend) < 1e-6) return null;
  return AXIS_ROTATIONS[animation.axis](animation.radians * blend);
}

function animatedLocalToSpace(
  collider: GameplayCollider,
  rig: ShipColliderRigState | undefined,
): THREE.Matrix4 {
  const animationMatrix = matrixForAnimation(collider.animation, rig);
  if (!animationMatrix) return collider.baseLocalToSpace;
  return collider.baseLocalToSpace.clone().multiply(animationMatrix);
}

function transformedAabb(
  bounds: THREE.Box3,
  localToSpace: THREE.Matrix4,
  expandBy = 0,
): THREE.Box3 {
  const out = new THREE.Box3().makeEmpty();
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i += 1) {
    corner.set(
      (i & 1) === 0 ? bounds.min.x : bounds.max.x,
      (i & 2) === 0 ? bounds.min.y : bounds.max.y,
      (i & 4) === 0 ? bounds.min.z : bounds.max.z,
    );
    out.expandByPoint(corner.applyMatrix4(localToSpace));
  }
  if (expandBy > 0) out.expandByScalar(expandBy);
  return out;
}

function pointInAabb(point: THREE.Vector3, box: THREE.Box3): boolean {
  return (
    point.x >= box.min.x &&
    point.x <= box.max.x &&
    point.y >= box.min.y &&
    point.y <= box.max.y &&
    point.z >= box.min.z &&
    point.z <= box.max.z
  );
}

function getColumnAxis(matrix: THREE.Matrix4, column: 0 | 1 | 2): THREE.Vector3 {
  const elements = matrix.elements;
  const offset = column * 4;
  return new THREE.Vector3(
    elements[offset],
    elements[offset + 1],
    elements[offset + 2],
  ).normalize();
}

function boxPush(
  collider: BoxGameplayCollider,
  sample: THREE.Vector3,
  localToSpace: THREE.Matrix4,
): THREE.Vector3 | null {
  const localBounds = new THREE.Box3(
    new THREE.Vector3(-collider.halfSize.x, -collider.halfSize.y, -collider.halfSize.z),
    new THREE.Vector3(collider.halfSize.x, collider.halfSize.y, collider.halfSize.z),
  );
  const worldBounds = transformedAabb(localBounds, localToSpace, CHARACTER_COLLIDER_RADIUS_METERS);
  if (!pointInAabb(sample, worldBounds)) return null;

  const spaceToLocal = localToSpace.clone().invert();
  const local = sample.clone().applyMatrix4(spaceToLocal);
  const closestLocal = new THREE.Vector3(
    clamp(local.x, -collider.halfSize.x, collider.halfSize.x),
    clamp(local.y, -collider.halfSize.y, collider.halfSize.y),
    clamp(local.z, -collider.halfSize.z, collider.halfSize.z),
  );
  const closest = closestLocal.clone().applyMatrix4(localToSpace);
  const delta = sample.clone().sub(closest);
  const distance = delta.length();
  const inside =
    local.x > -collider.halfSize.x &&
    local.x < collider.halfSize.x &&
    local.y > -collider.halfSize.y &&
    local.y < collider.halfSize.y &&
    local.z > -collider.halfSize.z &&
    local.z < collider.halfSize.z;

  if (!inside) {
    if (distance >= CHARACTER_COLLIDER_RADIUS_METERS || distance < 1e-6) {
      return null;
    }
    return delta.multiplyScalar((CHARACTER_COLLIDER_RADIUS_METERS - distance) / distance);
  }

  const faceDistances = [
    { distance: collider.halfSize.x - local.x, axis: 0 as const, sign: 1 },
    { distance: local.x + collider.halfSize.x, axis: 0 as const, sign: -1 },
    { distance: collider.halfSize.z - local.z, axis: 2 as const, sign: 1 },
    { distance: local.z + collider.halfSize.z, axis: 2 as const, sign: -1 },
  ].sort((a, b) => a.distance - b.distance);
  const face = faceDistances[0]!;
  const normal = getColumnAxis(localToSpace, face.axis).multiplyScalar(face.sign);
  const faceLocal = local.clone();
  if (face.axis === 0) faceLocal.x = face.sign > 0 ? collider.halfSize.x : -collider.halfSize.x;
  if (face.axis === 2) faceLocal.z = face.sign > 0 ? collider.halfSize.z : -collider.halfSize.z;
  const facePoint = faceLocal.applyMatrix4(localToSpace);
  return normal.multiplyScalar(CHARACTER_COLLIDER_RADIUS_METERS + sample.distanceTo(facePoint));
}

function isIdentityPrefabTransform(transform: {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
}): boolean {
  const eps = 1e-6;
  const { position: p, rotation: r, scale: s } = transform;
  return (
    Math.abs(p.x) < eps &&
    Math.abs(p.y) < eps &&
    Math.abs(p.z) < eps &&
    Math.abs(r.x) < eps &&
    Math.abs(r.y) < eps &&
    Math.abs(r.z) < eps &&
    Math.abs(r.w - 1) < eps &&
    Math.abs(s.x - 1) < eps &&
    Math.abs(s.y - 1) < eps &&
    Math.abs(s.z - 1) < eps
  );
}

function applyNodeOverrides(
  root: THREE.Object3D,
  overrides: readonly PrefabNodeOverride[] | undefined,
): void {
  if (!overrides) return;
  for (const override of overrides) {
    if (!override.transform || isIdentityPrefabTransform(override.transform)) continue;
    const object = root.getObjectByName(sanitizeNodeName(override.node));
    if (!object) continue;
    const { position, rotation, scale } = override.transform;
    object.position.set(position.x, position.y, position.z);
    object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    object.scale.set(scale.x, scale.y, scale.z);
  }
}

function appendMeshPositions(
  mesh: THREE.Mesh,
  toAssetLocal: THREE.Matrix4,
  out: number[],
): void {
  const position = mesh.geometry.getAttribute("position");
  if (!position) return;
  const index = mesh.geometry.getIndex();
  const point = new THREE.Vector3();
  const count = index ? index.count : position.count;
  for (let i = 0; i < count; i += 1) {
    const vertexIndex = index ? index.getX(i) : i;
    point.fromBufferAttribute(position, vertexIndex).applyMatrix4(toAssetLocal);
    out.push(point.x, point.y, point.z);
  }
}

function meshCacheKey(
  url: string,
  node: string | undefined,
  convex: boolean,
  overrides: readonly PrefabNodeOverride[] | undefined,
  recenterHull: boolean,
): string {
  return JSON.stringify({
    url,
    node: node ?? "",
    convex,
    overrides: overrides ?? [],
    recenterHull,
  });
}

/** Mirrors ship_model.ts / editor viewport hull recentering. */
function recenterGltfSceneRoot(scene: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.sub(center);
  scene.updateMatrixWorld(true);
}

function prepareGltfScene(
  scene: THREE.Object3D,
  overrides: readonly PrefabNodeOverride[] | undefined,
  recenterHull: boolean,
): void {
  applyNodeOverrides(scene, overrides);
  scene.updateMatrixWorld(true);
  if (recenterHull) recenterGltfSceneRoot(scene);
}

export async function loadMeshAsset(collider: MeshGameplayCollider): Promise<MeshColliderAsset | null> {
  const key = meshCacheKey(
    collider.assetUrl,
    collider.node,
    collider.convex,
    collider.nodeOverrides,
    collider.recenterHull ?? false,
  );
  let pending = meshAssetCache.get(key);
  if (!pending) {
    pending = gltfLoader
      .loadAsync(collider.assetUrl)
      .then((gltf) => {
        const scene = gltf.scene;
        prepareGltfScene(scene, collider.nodeOverrides, collider.recenterHull ?? false);
        const root = collider.node ? scene.getObjectByName(sanitizeNodeName(collider.node)) : scene;
        if (!root) {
          console.warn(
            `Collider node "${collider.node}" not found in ${collider.assetUrl}.`,
          );
          meshAssetReady.set(key, null);
          return null;
        }

        const assetLocalFromWorld = collider.node
          ? root.matrixWorld.clone().invert()
          : scene.matrixWorld.clone().invert();
        const parentWorldAtBake =
          collider.node && root.parent
            ? root.parent.matrixWorld.clone()
            : new THREE.Matrix4();
        const restNodeWorld = root.matrixWorld.clone();
        const vertices: number[] = [];
        root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const toAssetLocal = assetLocalFromWorld.clone().multiply(object.matrixWorld);
          appendMeshPositions(object, toAssetLocal, vertices);
        });
        if (vertices.length < 9) {
          meshAssetReady.set(key, null);
          return null;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(vertices, 3),
        );
        geometry.computeBoundingBox();
        geometry.computeVertexNormals();
        const bvh = new MeshBVH(geometry);
        const points: THREE.Vector3[] = [];
        const positions = geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i += 1) {
          points.push(new THREE.Vector3().fromBufferAttribute(positions, i));
        }
        const asset = {
          geometry,
          bvh,
          convexHull: collider.convex
            ? new ConvexHull().setFromPoints(points)
            : undefined,
          bounds: geometry.boundingBox?.clone() ?? new THREE.Box3(),
          restNodeWorld,
          parentWorldAtBake,
          nodeBasePosition: root.position.clone(),
          nodeBaseQuaternion: root.quaternion.clone(),
          nodeBaseScale: root.scale.clone(),
        };
        meshAssetReady.set(key, asset);
        return asset;
      })
      .catch((error) => {
        console.warn(`Collider mesh failed to load: ${collider.assetUrl}`, error);
        meshAssetCache.delete(key);
        meshAssetReady.delete(key);
        return null;
      });
    meshAssetCache.set(key, pending);
  }
  return pending;
}

/** Preloads BVH geometry for every mesh collider in a layout. */
export async function preloadMeshColliders(
  colliders: readonly GameplayCollider[],
): Promise<void> {
  const meshColliders = colliders.filter(
    (collider): collider is MeshGameplayCollider => collider.kind === "mesh",
  );
  await Promise.all(meshColliders.map((collider) => loadMeshAsset(collider)));
}

/** Warns when a mesh collider failed to bake (missing node, empty mesh, load error). */
export function validateMeshColliders(colliders: readonly GameplayCollider[]): void {
  for (const collider of colliders) {
    if (collider.kind !== "mesh") continue;
    const asset = getMeshAsset(collider);
    if (asset) continue;
    const nodeLabel = collider.node ? ` node="${collider.node}"` : "";
    console.warn(
      `Mesh collider "${collider.id}"${nodeLabel} failed to bake from ${collider.assetUrl}.`,
    );
  }
}

function getMeshAsset(collider: MeshGameplayCollider): MeshColliderAsset | null {
  const key = meshCacheKey(
    collider.assetUrl,
    collider.node,
    collider.convex,
    collider.nodeOverrides,
    collider.recenterHull ?? false,
  );
  if (meshAssetReady.has(key)) return meshAssetReady.get(key) ?? null;
  if (!meshAssetCache.has(key)) {
    void loadMeshAsset(collider);
    return null;
  }
  return null;
}

function triangleNormal(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): THREE.Vector3 {
  const position = geometry.getAttribute("position");
  const a = new THREE.Vector3().fromBufferAttribute(position, faceIndex * 3);
  const b = new THREE.Vector3().fromBufferAttribute(position, faceIndex * 3 + 1);
  const c = new THREE.Vector3().fromBufferAttribute(position, faceIndex * 3 + 2);
  return b.sub(a).cross(c.sub(a)).normalize();
}

function transformDirection(
  direction: THREE.Vector3,
  localToSpace: THREE.Matrix4,
): THREE.Vector3 {
  const origin = new THREE.Vector3().applyMatrix4(localToSpace);
  return direction
    .clone()
    .applyMatrix4(localToSpace)
    .sub(origin)
    .normalize();
}

function animatedNodeWorldMatrix(
  asset: MeshColliderAsset,
  animation: ColliderAnimationBinding | undefined,
  rig: ShipColliderRigState | undefined,
): THREE.Matrix4 {
  if (!animation || !rig) return asset.restNodeWorld.clone();

  const localMatrix = new THREE.Matrix4();
  if (animation.kind === "door") {
    const open01 = rig.doors?.[animation.doorId] ?? 0;
    if (Math.abs(open01) < 1e-6) return asset.restNodeWorld.clone();
    if (animation.motion === "slide") {
      const position = asset.nodeBasePosition
        .clone()
        .add(AXIS_VECTORS[animation.axis].clone().multiplyScalar(animation.delta * open01));
      localMatrix.compose(
        position,
        asset.nodeBaseQuaternion,
        asset.nodeBaseScale,
      );
      return asset.parentWorldAtBake.clone().multiply(localMatrix);
    }
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      AXIS_VECTORS[animation.axis],
      animation.delta * open01,
    );
    localMatrix.compose(
      asset.nodeBasePosition,
      asset.nodeBaseQuaternion.clone().multiply(rotation),
      asset.nodeBaseScale,
    );
    return asset.parentWorldAtBake.clone().multiply(localMatrix);
  }

  const blend = animation.kind === "ramp" ? (rig.ramp01 ?? 0) : (rig.gear01 ?? 0);
  if (Math.abs(blend) < 1e-6) return asset.restNodeWorld.clone();
  const rotation = new THREE.Quaternion().setFromAxisAngle(
    AXIS_VECTORS[animation.axis],
    animation.radians * blend,
  );
  localMatrix.compose(
    asset.nodeBasePosition,
    asset.nodeBaseQuaternion.clone().multiply(rotation),
    asset.nodeBaseScale,
  );
  return asset.parentWorldAtBake.clone().multiply(localMatrix);
}

/** Full gameplay-space matrix for a collider (box or mesh, static or rig-driven). */
export function resolveColliderWorldMatrix(
  collider: GameplayCollider,
  rig?: ShipColliderRigState,
): THREE.Matrix4 {
  if (collider.kind === "box") {
    return animatedLocalToSpace(collider, rig);
  }

  if (!collider.animation || !rig) {
    return collider.baseLocalToSpace;
  }

  const asset = getMeshAsset(collider);
  if (!asset) return collider.baseLocalToSpace;

  const animatedNodeWorld = animatedNodeWorldMatrix(asset, collider.animation, rig);
  return collider.baseLocalToSpace
    .clone()
    .multiply(asset.restNodeWorld.clone().invert())
    .multiply(animatedNodeWorld);
}

function convexPush(
  asset: MeshColliderAsset,
  sample: THREE.Vector3,
  localToSpace: THREE.Matrix4,
  spaceToLocal: THREE.Matrix4,
): THREE.Vector3 | null {
  if (!asset.convexHull) return null;
  const local = sample.clone().applyMatrix4(spaceToLocal);
  const radiusLocal = CHARACTER_COLLIDER_RADIUS_METERS / colliderScale(localToSpace);
  let best: { distance: number; normal: THREE.Vector3 } | null = null;
  for (const face of asset.convexHull.faces) {
    const distance = face.normal.dot(local) - face.constant;
    if (!best || distance > best.distance) {
      best = { distance, normal: face.normal.clone() };
    }
  }
  if (!best || best.distance > radiusLocal) return null;
  const pushedLocal = local
    .clone()
    .add(best.normal.multiplyScalar(radiusLocal - best.distance));
  return pushedLocal.applyMatrix4(localToSpace).sub(sample);
}

function meshPush(
  collider: MeshGameplayCollider,
  sample: THREE.Vector3,
  rig: ShipColliderRigState | undefined,
): THREE.Vector3 | null {
  const asset = getMeshAsset(collider);
  if (!asset) return null;
  const localToSpace = resolveColliderWorldMatrix(collider, rig);
  const worldBounds = transformedAabb(
    asset.bounds,
    localToSpace,
    CHARACTER_COLLIDER_RADIUS_METERS,
  );
  if (!pointInAabb(sample, worldBounds)) return null;

  const spaceToLocal = localToSpace.clone().invert();
  if (collider.convex) {
    return convexPush(asset, sample, localToSpace, spaceToLocal);
  }

  const local = sample.clone().applyMatrix4(spaceToLocal);
  const radiusLocal = CHARACTER_COLLIDER_RADIUS_METERS / colliderScale(localToSpace);
  const hitTarget: HitPointInfo = {
    point: new THREE.Vector3(),
    distance: 0,
    faceIndex: -1,
  };
  const hit = asset.bvh.closestPointToPoint(
    local,
    hitTarget,
    0,
    radiusLocal,
  );
  if (!hit) return null;
  const closest = hit.point.clone().applyMatrix4(localToSpace);
  const delta = sample.clone().sub(closest);
  const distance = delta.length();
  if (distance > CHARACTER_COLLIDER_RADIUS_METERS) return null;

  const localNormal = triangleNormal(asset.geometry, hit.faceIndex);
  const localDelta = local.clone().sub(hit.point);
  const behindFace = localDelta.dot(localNormal) < 0;
  if (behindFace) {
    const normal = transformDirection(localNormal, localToSpace);
    return normal.multiplyScalar(CHARACTER_COLLIDER_RADIUS_METERS + distance);
  }
  if (distance > 1e-6) {
    return delta.multiplyScalar((CHARACTER_COLLIDER_RADIUS_METERS - distance) / distance);
  }
  return transformDirection(localNormal, localToSpace).multiplyScalar(
    CHARACTER_COLLIDER_RADIUS_METERS,
  );
}

function isDoorColliderOpen(
  collider: GameplayCollider,
  rig: ShipColliderRigState | undefined,
): boolean {
  if (!collider.animation || collider.animation.kind !== "door" || !rig) return false;
  const open01 = rig.doors?.[collider.animation.doorId] ?? 0;
  return open01 >= DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD;
}

function isRampColliderActive(
  collider: GameplayCollider,
  rig: ShipColliderRigState | undefined,
): boolean {
  if (!collider.animation || collider.animation.kind !== "ramp") return true;
  return (rig?.ramp01 ?? 0) >= DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD;
}

function colliderBlocksCharacter(
  collider: GameplayCollider,
  rig: ShipColliderRigState | undefined,
): boolean {
  if (isDoorColliderOpen(collider, rig)) return false;
  if (!isRampColliderActive(collider, rig)) return false;
  return true;
}

function colliderPush(
  collider: GameplayCollider,
  sample: THREE.Vector3,
  rig: ShipColliderRigState | undefined,
): THREE.Vector3 | null {
  if (!colliderBlocksCharacter(collider, rig)) return null;
  if (collider.kind === "box") {
    return boxPush(collider, sample, animatedLocalToSpace(collider, rig));
  }
  return meshPush(collider, sample, rig);
}

export function sceneMatrixToGameplayMatrix(sceneMatrix: THREE.Matrix4): THREE.Matrix4 {
  return SCENE_TO_GAMEPLAY.clone().multiply(sceneMatrix);
}

const nodeWorldMatrixCache = new Map<string, Promise<Map<string, THREE.Matrix4>>>();

function nodeMatrixCacheKey(
  assetUrl: string,
  overrides: readonly PrefabNodeOverride[] | undefined,
  recenterHull: boolean,
): string {
  return JSON.stringify({ url: assetUrl, overrides: overrides ?? [], recenterHull });
}

/**
 * Loads a GLB once, applies node overrides, and returns the world matrices of
 * all named nodes in a single pass. Used by collider_runtime to position box
 * colliders attached to GLB nodes via node-override components.
 */
export async function loadNodeWorldMatrices(
  assetUrl: string,
  nodeNames: readonly string[],
  nodeOverrides?: readonly PrefabNodeOverride[],
  recenterHull = false,
): Promise<Map<string, THREE.Matrix4>> {
  if (nodeNames.length === 0) return new Map();
  const key = nodeMatrixCacheKey(assetUrl, nodeOverrides, recenterHull);
  let pending = nodeWorldMatrixCache.get(key);
  if (!pending) {
    pending = gltfLoader
      .loadAsync(assetUrl)
      .then((gltf) => {
        const scene = gltf.scene;
        prepareGltfScene(scene, nodeOverrides, recenterHull);
        const out = new Map<string, THREE.Matrix4>();
        for (const name of nodeNames) {
          const node = scene.getObjectByName(sanitizeNodeName(name));
          if (node) out.set(name, node.matrixWorld.clone());
        }
        return out;
      })
      .catch((error) => {
        console.warn(`Failed to load GLB for node matrices: ${assetUrl}`, error);
        nodeWorldMatrixCache.delete(key);
        return new Map();
      });
    nodeWorldMatrixCache.set(key, pending);
  }
  return pending;
}

export function cloneColliderWithTransform(
  collider: GameplayCollider,
  transform: THREE.Matrix4,
  idPrefix: string,
): GameplayCollider {
  const baseLocalToSpace = transform.clone().multiply(collider.baseLocalToSpace);
  if (collider.kind === "box") {
    return {
      ...collider,
      id: `${idPrefix}:${collider.id}`,
      baseLocalToSpace,
    };
  }
  return {
    ...collider,
    id: `${idPrefix}:${collider.id}`,
    baseLocalToSpace,
  };
}

export function placementMatrix(
  transform: { right: number; up: number; forward: number; rotationY: number },
): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(transform.right, transform.up, transform.forward)
    .multiply(new THREE.Matrix4().makeRotationY(-transform.rotationY));
}

function boxGroundHeight(
  collider: BoxGameplayCollider,
  sample: THREE.Vector3,
  localToSpace: THREE.Matrix4,
): number | null {
  const spaceToLocal = localToSpace.clone().invert();
  const local = sample.clone().applyMatrix4(spaceToLocal);
  if (
    Math.abs(local.x) > collider.halfSize.x ||
    Math.abs(local.z) > collider.halfSize.z
  ) {
    return null;
  }
  const topLocal = new THREE.Vector3(
    local.x,
    collider.halfSize.y,
    local.z,
  );
  const topSpace = topLocal.applyMatrix4(localToSpace);
  return topSpace.y <= sample.y ? topSpace.y : null;
}

const WALKABLE_SURFACE_MIN_UP = 0.5;

function meshGroundHeight(
  collider: MeshGameplayCollider,
  sample: THREE.Vector3,
  rig: ShipColliderRigState | undefined,
): number | null {
  const asset = getMeshAsset(collider);
  if (!asset) return null;
  const localToSpace = resolveColliderWorldMatrix(collider, rig);
  const spaceToLocal = localToSpace.clone().invert();
  const localOrigin = sample.clone().applyMatrix4(spaceToLocal);
  const direction = new THREE.Vector3(0, -1, 0)
    .applyMatrix4(spaceToLocal)
    .sub(new THREE.Vector3().applyMatrix4(spaceToLocal))
    .normalize();
  const ray = new THREE.Ray(localOrigin, direction);
  const intersections = asset.bvh.raycast(ray, THREE.FrontSide);
  let best: number | null = null;
  for (const hit of intersections) {
    if (hit.faceIndex === undefined || hit.faceIndex === null) continue;
    const localNormal = triangleNormal(asset.geometry, hit.faceIndex);
    const worldNormal = transformDirection(localNormal, localToSpace);
    if (worldNormal.y < WALKABLE_SURFACE_MIN_UP) continue;
    const hitSpace = hit.point.clone().applyMatrix4(localToSpace);
    if (hitSpace.y > sample.y) continue;
    if (best === null || hitSpace.y > best) best = hitSpace.y;
  }
  return best;
}

function colliderGroundHeight(
  collider: GameplayCollider,
  sample: THREE.Vector3,
  rig: ShipColliderRigState | undefined,
): number | null {
  if (!colliderBlocksCharacter(collider, rig)) return null;
  if (collider.kind === "box") {
    return boxGroundHeight(collider, sample, animatedLocalToSpace(collider, rig));
  }
  return meshGroundHeight(collider, sample, rig);
}

/**
 * Returns the highest collider surface below (right, up, forward), or null if
 * no collider provides ground there. This lets station/ship walkers use real
 * geometry as a floor instead of relying solely on walk-volume floor heights.
 */
export function sampleColliderGroundHeight(
  right: number,
  up: number,
  forward: number,
  colliders: readonly GameplayCollider[],
  rig?: ShipColliderRigState,
): number | null {
  if (colliders.length === 0) return null;
  const sample = new THREE.Vector3(right, up, forward);
  let best: number | null = null;
  for (const collider of colliders) {
    const height = colliderGroundHeight(collider, sample, rig);
    if (height === null) continue;
    if (height > up) continue;
    if (best === null || height > best) best = height;
  }
  return best;
}

/** Ground height from colliders with a specific rig animation (e.g. ramp mesh only). */
export function sampleColliderGroundHeightForAnimation(
  right: number,
  up: number,
  forward: number,
  colliders: readonly GameplayCollider[],
  kind: ColliderAnimationBinding["kind"],
  rig?: ShipColliderRigState,
): number | null {
  if (colliders.length === 0) return null;
  const sample = new THREE.Vector3(right, up, forward);
  let best: number | null = null;
  for (const collider of colliders) {
    if (collider.animation?.kind !== kind) continue;
    const height = colliderGroundHeight(collider, sample, rig);
    if (height === null) continue;
    if (height > up) continue;
    if (best === null || height > best) best = height;
  }
  return best;
}

export function resolveCharacterAgainstColliders(
  params: ResolveCollisionParams,
): { right: number; forward: number } {
  if (params.colliders.length === 0) {
    return { right: params.right, forward: params.forward };
  }

  let right = params.right;
  let forward = params.forward;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const totalPush = new THREE.Vector3();
    for (const height of CAPSULE_SAMPLE_HEIGHTS) {
      const sample = new THREE.Vector3(right, params.floorUp + height, forward);
      for (const collider of params.colliders) {
        const push = colliderPush(collider, sample, params.rig);
        if (!push) continue;
        push.y = 0;
        if (horizontalLength(push) < 1e-5) continue;
        totalPush.add(push);
      }
    }

    totalPush.y = 0;
    const pushLen = horizontalLength(totalPush);
    if (pushLen < 1e-5) break;
    if (pushLen > CHARACTER_COLLIDER_RADIUS_METERS) {
      totalPush.multiplyScalar(CHARACTER_COLLIDER_RADIUS_METERS / pushLen);
    }

    const candidate = {
      right: right + totalPush.x,
      forward: forward + totalPush.z,
    };
    if (params.isAllowed && !params.isAllowed(candidate)) {
      break;
    }
    right = candidate.right;
    forward = candidate.forward;
  }

  return { right, forward };
}

/** Max horizontal push magnitude needed to clear collider penetration at a deck point. */
export function colliderPenetrationPushMagnitude(
  params: Pick<
    ResolveCollisionParams,
    "right" | "forward" | "floorUp" | "colliders" | "rig"
  >,
): number {
  if (params.colliders.length === 0) return 0;
  let maxLen = 0;
  for (const height of CAPSULE_SAMPLE_HEIGHTS) {
    const sample = new THREE.Vector3(
      params.right,
      params.floorUp + height,
      params.forward,
    );
    for (const collider of params.colliders) {
      const push = colliderPush(collider, sample, params.rig);
      if (!push) continue;
      push.y = 0;
      maxLen = Math.max(maxLen, horizontalLength(push));
    }
  }
  return maxLen;
}

export function colliderDebugCenter(collider: GameplayCollider): Vec3 {
  return vecFromThree(new THREE.Vector3().applyMatrix4(collider.baseLocalToSpace));
}
