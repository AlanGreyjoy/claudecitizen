import {
  AdminAuthError,
  assignShipToUser,
  createBackpackDefinition,
  createItemDefinition,
  createPropDefinition,
  createShipDefinition,
  createWeaponDefinition,
  createWearableDefinition,
  deleteBackpackDefinition,
  deleteItemDefinition,
  deleteWeaponDefinition,
  deleteWearableDefinition,
  getAdminSession,
  getAdminUser,
  getGameSettings,
  listAdminUsers,
  listBackpackDefinitions,
  listItemDefinitions,
  listPropDefinitions,
  listShipDefinitions,
  listWeaponDefinitions,
  listWearableDefinitions,
  updateBackpackDefinition,
  updateGameSettings,
  updateItemDefinition,
  updatePropDefinition,
  updateShipDefinition,
  updateWeaponDefinition,
  updateWearableDefinition,
  type ItemDefinition,
} from '../../../../net/admin-api';
import { listItemPrefabOptions, type ItemPrefabOption } from '../../../../world/prefabs/list-item-prefabs';
import { listPropPrefabOptions, type PropPrefabOption } from '../../../../world/prefabs/list-prop-prefabs';
import { listShipPrefabOptions, type ShipPrefabOption } from '../../../../world/prefabs/list-ship-prefabs';
import { loadPrefabDocument } from '../../../../world/prefabs/loader';
import { validateBackpackPrefab } from '../../../../world/prefabs/item-runtime';

export {
  AdminAuthError,
  assignShipToUser,
  createBackpackDefinition,
  createItemDefinition,
  createPropDefinition,
  createShipDefinition,
  createWeaponDefinition,
  createWearableDefinition,
  deleteBackpackDefinition,
  deleteItemDefinition,
  deleteWeaponDefinition,
  deleteWearableDefinition,
  getAdminSession,
  getAdminUser,
  getGameSettings,
  listAdminUsers,
  listBackpackDefinitions,
  listItemDefinitions,
  listPropDefinitions,
  listShipDefinitions,
  listWeaponDefinitions,
  listWearableDefinitions,
  updateBackpackDefinition,
  updateGameSettings,
  updateItemDefinition,
  updatePropDefinition,
  updateShipDefinition,
  updateWeaponDefinition,
  updateWearableDefinition,
};

export type { ItemDefinition, ItemPrefabOption, PropPrefabOption, ShipPrefabOption };

let shipPrefabsCache: ShipPrefabOption[] = [];
let propPrefabsCache: PropPrefabOption[] = [];
let itemPrefabsCache: ItemPrefabOption[] = [];

export function resetPrefabCaches(): void {
  shipPrefabsCache = [];
  propPrefabsCache = [];
  itemPrefabsCache = [];
}

export async function ensureShipPrefabs(): Promise<ShipPrefabOption[]> {
  if (shipPrefabsCache.length > 0) return shipPrefabsCache;
  shipPrefabsCache = await listShipPrefabOptions();
  return shipPrefabsCache;
}

export async function ensurePropPrefabs(): Promise<PropPrefabOption[]> {
  if (propPrefabsCache.length > 0) return propPrefabsCache;
  propPrefabsCache = await listPropPrefabOptions();
  return propPrefabsCache;
}

export async function ensureItemPrefabs(): Promise<ItemPrefabOption[]> {
  if (!import.meta.env.DEV && itemPrefabsCache.length > 0) return itemPrefabsCache;
  itemPrefabsCache = await listItemPrefabOptions();
  return itemPrefabsCache;
}

export async function routeItemDefinitionType(
  item: ItemDefinition,
): Promise<'weapon' | 'backpack' | 'wearable' | 'item'> {
  if (item.itemType === 'weapon') {
    const weapon = (await listWeaponDefinitions()).find((entry) => entry.id === item.id);
    if (weapon) return 'weapon';
  }
  if (item.itemType === 'backpack') {
    const backpack = (await listBackpackDefinitions()).find((entry) => entry.id === item.id);
    if (backpack) return 'backpack';
  }
  if (item.itemType === 'armor' || item.itemType === 'clothing') {
    const wearable = (await listWearableDefinitions()).find((entry) => entry.id === item.id);
    if (wearable) return 'wearable';
  }
  return 'item';
}

export async function validateBackpackPrefabId(prefabId: string): Promise<string[]> {
  const prefab = await loadPrefabDocument(prefabId);
  return prefab ? validateBackpackPrefab(prefab) : [`Item prefab "${prefabId}" could not be loaded.`];
}
