import type { ReactElement } from 'react';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import type { ComponentFieldsProps } from './context';
import { FieldRow, TextField, SelectField } from '../InspectorForm';

export function EquipmentSocketFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'equipment-socket' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Socket id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Accepts" wide>
        <SelectField
          options={['sword', 'handgun', 'rifle']}
          value={component.accepts}
          onCommit={(accepts) =>
            update({
              ...component,
              accepts: accepts as 'sword' | 'handgun' | 'rifle',
            })
          }
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
