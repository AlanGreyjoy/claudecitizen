import type { ReactElement } from 'react';
import { FieldRow, NumberField } from '../../InspectorForm';
import { ParticleModule } from './Editors';
import type { ParticleComponent, ParticleModuleProps } from './types';

type ForceModuleProps = ParticleModuleProps & {
  force: NonNullable<ParticleComponent['forceOverLifetime']>;
};

export function ParticleForceModule({
  component,
  update,
  force,
}: ForceModuleProps): ReactElement {
  return (
    <ParticleModule
      title="Force over Lifetime"
      enabled={force.enabled}
      onToggle={(enabled) =>
        update({ ...component, forceOverLifetime: { ...force, enabled } })
      }
    >
      <FieldRow label="Force">
        <NumberField
          value={force.force.x}
          onCommit={(x) =>
            update({
              ...component,
              forceOverLifetime: { ...force, force: { ...force.force, x } },
            })
          }
        />
        <NumberField
          value={force.force.y}
          onCommit={(y) =>
            update({
              ...component,
              forceOverLifetime: { ...force, force: { ...force.force, y } },
            })
          }
        />
        <NumberField
          value={force.force.z}
          onCommit={(z) =>
            update({
              ...component,
              forceOverLifetime: { ...force, force: { ...force.force, z } },
            })
          }
        />
      </FieldRow>
    </ParticleModule>
  );
}
