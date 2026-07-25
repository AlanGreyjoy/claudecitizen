import type { Quat } from '../../math/quat';
import type { Vec3 } from '../../types';
import { isWeaponSlotType, type WeaponSlotType } from '../../types/equipment';

export const BASE_CHARACTER_EQUIPMENT_SCHEMA_VERSION = 1 as const;
export type BaseCharacterType = 1 | 2;
export type CharacterEquipmentSlotKind = 'weapon' | 'backpack';

export interface CharacterBoneMountV1 {
  bone: string;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export interface CharacterEquipmentSlotV1 {
  id: string;
  label: string;
  kind: CharacterEquipmentSlotKind;
  weaponSlotType?: WeaponSlotType;
  requiresSlotId?: string;
  providerSocket?: {
    slotId: string;
    socketId: string;
  };
}

export interface BaseCharacterVariantV1 {
  type: BaseCharacterType;
  label: string;
  /** Holster / resting mounts (backpack sockets may override for rifles). */
  mounts: Record<string, CharacterBoneMountV1>;
  /** Optional hand mounts when the weapon slot is drawn (hotbar). Weapon slots only. */
  drawnMounts?: Record<string, CharacterBoneMountV1>;
}

/** Default drawn-weapon bone (Synty prop socket under hand_r). */
export const DEFAULT_DRAWN_WEAPON_BONE = 'prop_r';

export interface BaseCharacterEquipmentV1 {
  schemaVersion: typeof BASE_CHARACTER_EQUIPMENT_SCHEMA_VERSION;
  slots: CharacterEquipmentSlotV1[];
  variants: Record<'1' | '2', BaseCharacterVariantV1>;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim().slice(0, max);
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

function vec3(value: unknown, label: string): Vec3 {
  const source = record(value, label);
  return {
    x: finite(source.x, `${label}.x`),
    y: finite(source.y, `${label}.y`),
    z: finite(source.z, `${label}.z`),
  };
}

function quat(value: unknown, label: string): Quat {
  const source = record(value, label);
  const x = finite(source.x, `${label}.x`);
  const y = finite(source.y, `${label}.y`);
  const z = finite(source.z, `${label}.z`);
  const w = finite(source.w, `${label}.w`);
  const length = Math.hypot(x, y, z, w);
  // Older Base Character authoring exposed raw quaternion fields, which made
  // it easy to save 0/0/0/0 accidentally. Treat that legacy value as the
  // identity rotation so the document remains recoverable in the Euler UI.
  if (length < 1e-8) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

function mount(value: unknown, label: string): CharacterBoneMountV1 {
  const source = record(value, label);
  return {
    bone: stringValue(source.bone, `${label}.bone`),
    position: vec3(source.position, `${label}.position`),
    rotation: quat(source.rotation, `${label}.rotation`),
    scale: vec3(source.scale, `${label}.scale`),
  };
}

function slot(value: unknown, label: string): CharacterEquipmentSlotV1 {
  const source = record(value, label);
  const id = stringValue(source.id, `${label}.id`, 64);
  if (!ID_PATTERN.test(id)) throw new Error(`${label}.id must be a lowercase slug.`);
  const kind = source.kind;
  if (kind !== 'weapon' && kind !== 'backpack') {
    throw new Error(`${label}.kind must be weapon or backpack.`);
  }
  const weaponSlotType = source.weaponSlotType;
  if (kind === 'weapon' && !isWeaponSlotType(weaponSlotType)) {
    throw new Error(`${label}.weaponSlotType is invalid.`);
  }
  const normalizedWeaponSlotType = kind === 'weapon' ? (weaponSlotType as WeaponSlotType) : undefined;
  const providerRaw = source.providerSocket;
  const provider = providerRaw === undefined ? undefined : record(providerRaw, `${label}.providerSocket`);
  return {
    id,
    label: stringValue(source.label, `${label}.label`, 80),
    kind,
    ...(normalizedWeaponSlotType ? { weaponSlotType: normalizedWeaponSlotType } : {}),
    ...(source.requiresSlotId === undefined
      ? {}
      : { requiresSlotId: stringValue(source.requiresSlotId, `${label}.requiresSlotId`, 64) }),
    ...(provider
      ? {
          providerSocket: {
            slotId: stringValue(provider.slotId, `${label}.providerSocket.slotId`, 64),
            socketId: stringValue(provider.socketId, `${label}.providerSocket.socketId`, 64),
          },
        }
      : {}),
  };
}

function variant(
  value: unknown,
  expectedType: BaseCharacterType,
  weaponSlotIds: ReadonlySet<string>,
  slotIds: ReadonlySet<string>,
): BaseCharacterVariantV1 {
  const source = record(value, `variants.${expectedType}`);
  if (source.type !== expectedType) throw new Error(`variants.${expectedType}.type is invalid.`);
  const mountsSource = record(source.mounts, `variants.${expectedType}.mounts`);
  const mounts: Record<string, CharacterBoneMountV1> = {};
  for (const slotId of slotIds) {
    mounts[slotId] = mount(mountsSource[slotId], `variants.${expectedType}.mounts.${slotId}`);
  }
  let drawnMounts: Record<string, CharacterBoneMountV1> | undefined;
  if (source.drawnMounts !== undefined) {
    const drawnSource = record(source.drawnMounts, `variants.${expectedType}.drawnMounts`);
    drawnMounts = {};
    for (const [slotId, entry] of Object.entries(drawnSource)) {
      if (!weaponSlotIds.has(slotId)) {
        throw new Error(
          `variants.${expectedType}.drawnMounts.${slotId} must reference a weapon slot.`,
        );
      }
      drawnMounts[slotId] = mount(entry, `variants.${expectedType}.drawnMounts.${slotId}`);
    }
  }
  return {
    type: expectedType,
    label: stringValue(source.label, `variants.${expectedType}.label`, 80),
    mounts,
    ...(drawnMounts && Object.keys(drawnMounts).length > 0 ? { drawnMounts } : {}),
  };
}

export function parseBaseCharacterEquipment(value: unknown): BaseCharacterEquipmentV1 {
  const source = record(value, 'Base character equipment');
  if (source.schemaVersion !== BASE_CHARACTER_EQUIPMENT_SCHEMA_VERSION) {
    throw new Error(`Expected base character equipment schema version ${BASE_CHARACTER_EQUIPMENT_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(source.slots) || source.slots.length === 0) {
    throw new Error('Base character equipment requires slots.');
  }
  const slots = source.slots.map((entry, index) => slot(entry, `slots[${index}]`));
  const slotIds = new Set(slots.map((entry) => entry.id));
  if (slotIds.size !== slots.length) throw new Error('Base character slot ids must be unique.');
  const weaponSlotIds = new Set(slots.filter((entry) => entry.kind === 'weapon').map((entry) => entry.id));
  for (const entry of slots) {
    if (entry.requiresSlotId && !slotIds.has(entry.requiresSlotId)) {
      throw new Error(`Slot "${entry.id}" requires missing slot "${entry.requiresSlotId}".`);
    }
    if (entry.providerSocket && !slotIds.has(entry.providerSocket.slotId)) {
      throw new Error(`Slot "${entry.id}" references missing provider "${entry.providerSocket.slotId}".`);
    }
  }
  const variants = record(source.variants, 'variants');
  return {
    schemaVersion: BASE_CHARACTER_EQUIPMENT_SCHEMA_VERSION,
    slots,
    variants: {
      '1': variant(variants['1'], 1, weaponSlotIds, slotIds),
      '2': variant(variants['2'], 2, weaponSlotIds, slotIds),
    },
  };
}

export function cloneBaseCharacterEquipment(
  value: BaseCharacterEquipmentV1,
): BaseCharacterEquipmentV1 {
  return structuredClone(value);
}

export function identityCharacterMount(bone: string): CharacterBoneMountV1 {
  return {
    bone,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}
