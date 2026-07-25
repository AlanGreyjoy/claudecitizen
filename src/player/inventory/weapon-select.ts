import type { LoadoutState } from './types';

/** Hotbar Digits 1–3 → loadout slot ids. */
export const WEAPON_SELECT_SLOT_IDS = [
  'rifle-primary',
  'rifle-secondary',
  'handgun',
] as const;

export type WeaponSelectSlotId = (typeof WEAPON_SELECT_SLOT_IDS)[number];
export type WeaponSelectPress = 1 | 2 | 3;
export type WeaponAnimStanceId = 'unarmed' | 'rifle' | 'pistol';

export function weaponSelectSlotForPress(press: WeaponSelectPress): WeaponSelectSlotId {
  return WEAPON_SELECT_SLOT_IDS[press - 1]!;
}

export function stanceIdForWeaponSlot(
  slotId: string | null | undefined,
): WeaponAnimStanceId {
  if (slotId === 'rifle-primary' || slotId === 'rifle-secondary') return 'rifle';
  if (slotId === 'handgun') return 'pistol';
  return 'unarmed';
}

/**
 * Resolve a weapon hotbar press against the current loadout.
 * Empty slots are ignored; pressing the active slot again holsters (null).
 */
export function resolveWeaponSlotPress(
  press: WeaponSelectPress,
  currentSlotId: string | null,
  loadout: LoadoutState,
): string | null {
  const slotId = weaponSelectSlotForPress(press);
  if (!loadout[slotId]) return currentSlotId;
  if (currentSlotId === slotId) return null;
  return slotId;
}
