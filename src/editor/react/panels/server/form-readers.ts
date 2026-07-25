import {
  WEAPON_FIRE_MODES,
  WEARABLE_SLOT_TYPES,
  type WeaponFireMode,
  type WearableSlotType,
} from '../../../../player/inventory/types';
import { WEAPON_SLOT_TYPES, type WeaponSlotType } from '../../../../types/equipment';
import type {
  BackpackDefinitionInput,
  ItemDefinitionInput,
  PropDefinitionInput,
  ShipDefinitionInput,
  WeaponDefinitionInput,
  WearableDefinitionInput,
} from '../../../../net/admin-api';

export function formValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function formNumber(form: HTMLFormElement, name: string): number {
  const raw = formValue(form, name);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readShipForm(form: HTMLFormElement): ShipDefinitionInput {
  return {
    name: formValue(form, 'name'),
    description: formValue(form, 'description'),
    prefabId: formValue(form, 'prefabId'),
    costArc: Math.round(formNumber(form, 'costArc')),
    maxHp: formNumber(form, 'maxHp'),
    maxShields: formNumber(form, 'maxShields'),
    shieldRegenPerSec: formNumber(form, 'shieldRegenPerSec'),
    maxSpeedMps: formNumber(form, 'maxSpeedMps'),
    throttleAccelMps2: formNumber(form, 'throttleAccelMps2'),
  };
}

export function readPropForm(form: HTMLFormElement): PropDefinitionInput {
  const maxPerHangarRaw = formValue(form, 'maxPerHangar');
  const snapGridRaw = formValue(form, 'snapGridM');
  return {
    name: formValue(form, 'name'),
    description: formValue(form, 'description'),
    prefabId: formValue(form, 'prefabId'),
    costArc: Math.round(formNumber(form, 'costArc')),
    category: formValue(form, 'category') || 'decoration',
    maxPerHangar: maxPerHangarRaw ? Math.round(Number(maxPerHangarRaw)) : null,
    allowRotateY: formValue(form, 'allowRotateY') !== 'false',
    snapGridM: snapGridRaw ? Number(snapGridRaw) : null,
  };
}

export function readItemForm(form: HTMLFormElement): ItemDefinitionInput {
  const prefabRaw = formValue(form, 'prefabId');
  const iconRaw = formValue(form, 'iconUrl');
  return {
    name: formValue(form, 'name'),
    description: formValue(form, 'description'),
    itemType: formValue(form, 'itemType') || 'misc',
    subType: formValue(form, 'subType') || 'generic',
    prefabId: prefabRaw ? prefabRaw : null,
    iconUrl: iconRaw ? iconRaw : null,
    stackMax: Math.round(formNumber(form, 'stackMax')),
    costArc: Math.round(formNumber(form, 'costArc')),
    rarity: formValue(form, 'rarity') || 'common',
  };
}

export function readWeaponForm(form: HTMLFormElement): WeaponDefinitionInput {
  const iconUrl = formValue(form, 'iconUrl');
  const weaponSlotTypeRaw = formValue(form, 'weaponSlotType') as WeaponSlotType;
  const fireModes = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name="fireModes"]:checked'),
  )
    .map((input) => input.value as WeaponFireMode)
    .filter((mode): mode is WeaponFireMode => WEAPON_FIRE_MODES.includes(mode));
  const ammoItemDefinitionId = formValue(form, 'ammoItemDefinitionId');
  return {
    name: formValue(form, 'name'),
    description: formValue(form, 'description'),
    subType: formValue(form, 'subType') || 'generic',
    prefabId: formValue(form, 'prefabId'),
    iconUrl: iconUrl || null,
    costArc: Math.round(formNumber(form, 'costArc')),
    rarity: formValue(form, 'rarity') || 'common',
    weaponSlotType: WEAPON_SLOT_TYPES.includes(weaponSlotTypeRaw) ? weaponSlotTypeRaw : 'rifle',
    ammoItemDefinitionId: ammoItemDefinitionId || null,
    magazineSize: Math.round(formNumber(form, 'magazineSize')),
    fireModes,
    roundsPerMinute: formNumber(form, 'roundsPerMinute'),
    muzzleVelocityMps: formNumber(form, 'muzzleVelocityMps'),
    bulletGravityMps2: formNumber(form, 'bulletGravityMps2'),
    maxRangeMeters: formNumber(form, 'maxRangeMeters'),
    damage: formNumber(form, 'damage'),
  };
}

export function readBackpackForm(form: HTMLFormElement): BackpackDefinitionInput {
  const iconUrl = formValue(form, 'iconUrl');
  return {
    name: formValue(form, 'name'),
    description: formValue(form, 'description'),
    subType: formValue(form, 'subType') || 'generic',
    prefabId: formValue(form, 'prefabId'),
    iconUrl: iconUrl || null,
    costArc: Math.round(formNumber(form, 'costArc')),
    rarity: formValue(form, 'rarity') || 'common',
    capacityLiters: formNumber(form, 'capacityLiters'),
    emptyMassKg: formNumber(form, 'emptyMassKg'),
  };
}

export function readWearableForm(form: HTMLFormElement): WearableDefinitionInput {
  const primaryRaw = formValue(form, 'wearableSlotType') as WearableSlotType;
  const primary = WEARABLE_SLOT_TYPES.includes(primaryRaw) ? primaryRaw : 'torso';
  const checked = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name="occupiedSlotTypes"]:checked'),
  )
    .map((input) => input.value as WearableSlotType)
    .filter((slot): slot is WearableSlotType => WEARABLE_SLOT_TYPES.includes(slot));
  const occupiedSlotTypes = [primary, ...checked.filter((slot) => slot !== primary)];
  const prefabId = formValue(form, 'prefabId');
  const iconUrl = formValue(form, 'iconUrl');
  const itemType = formValue(form, 'itemType');
  return {
    name: formValue(form, 'name'),
    description: formValue(form, 'description'),
    itemType: itemType === 'armor' ? 'armor' : 'clothing',
    subType: formValue(form, 'subType') || 'generic',
    prefabId: prefabId || null,
    iconUrl: iconUrl || null,
    costArc: Math.round(formNumber(form, 'costArc')),
    rarity: formValue(form, 'rarity') || 'common',
    wearableSlotType: primary,
    occupiedSlotTypes,
    sidekickPartPresetId: Math.round(formNumber(form, 'sidekickPartPresetId')),
  };
}
