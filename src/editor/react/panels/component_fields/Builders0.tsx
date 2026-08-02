import type { ReactElement } from 'react';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import {
  BACKPACK_RIFLE_SOCKET_IDS,
  nextEquipmentSocketId,
} from '../../../../world/prefabs/item-runtime';
import type { WeaponSlotType } from '../../../../types/equipment';
import type { ComponentFieldsProps } from './context';
import { FieldRow, TextField, SelectField } from '../InspectorForm';

function collectDocEquipmentSockets(
  store: ComponentFieldsProps['ctx']['store'],
): Array<{ id: string; accepts: WeaponSlotType }> {
  const sockets: Array<{ id: string; accepts: WeaponSlotType }> = [];
  const visit = (entities: ReturnType<typeof store.getState>['roots']): void => {
    for (const current of entities) {
      for (const entry of current.components) {
        if (entry.type === 'equipment-socket') {
          sockets.push({ id: entry.id, accepts: entry.accepts });
        }
      }
      visit(current.children);
    }
  };
  visit(store.getState().roots);
  return sockets;
}

function isGeneratedSocketId(id: string, accepts: WeaponSlotType): boolean {
  if (accepts === 'rifle' && (BACKPACK_RIFLE_SOCKET_IDS as readonly string[]).includes(id)) {
    return true;
  }
  if (id === accepts) return true;
  return new RegExp(`^${accepts}-\\d+$`).test(id);
}

export function EquipmentSocketFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'equipment-socket' }>>): ReactElement {
  const { update, store } = ctx;
  return (
    <>
      <FieldRow label="Socket id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Accepts" wide>
        <SelectField
          options={['sword', 'handgun', 'rifle']}
          value={component.accepts}
          onCommit={(accepts) => {
            const nextAccepts = accepts as WeaponSlotType;
            const rename = isGeneratedSocketId(component.id, component.accepts);
            const id = rename
              ? nextEquipmentSocketId(
                  collectDocEquipmentSockets(store),
                  nextAccepts,
                  component.id,
                )
              : component.id;
            update({
              ...component,
              accepts: nextAccepts,
              id,
            });
          }}
        />
      </FieldRow>
    </>
  );
}

export function StationFrameFields(): ReactElement {
  return <></>;
}

export function PropFrameFields(): ReactElement {
  return <></>;
}

export function ItemFrameFields(): ReactElement {
  return <></>;
}

export function DrawnGripFields(): ReactElement {
  return <></>;
}

export function MuzzleFlashFields(): ReactElement {
  return <></>;
}
