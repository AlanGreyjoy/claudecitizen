import type { ItemDefinition, ItemType } from '../../../player/inventory/types';
import {
  getPartMeshUrl,
  getPresetParts,
  loadSidekickCatalog,
} from '../../../player/character_creator/sidekick_catalog';
import { wearablePartTypes } from '../../../player/inventory/wearable_visuals';
import { getModelThumbnail } from '../../editor/thumbnails';
import { loadPrefabDocument } from '../../../world/prefabs/loader';
import type { PrefabEntity } from '../../../world/prefabs/schema';

const prefabAssetCache = new Map<string, Promise<string | null>>();
const prefabThumbCache = new Map<string, Promise<string>>();
const wearableThumbCache = new Map<string, Promise<string>>();

const TYPE_LABELS: Record<ItemType, string> = {
  consumable: 'CON',
  weapon: 'WPN',
  backpack: 'BPK',
  armor: 'ARM',
  clothing: 'CLT',
  material: 'MAT',
  misc: 'MSC',
};

function findFirstAssetUrl(entity: PrefabEntity): string | null {
  if (entity.asset?.url) return entity.asset.url;
  for (const child of entity.children ?? []) {
    const found = findFirstAssetUrl(child);
    if (found) return found;
  }
  return null;
}

async function resolvePrefabAssetUrl(prefabId: string): Promise<string | null> {
  let pending = prefabAssetCache.get(prefabId);
  if (!pending) {
    pending = loadPrefabDocument(prefabId).then((doc) =>
      doc ? findFirstAssetUrl(doc.root) : null,
    );
    prefabAssetCache.set(prefabId, pending);
  }
  return pending;
}

function getPrefabThumbnail(prefabId: string): Promise<string> {
  let pending = prefabThumbCache.get(prefabId);
  if (!pending) {
    pending = resolvePrefabAssetUrl(prefabId).then((assetUrl) =>
      assetUrl ? getModelThumbnail(assetUrl) : '',
    );
    prefabThumbCache.set(prefabId, pending);
  }
  return pending;
}

function getWearableThumbnail(definition: ItemDefinition): Promise<string> {
  const presetId = definition.sidekickPartPresetId;
  const slotType = definition.wearableSlotType;
  if (typeof presetId !== 'number' || !slotType) return Promise.resolve('');
  const cacheKey = `${presetId}:${slotType}`;
  let pending = wearableThumbCache.get(cacheKey);
  if (!pending) {
    pending = loadSidekickCatalog().then(async (catalog) => {
      const allowedTypes = wearablePartTypes([slotType]);
      const representative = getPresetParts(catalog, presetId).find((part) =>
        allowedTypes.has(part.type),
      );
      const meshUrl = representative ? getPartMeshUrl(catalog, representative.name) : null;
      return meshUrl ? getModelThumbnail(meshUrl) : '';
    }).catch(() => '');
    wearableThumbCache.set(cacheKey, pending);
  }
  return pending;
}

function applyPlaceholder(slot: HTMLElement, itemType: ItemType): void {
  slot.replaceChildren();
  const placeholder = document.createElement('span');
  placeholder.className = `sc-haloband-inventory-placeholder sc-haloband-inventory-placeholder-${itemType}`;
  placeholder.textContent = TYPE_LABELS[itemType];
  slot.append(placeholder);
}

function applyImage(slot: HTMLElement, src: string, itemType: ItemType): void {
  slot.replaceChildren();
  const image = document.createElement('img');
  image.className = 'sc-haloband-inventory-icon';
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'lazy';
  image.addEventListener(
    'error',
    () => {
      applyPlaceholder(slot, itemType);
    },
    { once: true },
  );
  image.src = src;
  slot.append(image);
}

/** Resolves and paints an inventory icon into the slot element. */
export function paintItemIcon(slot: HTMLElement, definition: ItemDefinition): void {
  if (definition.iconUrl) {
    applyImage(slot, definition.iconUrl, definition.itemType);
    return;
  }

  if (definition.wearableSlotType && definition.sidekickPartPresetId) {
    applyPlaceholder(slot, definition.itemType);
    void getWearableThumbnail(definition).then((thumb) => {
      if (thumb) applyImage(slot, thumb, definition.itemType);
    });
    return;
  }

  if (definition.prefabId) {
    applyPlaceholder(slot, definition.itemType);
    void getPrefabThumbnail(definition.prefabId).then((thumb) => {
      if (thumb) applyImage(slot, thumb, definition.itemType);
    });
    return;
  }

  applyPlaceholder(slot, definition.itemType);
}
