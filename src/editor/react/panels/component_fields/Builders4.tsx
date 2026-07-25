import type { ReactElement } from 'react';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import type { ComponentFieldsProps } from './context';
import { EmptyNote, FieldRow, NumberField, TextField } from '../InspectorForm';
import { ShipControllerFields } from './ShipControllerFields';

export { ShipControllerFields };

export function ShipFrameFields(): ReactElement {
  return <></>;
}

export function ShipStatsFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'ship-stats' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Max spd" wide>
        <NumberField
          value={component.maxSpeedMps ?? 100}
          onCommit={(next) =>
            update({
              ...component,
              maxSpeedMps: Math.min(500, Math.max(5, next)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Max HP" wide>
        <NumberField
          value={component.maxHp ?? 1000}
          onCommit={(next) =>
            update({
              ...component,
              maxHp: Math.min(100_000, Math.max(1, next)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Shields" wide>
        <NumberField
          value={component.maxShields ?? 500}
          onCommit={(next) =>
            update({
              ...component,
              maxShields: Math.min(100_000, Math.max(0, next)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Regen/s" wide>
        <NumberField
          value={component.shieldRegenPerSec ?? 25}
          onCommit={(next) =>
            update({
              ...component,
              shieldRegenPerSec: Math.min(10_000, Math.max(0, next)),
            })
          }
        />
      </FieldRow>
    </>
  );
}

export function ShipGearFields({
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'ship-gear' }>>): ReactElement {
  return (
    <EmptyNote>
      {component.nodes.length} gear hinge(s). Edit nodes in the prefab JSON for now.
    </EmptyNote>
  );
}

export function ShipRampFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'ship-ramp' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Node" wide>
        <TextField
          value={component.node}
          onCommit={(node) => update({ ...component, node })}
        />
      </FieldRow>
      <FieldRow label="Lower °" wide>
        <NumberField
          value={component.lowerRadians}
          onCommit={(lowerRadians) =>
            update({
              ...component,
              lowerRadians: Math.min(10, Math.max(-10, lowerRadians)),
            })
          }
        />
      </FieldRow>
    </>
  );
}

export function ShipHullFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'ship-hull' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Rest ht" wide>
        <NumberField
          value={component.restHeight ?? 0}
          onCommit={(next) =>
            update({
              ...component,
              restHeight: next <= 0 ? undefined : Math.min(50, Math.max(0.2, next)),
            })
          }
        />
      </FieldRow>
      <EmptyNote>
        Ship origin height above ground when parked (m). 0 = auto. Viewport shows a pad
        disc at −rest ht under the origin.
      </EmptyNote>
    </>
  );
}
