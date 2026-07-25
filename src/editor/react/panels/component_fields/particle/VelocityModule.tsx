import type { ReactElement } from 'react';
import { FieldRow, NumberField } from '../../InspectorForm';
import { ParticleModule } from './Editors';
import type { ParticleComponent, ParticleModuleProps } from './types';

type VelocityModuleProps = ParticleModuleProps & {
  vel: NonNullable<ParticleComponent['velocityOverLifetime']>;
};

export function ParticleVelocityModule({
  component,
  update,
  vel,
}: VelocityModuleProps): ReactElement {
  return (
    <ParticleModule
      title="Velocity over Lifetime"
      enabled={vel.enabled}
      onToggle={(enabled) =>
        update({ ...component, velocityOverLifetime: { ...vel, enabled } })
      }
    >
      <FieldRow label="Linear">
        <NumberField
          value={vel.linear.x}
          onCommit={(x) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, linear: { ...vel.linear, x } },
            })
          }
        />
        <NumberField
          value={vel.linear.y}
          onCommit={(y) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, linear: { ...vel.linear, y } },
            })
          }
        />
        <NumberField
          value={vel.linear.z}
          onCommit={(z) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, linear: { ...vel.linear, z } },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Orbital">
        <NumberField
          value={vel.orbital.x}
          onCommit={(x) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, orbital: { ...vel.orbital, x } },
            })
          }
        />
        <NumberField
          value={vel.orbital.y}
          onCommit={(y) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, orbital: { ...vel.orbital, y } },
            })
          }
        />
        <NumberField
          value={vel.orbital.z}
          onCommit={(z) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, orbital: { ...vel.orbital, z } },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Radial" wide>
        <NumberField
          value={vel.radial}
          onCommit={(radial) =>
            update({ ...component, velocityOverLifetime: { ...vel, radial } })
          }
        />
      </FieldRow>
    </ParticleModule>
  );
}
