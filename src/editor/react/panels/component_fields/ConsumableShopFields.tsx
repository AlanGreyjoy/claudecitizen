import type { ReactElement } from 'react';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import type { ComponentFieldsProps } from './context';
import { FieldRow, Hint, NumberField, TextField } from '../InspectorForm';

type ConsumableShopComponent = Extract<
  PrefabComponent,
  { type: 'food-shop' | 'drinks-shop' | 'canteen' }
>;

function consumableShopDefaults(component: ConsumableShopComponent): {
  defaultLabel: string;
  filterHint: string;
} {
  if (component.type === 'food-shop') {
    return {
      defaultLabel: 'Browse food',
      filterHint: 'Optional comma-separated food item IDs. Empty = all food consumables.',
    };
  }
  if (component.type === 'drinks-shop') {
    return {
      defaultLabel: 'Browse drinks',
      filterHint: 'Optional comma-separated drink item IDs. Empty = all drink consumables.',
    };
  }
  return {
    defaultLabel: 'Browse food & drinks',
    filterHint:
      'Optional comma-separated consumable IDs. Empty = all food and drinks.',
  };
}

export function ConsumableShopFields({
  ctx,
  component,
}: ComponentFieldsProps<ConsumableShopComponent>): ReactElement {
  const { update } = ctx;
  const { defaultLabel, filterHint } = consumableShopDefaults(component);
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? defaultLabel}
          onCommit={(label) =>
            update({
              ...component,
              label: label.trim() ? label.trim() : undefined,
            })
          }
        />
      </FieldRow>
      <FieldRow label="Gaze radius" wide>
        <NumberField
          value={component.gazeRadius ?? 0.4}
          step={0.05}
          onCommit={(gazeRadius) =>
            update({
              ...component,
              gazeRadius: Math.max(0.05, Math.min(2, gazeRadius)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Max distance" wide>
        <NumberField
          value={component.maxDistance ?? 3}
          step={0.1}
          onCommit={(maxDistance) =>
            update({
              ...component,
              maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Screen width" wide>
        <NumberField
          value={component.screenWidth ?? 0.45}
          step={0.05}
          onCommit={(screenWidth) =>
            update({
              ...component,
              screenWidth: Math.max(0.2, Math.min(2, screenWidth)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Screen height" wide>
        <NumberField
          value={component.screenHeight ?? 0.28}
          step={0.05}
          onCommit={(screenHeight) =>
            update({
              ...component,
              screenHeight: Math.max(0.15, Math.min(1.5, screenHeight)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Item IDs" wide>
        <TextField
          value={(component.itemDefinitionIds ?? []).join(', ')}
          onCommit={(raw) => {
            const ids = raw
              .split(/[,\s]+/)
              .map((id) => id.trim())
              .filter((id) => id.length > 0);
            update({
              ...component,
              itemDefinitionIds: ids.length > 0 ? ids : undefined,
            });
          }}
        />
      </FieldRow>
      <Hint>{filterHint}</Hint>
    </>
  );
}
