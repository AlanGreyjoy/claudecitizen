import * as THREE from 'three';
import { loadPrefabDocument } from '../../world/prefabs/loader';
import type { HangarPlacementEntry } from '../../net/api';
import {
  HANGAR_FLOOR_UP,
  type PlacementTransform,
} from '../../player/hangar_build/validation';
import {
  cloneObjectMaterials,
  createPropInstanceGroup,
  loadPrefabModel,
} from '../prefabs/prefab_renderer';

export interface HangarPropRendererOptions {
  stationRoot: THREE.Object3D;
  rootName?: string;
}

export interface HangarPropGhost {
  prefabId: string;
  transform: PlacementTransform;
}

export function createHangarPropRenderer(options: HangarPropRendererOptions) {
  const root = new THREE.Group();
  root.name = options.rootName ?? 'hangar-props';
  options.stationRoot.add(root);

  const instanceGroups = new Map<string, THREE.Group>();
  const ghostGroup = new THREE.Group();
  ghostGroup.name = 'hangar-prop-ghost';
  ghostGroup.visible = false;
  root.add(ghostGroup);

  let ghostEntry: HangarPropGhost | null = null;

  function stationLocalToGroupPosition(transform: PlacementTransform): THREE.Vector3 {
    return new THREE.Vector3(-transform.right, transform.up, transform.forward);
  }

  async function ensureInstanceGroup(
    placementId: string,
    prefabId: string,
  ): Promise<THREE.Group> {
    const existing = instanceGroups.get(placementId);
    if (existing) return existing;

    const doc = await loadPrefabDocument(prefabId);
    if (!doc) throw new Error(`Prop prefab "${prefabId}" not found.`);

    const group = createPropInstanceGroup(doc);
    group.name = `${root.name}:${placementId}`;
    root.add(group);
    instanceGroups.set(placementId, group);
    return group;
  }

  function applyTransform(object: THREE.Object3D, transform: PlacementTransform): void {
    const position = stationLocalToGroupPosition(transform);
    object.position.copy(position);
    object.rotation.set(0, transform.rotationY, 0);
  }

  async function setPlacements(placements: HangarPlacementEntry[]): Promise<void> {
    const nextIds = new Set(placements.map((entry) => entry.id));
    for (const [id, group] of instanceGroups.entries()) {
      if (nextIds.has(id)) continue;
      root.remove(group);
      instanceGroups.delete(id);
    }

    await Promise.all(
      placements.map(async (placement) => {
        const group = await ensureInstanceGroup(placement.id, placement.prefabId);
        applyTransform(group, placement);
      }),
    );
  }

  async function setGhost(ghost: HangarPropGhost | null): Promise<void> {
    ghostEntry = ghost;
    ghostGroup.clear();
    ghostGroup.visible = ghost !== null;
    if (!ghost) return;

    const doc = await loadPrefabDocument(ghost.prefabId);
    if (!doc) return;

    const group = createPropInstanceGroup(doc);
    cloneObjectMaterials(group);
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        standard.transparent = true;
        standard.opacity = 0.55;
        standard.depthWrite = false;
      }
    });
    ghostGroup.add(group);
    applyTransform(ghostGroup, ghost.transform);
  }

  function updateGhostTransform(transform: PlacementTransform): void {
    if (!ghostEntry) return;
    ghostEntry = { ...ghostEntry, transform };
    applyTransform(ghostGroup, transform);
  }

  function dispose(): void {
    root.removeFromParent();
    instanceGroups.clear();
    ghostGroup.clear();
  }

  return {
    dispose,
    setPlacements,
    setGhost,
    updateGhostTransform,
    getGhost(): HangarPropGhost | null {
      return ghostEntry;
    },
    preloadPrefab(prefabId: string): Promise<void> {
      return loadPrefabDocument(prefabId).then((doc) => {
        const assetUrl = findFirstAssetUrl(doc?.root);
        if (assetUrl) return loadPrefabModel(assetUrl).then(() => undefined);
      });
    },
  };
}

function findFirstAssetUrl(entity: {
  asset?: { url: string };
  children?: Array<{ asset?: { url: string }; children?: unknown[] }>;
} | undefined): string | null {
  if (!entity) return null;
  if (entity.asset?.url) return entity.asset.url;
  for (const child of entity.children ?? []) {
    const nested = findFirstAssetUrl(child as {
      asset?: { url: string };
      children?: Array<{ asset?: { url: string }; children?: unknown[] }>;
    });
    if (nested) return nested;
  }
  return null;
}

export type HangarPropRenderer = ReturnType<typeof createHangarPropRenderer>;

export function pickStationFloorPoint(
  camera: THREE.Camera,
  pointerNdc: { x: number; y: number },
  stationRoot: THREE.Object3D,
  floorUp: number,
): { right: number; up: number; forward: number } | null {
  stationRoot.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(pointerNdc.x, pointerNdc.y), camera);

  const localOrigin = stationRoot.worldToLocal(raycaster.ray.origin.clone());
  const localEnd = stationRoot.worldToLocal(
    raycaster.ray.origin.clone().add(raycaster.ray.direction),
  );
  const localDirection = localEnd.sub(localOrigin).normalize();
  if (Math.abs(localDirection.y) < 1e-6) return null;

  const distance = (floorUp - localOrigin.y) / localDirection.y;
  if (distance < 0) return null;

  const hit = localOrigin.addScaledVector(localDirection, distance);
  return { right: -hit.x, up: floorUp, forward: hit.z };
}

export function pickHangarFloorPoint(
  camera: THREE.Camera,
  pointerNdc: { x: number; y: number },
  stationRoot: THREE.Object3D,
): { right: number; up: number; forward: number } | null {
  return pickStationFloorPoint(camera, pointerNdc, stationRoot, HANGAR_FLOOR_UP);
}
