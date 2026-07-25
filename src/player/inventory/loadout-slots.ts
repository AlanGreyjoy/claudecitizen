/**
 * Playable personal-inventory equipment slots — same ids/rules as
 * base-characters.json / server game.loadout.ts.
 */

import type { CharacterEquipmentSlotV1 } from '../equipment/base_character_equipment';
import type { WearableSlotType } from './types';

export interface WearableLoadoutSlot {
  id: WearableSlotType;
  label: string;
  kind: 'wearable';
  wearableSlotType: WearableSlotType;
}

export type PlayLoadoutSlot = CharacterEquipmentSlotV1 | WearableLoadoutSlot;

export const PLAY_LOADOUT_SLOTS: readonly CharacterEquipmentSlotV1[] = [
  { id: 'backpack', label: 'Backpack', kind: 'backpack' },
  {
    id: 'rifle-primary',
    label: 'Primary Rifle',
    kind: 'weapon',
    weaponSlotType: 'rifle',
    providerSocket: { slotId: 'backpack', socketId: 'rifle-primary' },
  },
  {
    id: 'rifle-secondary',
    label: 'Secondary Rifle',
    kind: 'weapon',
    weaponSlotType: 'rifle',
    requiresSlotId: 'backpack',
    providerSocket: { slotId: 'backpack', socketId: 'rifle-secondary' },
  },
  {
    id: 'sword',
    label: 'Sword',
    kind: 'weapon',
    weaponSlotType: 'sword',
  },
  {
    id: 'handgun',
    label: 'Handgun',
    kind: 'weapon',
    weaponSlotType: 'handgun',
  },
] as const;

export const WEARABLE_LOADOUT_SLOTS: readonly WearableLoadoutSlot[] = [
  { id: 'head', label: 'Head', kind: 'wearable', wearableSlotType: 'head' },
  { id: 'torso', label: 'Torso', kind: 'wearable', wearableSlotType: 'torso' },
  { id: 'arms', label: 'Arms', kind: 'wearable', wearableSlotType: 'arms' },
  { id: 'legs', label: 'Legs', kind: 'wearable', wearableSlotType: 'legs' },
  { id: 'feet', label: 'Feet', kind: 'wearable', wearableSlotType: 'feet' },
] as const;

export const ALL_PLAY_LOADOUT_SLOTS: readonly PlayLoadoutSlot[] = [
  ...WEARABLE_LOADOUT_SLOTS,
  ...PLAY_LOADOUT_SLOTS,
];

export const WEAPON_BAR_SLOT_IDS = [
  'rifle-primary',
  'rifle-secondary',
  'handgun',
  'sword',
] as const;
