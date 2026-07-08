import type { ItemDefinition, ItemType } from '../../../player/inventory/types';
import { getModelThumbnail } from '../../editor/thumbnails';
import { loadPrefabDocument } from '../../../world/prefabs/loader';
import type { PrefabEntity } from '../../../world/prefabs/schema';

const prefabAssetCache = new Map<string, Promise<string | null>>();
const prefabThumbCache = new Map<string, Promise<string>>();

const TYPE_LABELS: Record<ItemType, string> = {
  consumable: 'CON',
  weapon: 'WPN',
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

  if (definition.prefabId) {
    applyPlaceholder(slot, definition.itemType);
    void getPrefabThumbnail(definition.prefabId).then((thumb) => {
      if (thumb) applyImage(slot, thumb, definition.itemType);
    });
    return;
  }

  applyPlaceholder(slot, definition.itemType);
}
