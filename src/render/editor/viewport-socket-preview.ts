import type * as THREE from 'three';
import type { EditorEntity, EditorStore } from '../../editor/document';
import { listWeaponDefinitions } from '../../net/admin-api';
import type { WeaponSlotType } from '../../types/equipment';
import { disposeOwnedGpuResources } from '../assets/gpu-dispose';
import { createWebGpuParticleMaterial } from '../particles/node-material';
import { createPropInstanceGroupAsync } from '../prefabs/prefab-renderer';
import { loadPrefabDocument } from '../../world/prefabs/loader';

const PREVIEW_FLAG = 'editorSocketWeaponPreview';

const FALLBACK_PREFAB_IDS: Record<WeaponSlotType, readonly string[]> = {
  rifle: ['asteron-rifle'],
  handgun: ['asteron-sidearm', 'asteron-handgun', 'asteron-pistol'],
  sword: ['asteron-sword'],
};

export interface ViewportSocketPreview {
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  apply: (options?: { quiet?: boolean }) => void;
  dispose: () => void;
}

function collectSocketEntities(
  roots: readonly EditorEntity[],
): Array<{ entityId: string; accepts: WeaponSlotType; socketId: string }> {
  const sockets: Array<{ entityId: string; accepts: WeaponSlotType; socketId: string }> = [];
  const visit = (entities: readonly EditorEntity[]): void => {
    for (const entity of entities) {
      for (const component of entity.components) {
        if (component.type === 'equipment-socket') {
          sockets.push({
            entityId: entity.id,
            accepts: component.accepts,
            socketId: component.id,
          });
        }
      }
      visit(entity.children);
    }
  };
  visit(roots);
  return sockets;
}

function disposePreviewRoot(root: THREE.Object3D): void {
  root.removeFromParent();
  disposeOwnedGpuResources(root);
}

export function createViewportSocketPreview(
  store: EditorStore,
  objectsById: Map<string, THREE.Group>,
): ViewportSocketPreview {
  let enabled = false;
  let generation = 0;
  const previewRoots: THREE.Object3D[] = [];
  const prefabIdByAccepts = new Map<WeaponSlotType, string | null>();
  let resolving: Promise<void> | null = null;

  function clearPreviews(): void {
    for (const root of previewRoots) disposePreviewRoot(root);
    previewRoots.length = 0;
  }

  async function resolvePrefabId(accepts: WeaponSlotType): Promise<string | null> {
    if (prefabIdByAccepts.has(accepts)) return prefabIdByAccepts.get(accepts) ?? null;
    try {
      const weapons = await listWeaponDefinitions();
      const match = weapons.find(
        (weapon) => weapon.weaponSlotType === accepts && Boolean(weapon.prefabId),
      );
      if (match?.prefabId) {
        prefabIdByAccepts.set(accepts, match.prefabId);
        return match.prefabId;
      }
    } catch {
      // Admin catalog optional — fall through to project defaults.
    }
    for (const id of FALLBACK_PREFAB_IDS[accepts]) {
      const doc = await loadPrefabDocument(id);
      if (doc) {
        prefabIdByAccepts.set(accepts, id);
        return id;
      }
    }
    prefabIdByAccepts.set(accepts, null);
    return null;
  }

  async function rebuildPreviews(quiet: boolean): Promise<void> {
    const gen = ++generation;
    clearPreviews();
    if (!enabled) return;

    const state = store.getState();
    if (state.documentType !== 'prefab' || state.kind !== 'item') return;

    const sockets = collectSocketEntities(state.roots);
    if (sockets.length === 0) return;

    const missing: string[] = [];
    for (const socket of sockets) {
      if (gen !== generation || !enabled) return;
      const parent = objectsById.get(socket.entityId);
      if (!parent) continue;
      const prefabId = await resolvePrefabId(socket.accepts);
      if (!prefabId) {
        missing.push(`${socket.socketId} (${socket.accepts})`);
        continue;
      }
      const doc = await loadPrefabDocument(prefabId);
      if (gen !== generation || !enabled) return;
      if (!doc) {
        missing.push(`${socket.socketId} → ${prefabId}`);
        continue;
      }
      const item = await createPropInstanceGroupAsync(doc, {
        pinModels: true,
        particleMaterialFactory: createWebGpuParticleMaterial,
      });
      if (gen !== generation || !enabled) {
        disposePreviewRoot(item);
        return;
      }
      item.userData[PREVIEW_FLAG] = true;
      item.name = `socket-preview:${socket.socketId}`;
      // Identity in socket space — rotate/move the socket entity itself.
      item.position.set(0, 0, 0);
      item.quaternion.identity();
      item.scale.set(1, 1, 1);
      parent.add(item);
      previewRoots.push(item);
    }

    if (!quiet && missing.length > 0) {
      console.warn(
        `[AsteronEngine] Socket weapon preview missing for: ${missing.join(', ')}. ` +
          'Catalog a matching weapon or add a project item prefab.',
      );
    }
  }

  function apply(options?: { quiet?: boolean }): void {
    const quiet = options?.quiet ?? false;
    const run = rebuildPreviews(quiet);
    resolving = run.finally(() => {
      if (resolving === run) resolving = null;
    });
  }

  return {
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      apply();
    },
    isEnabled: () => enabled,
    apply,
    dispose() {
      enabled = false;
      generation += 1;
      clearPreviews();
      prefabIdByAccepts.clear();
    },
  };
}
