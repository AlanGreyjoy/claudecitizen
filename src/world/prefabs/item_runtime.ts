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

const IDENTITY_TRANSFORM: PrefabTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

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

export function identityDrawnGripTransform(): PrefabTransform {
  return structuredClone(IDENTITY_TRANSFORM);
}

export function validateBackpackPrefab(doc: PrefabDocument): string[] {
  if (doc.kind !== 'item') return ['Backpack visual must reference an item prefab.'];
  const sockets = collectEquipmentSockets(doc);
  const errors: string[] = [];
  for (const id of ['rifle-primary', 'rifle-secondary']) {
    const matches = sockets.filter((socket) => socket.id === id);
    if (matches.length !== 1 || matches[0]?.accepts !== 'rifle') {
      errors.push(`Expected exactly one rifle socket named "${id}".`);
    }
  }
  const unexpected = sockets.filter(
    (socket) => socket.id !== 'rifle-primary' && socket.id !== 'rifle-secondary',
  );
  if (unexpected.length > 0) {
    errors.push(`Unexpected equipment sockets: ${unexpected.map((socket) => socket.id).join(', ')}.`);
  }
  return errors;
}

/** Soft validation for weapon item prefabs (drawn grip is recommended, not required). */
export function validateWeaponPrefab(doc: PrefabDocument): string[] {
  if (doc.kind !== 'item') return ['Weapon visual must reference an item prefab.'];
  const grips: PrefabEntity[] = [];
  const visit = (entity: PrefabEntity): void => {
    if ((entity.components ?? []).some((component) => component.type === 'drawn-grip')) {
      grips.push(entity);
    }
    for (const child of entity.children ?? []) visit(child);
  };
  visit(doc.root);
  if (grips.length > 1) return ['Expected at most one drawn-grip marker on a weapon prefab.'];
  return [];
}
