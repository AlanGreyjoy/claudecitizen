import type { InventoryState, ItemDefinition } from '../../player/inventory/types';
import type { AvmsShipRecord } from '../../render/effects/hud/avms_terminal';
import type {
  StationOutfittersMarker,
  StationWeaponShopMarker,
} from '../../world/station';

export const MOCK_ARC_BALANCE = 22_360;

export const MOCK_CATALOG: ItemDefinition[] = [
  {
    id: 'mock-medpen',
    name: 'MedPen',
    description: 'Single-use stimulant pack for field trauma.',
    itemType: 'consumable',
    subType: 'stim',
    prefabId: null,
    iconUrl: null,
    stackMax: 10,
    costArc: 85,
    rarity: 'common',
  },
  {
    id: 'mock-carbine',
    name: 'C54 Carbine',
    description: 'Compact ballistic rifle for shipboard security.',
    itemType: 'weapon',
    subType: 'rifle',
    prefabId: null,
    iconUrl: null,
    stackMax: 1,
    costArc: 4200,
    rarity: 'uncommon',
    weaponSlotType: 'rifle',
  },
  {
    id: 'mock-pistol',
    name: 'S38 Pistol',
    description: 'Sidearm for close-quarters boarding.',
    itemType: 'weapon',
    subType: 'handgun',
    prefabId: null,
    iconUrl: null,
    stackMax: 1,
    costArc: 1800,
    rarity: 'common',
    weaponSlotType: 'handgun',
  },
  {
    id: 'mock-jacket',
    name: 'Orbit Jacket',
    description: 'Light insulated jacket with HaloBand pocket.',
    itemType: 'clothing',
    subType: 'torso',
    prefabId: null,
    iconUrl: null,
    stackMax: 1,
    costArc: 320,
    rarity: 'common',
  },
  {
    id: 'mock-vest',
    name: 'Light Vest',
    description: 'Soft armor liner rated for low-caliber threats.',
    itemType: 'armor',
    subType: 'chest',
    prefabId: null,
    iconUrl: null,
    stackMax: 1,
    costArc: 1100,
    rarity: 'uncommon',
  },
  {
    id: 'mock-backpack',
    name: 'Day Pack',
    description: 'Compact carry pack for station runs.',
    itemType: 'backpack',
    subType: 'pack',
    prefabId: null,
    iconUrl: null,
    stackMax: 1,
    costArc: 650,
    rarity: 'common',
    capacityLiters: 24,
    emptyMassKg: 1.2,
  },
  {
    id: 'mock-scrap',
    name: 'Salvage Scrap',
    description: 'Mixed hull plating fragments for trade.',
    itemType: 'material',
    subType: 'metal',
    prefabId: null,
    iconUrl: null,
    stackMax: 99,
    costArc: 12,
    rarity: 'common',
  },
];

export function createMockInventory(): InventoryState {
  return {
    catalog: MOCK_CATALOG.map((entry) => ({ ...entry })),
    items: [
      { itemDefinitionId: 'mock-medpen', quantity: 4 },
      { itemDefinitionId: 'mock-carbine', quantity: 1 },
      { itemDefinitionId: 'mock-jacket', quantity: 1 },
      { itemDefinitionId: 'mock-vest', quantity: 1 },
      { itemDefinitionId: 'mock-scrap', quantity: 37 },
    ],
    loadout: {},
  };
}

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

export const MOCK_WEAPON_SHOP: StationWeaponShopMarker = {
  id: 'mock-weapon-shop',
  label: 'Mock Weapon Shop',
  right: 0,
  up: 0,
  forward: 0,
  rotation: IDENTITY_ROT,
  gazeRadius: 0.4,
  maxDistance: 3,
  screenWidth: 1.2,
  screenHeight: 0.8,
  itemDefinitionIds: [],
};

export const MOCK_OUTFITTERS: StationOutfittersMarker = {
  id: 'mock-outfitters',
  label: 'Mock Outfitters',
  right: 0,
  up: 0,
  forward: 0,
  rotation: IDENTITY_ROT,
  gazeRadius: 0.4,
  maxDistance: 3,
  screenWidth: 1.2,
  screenHeight: 0.8,
  itemDefinitionIds: [],
};

export const MOCK_AVMS_SHIPS: AvmsShipRecord[] = [
  {
    id: 'mock-ship-1',
    shipDefinitionId: 'mock-def-1',
    prefabId: 'phobos-starhopper',
    displayName: 'Phobos Starhopper',
    hp: 820,
    shields: 640,
    maxHp: 1000,
    maxShields: 800,
    shieldRegenPerSec: 20,
    maxSpeedMps: 220,
    throttleAccelMps2: 18,
  },
  {
    id: 'mock-ship-2',
    shipDefinitionId: 'mock-def-2',
    prefabId: 'demo-ship',
    displayName: 'Demo Freighter',
    hp: 1200,
    shields: 400,
    maxHp: 1500,
    maxShields: 600,
    shieldRegenPerSec: 12,
    maxSpeedMps: 140,
    throttleAccelMps2: 10,
  },
];
