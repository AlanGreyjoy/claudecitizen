import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type {
  PrefabDocument,
  PrefabEntity,
  PrefabPrimitive,
} from '../../world/prefabs/schema';

/**
 * Builds Three.js scene graphs from prefab documents. Shared by the runtime
 * station renderer (attached to the main scene via updateShipPlacement) and
 * the editor viewport (per-entity instancing).
 */

const gltfLoader = new GLTFLoader();
const modelCache = new Map<string, Promise<THREE.Group>>();

function prepareModelMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.frustumCulled = false;
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.map) standard.map.colorSpace = THREE.SRGBColorSpace;
      if (standard.emissiveMap) standard.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    }
  });
}

/** Loads a GLB/GLTF once per url and hands out clones (shared geometry/materials). */
export async function loadPrefabModel(url: string): Promise<THREE.Object3D> {
  let pending = modelCache.get(url);
  if (!pending) {
    pending = gltfLoader.loadAsync(url).then((gltf) => {
      prepareModelMaterials(gltf.scene);
      return gltf.scene;
    });
    pending.catch(() => modelCache.delete(url));
    modelCache.set(url, pending);
  }
  const template = await pending;
  return template.clone(true);
}

export function createPrimitiveMesh(primitive: PrefabPrimitive): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(primitive.size.x, primitive.size.y, primitive.size.z);
  const material = new THREE.MeshStandardMaterial({
    color: primitive.color ?? '#4c5663',
    metalness: 0.35,
    roughness: 0.65,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function applyEntityTransform(object: THREE.Object3D, entity: PrefabEntity): void {
  const { position, rotation, scale } = entity.transform;
  object.position.set(position.x, position.y, position.z);
  object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  object.scale.set(scale.x, scale.y, scale.z);
}

function buildEntity(entity: PrefabEntity): THREE.Group {
  const group = new THREE.Group();
  group.name = entity.name;
  group.userData.entityId = entity.id;
  group.frustumCulled = false;
  applyEntityTransform(group, entity);

  if (entity.primitive) {
    group.add(createPrimitiveMesh(entity.primitive));
  }
  if (entity.asset) {
    const castShadow = entity.asset.castShadow ?? true;
    void loadPrefabModel(entity.asset.url)
      .then((model) => {
        if (!castShadow) {
          model.traverse((object) => {
            object.castShadow = false;
          });
        }
        group.add(model);
      })
      .catch((error) => {
        console.warn(`Prefab asset failed to load: ${entity.asset?.url}`, error);
      });
  }

  for (const child of entity.children ?? []) {
    group.add(buildEntity(child));
  }
  return group;
}

/**
 * Builds a station prefab as a placeable group. The group's local axes match
 * updateShipPlacement's orientation (x = -right, y = up, z = forward), same
 * as the procedural station model, so the caller can place it identically.
 */
export function createPrefabStationGroup(doc: PrefabDocument, renderScale: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `prefab:${doc.id}`;
  group.add(buildEntity(doc.root));
  group.scale.setScalar(renderScale);
  group.frustumCulled = false;
  return group;
}

/** Builds a single prop prefab instance (not scaled — caller sets transform). */
export function createPropInstanceGroup(doc: PrefabDocument): THREE.Group {
  const group = new THREE.Group();
  group.name = `prop:${doc.id}`;
  group.add(buildEntity(doc.root));
  group.frustumCulled = false;
  return group;
}
