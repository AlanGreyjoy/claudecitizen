import type {
  BackpackDefinitionInput,
  ItemDefinitionInput,
  PropDefinitionInput,
  ShipDefinitionInput,
  WeaponDefinitionInput,
  WearableDefinitionInput,
} from '../../../../net/admin-api';

export const DEFAULT_ITEM_FORM: ItemDefinitionInput = {
  name: '',
  description: '',
  itemType: 'consumable',
  subType: 'generic',
  prefabId: null,
  iconUrl: null,
  stackMax: 99,
  costArc: 0,
  rarity: 'common',
};

export const DEFAULT_WEAPON_FORM: WeaponDefinitionInput = {
  name: '',
  description: '',
  subType: 'generic',
  prefabId: '',
  iconUrl: null,
  costArc: 0,
  rarity: 'common',
  weaponSlotType: 'rifle',
  ammoItemDefinitionId: null,
  magazineSize: 30,
  fireModes: ['single'],
  roundsPerMinute: 600,
  muzzleVelocityMps: 850,
  bulletGravityMps2: 9.81,
  maxRangeMeters: 1000,
  damage: 20,
};

export const DEFAULT_BACKPACK_FORM: BackpackDefinitionInput = {
  name: '',
  description: '',
  subType: 'generic',
  prefabId: '',
  iconUrl: null,
  costArc: 0,
  rarity: 'common',
  capacityLiters: 0,
  emptyMassKg: 0,
};

export const DEFAULT_WEARABLE_FORM: WearableDefinitionInput = {
  name: '',
  description: '',
  itemType: 'clothing',
  subType: 'generic',
  prefabId: null,
  iconUrl: null,
  costArc: 0,
  rarity: 'common',
  wearableSlotType: 'torso',
  occupiedSlotTypes: ['torso'],
  sidekickPartPresetId: 1,
};

export const DEFAULT_PROP_FORM: PropDefinitionInput = {
  name: '',
  description: '',
  prefabId: 'hangar-crate-01',
  costArc: 250,
  category: 'decoration',
  maxPerHangar: 8,
  allowRotateY: true,
  snapGridM: 0.5,
};

export const DEFAULT_SHIP_FORM: ShipDefinitionInput = {
  name: '',
  description: '',
  prefabId: 'phobos-starhopper',
  costArc: 0,
  maxHp: 1000,
  maxShields: 500,
  shieldRegenPerSec: 25,
  maxSpeedMps: 100,
  throttleAccelMps2: 308,
};
