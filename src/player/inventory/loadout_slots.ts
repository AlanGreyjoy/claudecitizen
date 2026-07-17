/**
 * Playable personal-inventory equipment slots — same ids/rules as
 * base-characters.json / server game.loadout.ts.
 */

import type { CharacterEquipmentSlotV1 } from '../equipment/base_character_equipment';

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

export const WEAPON_BAR_SLOT_IDS = [
  'rifle-primary',
  'rifle-secondary',
  'handgun',
  'sword',
] as const;
