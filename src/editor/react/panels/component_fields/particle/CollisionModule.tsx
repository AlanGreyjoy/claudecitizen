import type { ReactElement } from 'react';
import { CheckboxRow, FieldRow, NumberField } from '../../InspectorForm';
import { ParticleModule } from './Editors';
import type { ParticleComponent, ParticleModuleProps } from './types';

type CollisionModuleProps = ParticleModuleProps & {
  collision: NonNullable<ParticleComponent['collision']>;
};

export function ParticleCollisionModule({
  component,
  update,
  collision,
}: CollisionModuleProps): ReactElement {
  return (
    <ParticleModule
      title="Collision"
      enabled={collision.enabled}
      onToggle={(enabled) =>
        update({ ...component, collision: { ...collision, enabled } })
      }
    >
      <CheckboxRow
        label="Ground Plane (Y=0)"
        checked={collision.groundPlane}
        onChange={(groundPlane) =>
          update({ ...component, collision: { ...collision, groundPlane } })
        }
      />
      <FieldRow label="Dampen" wide>
        <NumberField
          value={collision.dampen}
          onCommit={(dampen) =>
            update({
              ...component,
              collision: {
                ...collision,
                dampen: Math.min(1, Math.max(0, dampen)),
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Bounce" wide>
        <NumberField
          value={collision.bounce}
          onCommit={(bounce) =>
            update({
              ...component,
              collision: {
                ...collision,
                bounce: Math.min(1, Math.max(0, bounce)),
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Lifetime Loss" wide>
        <NumberField
          value={collision.lifetimeLoss}
          onCommit={(lifetimeLoss) =>
            update({
              ...component,
              collision: {
                ...collision,
                lifetimeLoss: Math.min(1, Math.max(0, lifetimeLoss)),
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Max Kill Speed" wide>
        <NumberField
          value={collision.maxKillSpeed}
          onCommit={(maxKillSpeed) =>
            update({
              ...component,
              collision: { ...collision, maxKillSpeed: Math.max(0, maxKillSpeed) },
            })
          }
        />
      </FieldRow>
    </ParticleModule>
  );
}
