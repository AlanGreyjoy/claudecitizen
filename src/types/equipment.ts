export const WEAPON_SLOT_TYPES = ['sword', 'handgun', 'rifle'] as const;

export type WeaponSlotType = (typeof WEAPON_SLOT_TYPES)[number];

export function isWeaponSlotType(value: unknown): value is WeaponSlotType {
  return typeof value === 'string' && (WEAPON_SLOT_TYPES as readonly string[]).includes(value);
}
