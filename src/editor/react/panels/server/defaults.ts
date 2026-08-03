import type {
  BackpackDefinitionInput,
  CreditPackInput,
  ItemDefinitionInput,
  MallListingInput,
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
  iconUrl: null,
  costArc: 0,
  maxHp: 1000,
  maxShields: 500,
  shieldRegenPerSec: 25,
  maxSpeedMps: 100,
  throttleAccelMps2: 308,
};

/**
 * Item types the Item Mall is allowed to sell. Mirrors `SELLABLE_ITEM_TYPES` in
 * `backend/crates/server/src/mall.rs` — keep the two in step, or the console will offer
 * listings the purchase endpoint rejects.
 */
export const MALL_SELLABLE_ITEM_TYPES: readonly string[] = ['consumable'];

export const DEFAULT_CREDIT_PACK_FORM: Required<
  Pick<
    CreditPackInput,
    | 'name'
    | 'description'
    | 'credits'
    | 'bonusCredits'
    | 'priceCents'
    | 'currency'
    | 'sortOrder'
    | 'active'
  >
> & { stripePriceId: string | null; iconUrl: string | null } = {
  name: '',
  description: '',
  credits: 500,
  bonusCredits: 0,
  priceCents: 499,
  currency: 'usd',
  stripePriceId: null,
  iconUrl: null,
  sortOrder: 0,
  active: true,
};

export const DEFAULT_MALL_LISTING_FORM: Required<
  Pick<MallListingInput, 'itemDefinitionId' | 'priceCredits' | 'category' | 'sortOrder' | 'featured' | 'active'>
> & { limitPerPlayer: number | null } = {
  itemDefinitionId: '',
  priceCredits: 50,
  category: 'consumable',
  sortOrder: 0,
  featured: false,
  active: true,
  limitPerPlayer: null,
};
