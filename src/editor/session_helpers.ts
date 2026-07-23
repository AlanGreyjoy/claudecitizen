import { createEmptyEntity, type EditorStore } from './document';
import { showConfirmDialog, showToast } from './dom';
import { getComponentDef } from '../world/prefabs/component_registry';
import { slugifyPrefabName } from '../world/prefabs/schema';
import type { Vec3 } from '../types';

export const AUDIO_EXTENSIONS = /\.(ogg|mp3|wav|m4a)(?:[?#].*)?$/i;

export function entityNameFromUrl(url: string): string {
  const fileName = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
  return fileName.replace(/\.(glb|gltf|ogg|mp3|wav|m4a)(?:[?#].*)?$/i, '') || 'Asset';
}

export function itemNameFromUrl(url: string): string {
  return (
    entityNameFromUrl(url)
      .replace(/^sm_(?:wep_|chr_attach_)?/i, '')
      .replace(/^(?:sk|chr|prop|wep|weapon)[_-]+/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .trim() || 'Item'
  );
}

/** Tags the hull entity with ship-controller when no other hull claims it yet. */
export function markAsHullIfFirst(store: EditorStore, entityId: string): void {
  let hullExists = false;
  const visit = (list: ReturnType<typeof store.getState>['roots']): void => {
    for (const entity of list) {
      if (
        entity.components.some(
          (component) =>
            component.type === 'ship-controller' || component.type === 'ship-hull',
        )
      ) {
        hullExists = true;
        return;
      }
      visit(entity.children);
    }
  };
  visit(store.getState().roots);
  if (hullExists) return;
  const entity = store.locate(entityId)?.entity;
  if (!entity) return;
  // The game recenters the hull model on the ship origin, so the hull
  // entity must sit at 0,0,0 for the editor to match the game.
  store.setTransform(entityId, {
    position: { x: 0, y: 0, z: 0 },
    rotation: { ...entity.rotation },
    scale: { ...entity.scale },
  });
  store.setComponents(entityId, [
    ...entity.components.filter((component) => component.type !== 'ship-hull'),
    {
      type: 'ship-controller',
      restHeight: 3.16,
      stats: {
        maxSpeedMps: 100,
        maxHp: 1000,
        maxShields: 500,
        shieldRegenPerSec: 25,
      },
      gear: {
        nodes: [
          { name: 'LandingGear_BackLeft', deployRadians: -0.55 },
          { name: 'LandingGear_BackRight', deployRadians: -0.55 },
          { name: 'LandingLeg_Front', deployRadians: 1.4 },
        ],
      },
      ramp: {
        hinge: { node: 'RampParent', lowerRadians: -0.85 },
      },
      doors: [],
      seats: [],
      cameraBounds: [],
    },
  ]);
}

/** Dropping a GLB from a ships folder offers to switch into Ship Editor mode. */
export async function maybeOfferShipPrefab(
  store: EditorStore,
  entityId: string,
  url: string,
): Promise<void> {
  if (!/\/ships\//i.test(url)) return;
  const state = store.getState();
  if (state.kind === 'ship') {
    markAsHullIfFirst(store, entityId);
    return;
  }
  const modelName = entityNameFromUrl(url);
  const create = await showConfirmDialog({
    title: 'Ship model detected',
    message: `Create "${modelName}" as a ship prefab? This switches the prefab kind to ship and marks this model as the hull.`,
    confirmLabel: 'Create ship prefab',
    cancelLabel: 'Keep as scenery',
  });
  if (!create) return;
  const meta: Parameters<typeof store.setPrefabMeta>[0] = { kind: 'ship' };
  if (!state.prefabId && state.prefabName === 'Untitled Prefab') {
    meta.prefabName = modelName;
    meta.prefabId = slugifyPrefabName(modelName);
  }
  store.setPrefabMeta(meta);
  markAsHullIfFirst(store, entityId);
  showToast(
    'Ship Editor mode — add a ship-controller on the hull, deck colliders, then Preview Ship.',
  );
}

export function addAssetEntity(store: EditorStore, url: string, position: Vec3): void {
  const entity = createEmptyEntity(entityNameFromUrl(url));
  if (AUDIO_EXTENSIONS.test(url)) {
    const kind = store.getState().kind;
    if (kind !== 'station' && kind !== 'ship') {
      showToast('Sound objects are available in station and ship prefabs.', true);
      return;
    }
    const component = getComponentDef('sound')?.createDefault();
    if (!component || component.type !== 'sound') return;
    entity.components = [{ ...component, soundUrl: url }];
    entity.position = position;
    store.addEntity(entity);
    return;
  }
  entity.asset = { url };
  entity.position = position;
  store.addEntity(entity);
  void maybeOfferShipPrefab(store, entity.id, url);
}

export function addBox(store: EditorStore): void {
  const entity = createEmptyEntity('Box');
  entity.primitive = { shape: 'box', size: { x: 2, y: 2, z: 2 }, color: '#4c5663' };
  entity.position = { x: 0, y: 1, z: 0 };
  store.addEntity(entity);
}

export function addEmpty(store: EditorStore): void {
  const entity = createEmptyEntity('Empty');
  store.addEntity(entity);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}
