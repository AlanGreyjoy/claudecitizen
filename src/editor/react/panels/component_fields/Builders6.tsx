import type { ReactElement } from 'react';
import { COCKPIT_STAT_KINDS, type PrefabComponent } from '../../../../world/prefabs/schema';
import type { ComponentFieldsProps } from './context';
import { ConsumableShopFields } from './ConsumableShopFields';
import { FieldRow, Hint, NumberField, SelectField, TextField } from '../InspectorForm';

export function WeaponShopFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'weapon-shop' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? 'Browse weapons'}
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
      <Hint>
        Optional comma-separated weapon definition IDs. Empty = all catalog weapons.
      </Hint>
    </>
  );
}

export function OutfittersFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'outfitters' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? 'Browse outfitters'}
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
      <Hint>
        Optional comma-separated catalog IDs. Empty = all stocked outfitters items (Back =
        backpacks).
      </Hint>
    </>
  );
}

export function FoodShopFields(
  props: ComponentFieldsProps<Extract<PrefabComponent, { type: 'food-shop' }>>,
): ReactElement {
  return <ConsumableShopFields {...props} />;
}

export function DrinksShopFields(
  props: ComponentFieldsProps<Extract<PrefabComponent, { type: 'drinks-shop' }>>,
): ReactElement {
  return <ConsumableShopFields {...props} />;
}

export function CanteenFields(
  props: ComponentFieldsProps<Extract<PrefabComponent, { type: 'canteen' }>>,
): ReactElement {
  return <ConsumableShopFields {...props} />;
}

export function PharmacyFields(
  props: ComponentFieldsProps<Extract<PrefabComponent, { type: 'pharmacy' }>>,
): ReactElement {
  return <ConsumableShopFields {...props} />;
}

export function CockpitStatFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'cockpit-stat' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Kind" wide>
        <SelectField
          options={[...COCKPIT_STAT_KINDS]}
          value={component.kind}
          onCommit={(kind) =>
            update({
              ...component,
              kind: kind as (typeof COCKPIT_STAT_KINDS)[number],
            })
          }
        />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? ''}
          onCommit={(label) =>
            update({
              ...component,
              label: label.trim() ? label.trim() : undefined,
            })
          }
        />
      </FieldRow>
      <FieldRow label="Max distance" wide>
        <NumberField
          value={component.maxDistance ?? 3.5}
          step={0.1}
          onCommit={(maxDistance) =>
            update({
              ...component,
              maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
            })
          }
        />
      </FieldRow>
    </>
  );
}
