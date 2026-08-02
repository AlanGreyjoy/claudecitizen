import type { WeaponSlotType } from '../../types/equipment';
import type { PrefabDocument, PrefabEntity, PrefabTransform } from './schema';

export interface EquipmentSocketLayout {
  id: string;
  accepts: WeaponSlotType;
  entityId: string;
}

export interface DrawnGripLayout {
  entityId: string;
  transform: PrefabTransform;
}

export interface WeaponMarkerLayout {
  entityId: string;
  transform: PrefabTransform;
}

export interface WeaponCombatLayout {
  entityId: string;
  fireSoundUrl: string | null;
  dryFireSoundUrl: string | null;
  reloadSoundUrl: string | null;
  hitDecalUrl: string | null;
}

const IDENTITY_TRANSFORM: PrefabTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

/** Canonical backpack rifle sockets required by validateBackpackPrefab. */
export const BACKPACK_RIFLE_SOCKET_IDS = ['rifle-primary', 'rifle-secondary'] as const;

export function collectEquipmentSockets(doc: PrefabDocument): EquipmentSocketLayout[] {
  const sockets: EquipmentSocketLayout[] = [];
  const visit = (entity: PrefabEntity): void => {
    for (const component of entity.components ?? []) {
      if (component.type === 'equipment-socket') {
        sockets.push({ id: component.id, accepts: component.accepts, entityId: entity.id });
      }
    }
    for (const child of entity.children ?? []) visit(child);
  };
  visit(doc.root);
  return sockets;
}

/** Next free socket id for Accepts type (rifle prefers rifle-primary / rifle-secondary). */
export function nextEquipmentSocketId(
  existing: readonly { id: string; accepts: WeaponSlotType }[],
  accepts: WeaponSlotType,
  reservedId?: string,
): string {
  const taken = new Set(
    existing.filter((socket) => socket.id !== reservedId).map((socket) => socket.id),
  );
  if (accepts === 'rifle') {
    for (const id of BACKPACK_RIFLE_SOCKET_IDS) {
      if (!taken.has(id)) return id;
    }
  }
  if (!taken.has(accepts)) return accepts;
  let n = 2;
  while (taken.has(`${accepts}-${n}`)) n += 1;
  return `${accepts}-${n}`;
}

/**
 * Pick a backpack socket for a loadout weapon slot.
 * Prefers exact slot id match, then Accepts-compatible sockets.
 */
export function suggestProviderSocketId(
  weaponSlotType: WeaponSlotType,
  preferredId: string,
  sockets: readonly { id: string; accepts: WeaponSlotType }[],
): string | undefined {
  const matching = sockets.filter((socket) => socket.accepts === weaponSlotType);
  if (matching.length === 0) return undefined;
  return (
    matching.find((socket) => socket.id === preferredId)?.id
    ?? matching.find((socket) => socket.id.startsWith(weaponSlotType))?.id
    ?? matching[0]?.id
  );
}

/** First drawn-grip marker in the item prefab, if any. */
export function collectDrawnGrip(doc: PrefabDocument): DrawnGripLayout | null {
  let match: DrawnGripLayout | null = null;
  const visit = (entity: PrefabEntity): void => {
    if (match) return;
    for (const component of entity.components ?? []) {
      if (component.type === 'drawn-grip') {
        match = { entityId: entity.id, transform: structuredClone(entity.transform) };
        return;
      }
    }
    for (const child of entity.children ?? []) visit(child);
  };
  visit(doc.root);
  return match;
}

function collectWeaponMarker(
  doc: PrefabDocument,
  type: 'muzzle-flash' | 'barrel-end',
): WeaponMarkerLayout | null {
  let match: WeaponMarkerLayout | null = null;
  const visit = (entity: PrefabEntity): void => {
    if (match) return;
    if ((entity.components ?? []).some((component) => component.type === type)) {
      match = { entityId: entity.id, transform: structuredClone(entity.transform) };
      return;
    }
    for (const child of entity.children ?? []) visit(child);
  };
  visit(doc.root);
  return match;
}

/** Local marker whose +Z axis points down the weapon bore. */
export function collectMuzzleFlash(doc: PrefabDocument): WeaponMarkerLayout | null {
  return collectWeaponMarker(doc, 'muzzle-flash');
}

/** Local shot origin whose +Z axis points down the weapon bore. */
export function collectBarrelEnd(doc: PrefabDocument): WeaponMarkerLayout | null {
  return collectWeaponMarker(doc, 'barrel-end');
}

export function collectWeaponCombat(doc: PrefabDocument): WeaponCombatLayout | null {
  let match: WeaponCombatLayout | null = null;
  const visit = (entity: PrefabEntity): void => {
    if (match) return;
    for (const component of entity.components ?? []) {
      if (component.type !== 'weapon-combat') continue;
      match = {
        entityId: entity.id,
        fireSoundUrl: component.fireSoundUrl,
        dryFireSoundUrl: component.dryFireSoundUrl,
        reloadSoundUrl: component.reloadSoundUrl,
        hitDecalUrl: component.hitDecalUrl,
      };
      return;
    }
    for (const child of entity.children ?? []) visit(child);
  };
  visit(doc.root);
  return match;
}

export function identityDrawnGripTransform(): PrefabTransform {
  return structuredClone(IDENTITY_TRANSFORM);
}

export function validateBackpackPrefab(doc: PrefabDocument): string[] {
  if (doc.kind !== 'item') return ['Backpack visual must reference an item prefab.'];
  const sockets = collectEquipmentSockets(doc);
  const errors: string[] = [];
  for (const id of BACKPACK_RIFLE_SOCKET_IDS) {
    const matches = sockets.filter((socket) => socket.id === id);
    if (matches.length !== 1 || matches[0]?.accepts !== 'rifle') {
      errors.push(`Expected exactly one rifle socket named "${id}".`);
    }
  }
  const unexpected = sockets.filter(
    (socket) =>
      socket.id !== 'rifle-primary' && socket.id !== 'rifle-secondary',
  );
  if (unexpected.length > 0) {
    errors.push(`Unexpected equipment sockets: ${unexpected.map((socket) => socket.id).join(', ')}.`);
  }
  return errors;
}

/** Soft validation for weapon item prefabs (drawn grip is recommended, not required). */
export function validateWeaponPrefab(doc: PrefabDocument): string[] {
  if (doc.kind !== 'item') return ['Weapon visual must reference an item prefab.'];
  const counts = {
    'drawn-grip': 0,
    'muzzle-flash': 0,
    'barrel-end': 0,
    'weapon-combat': 0,
  };
  const visit = (entity: PrefabEntity): void => {
    for (const component of entity.components ?? []) {
      if (component.type in counts) {
        counts[component.type as keyof typeof counts] += 1;
      }
    }
    for (const child of entity.children ?? []) visit(child);
  };
  visit(doc.root);
  const errors: string[] = [];
  for (const type of Object.keys(counts) as Array<keyof typeof counts>) {
    if (counts[type] > 1) {
      errors.push(`Expected at most one ${type} component on a weapon prefab.`);
    }
  }
  return errors;
}
