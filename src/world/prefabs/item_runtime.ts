import type { WeaponSlotType } from '../../types/equipment';
import type { PrefabDocument, PrefabEntity } from './schema';

export interface EquipmentSocketLayout {
  id: string;
  accepts: WeaponSlotType;
  entityId: string;
}

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
