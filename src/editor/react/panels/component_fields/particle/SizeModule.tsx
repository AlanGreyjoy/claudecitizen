import type { ReactElement } from 'react';
import { CurveEditor, ParticleModule } from './Editors';
import type { ParticleComponent, ParticleModuleProps } from './types';

type SizeModuleProps = ParticleModuleProps & {
  sizeOver: NonNullable<ParticleComponent['sizeOverLifetime']>;
};

export function ParticleSizeModule({
  component,
  update,
  sizeOver,
}: SizeModuleProps): ReactElement {
  return (
    <ParticleModule
      title="Size over Lifetime"
      enabled={sizeOver.enabled}
      onToggle={(enabled) =>
        update({ ...component, sizeOverLifetime: { ...sizeOver, enabled } })
      }
    >
      <CurveEditor
        label="Curve"
        curve={sizeOver.curve}
        onCommit={(curve) =>
          update({ ...component, sizeOverLifetime: { ...sizeOver, curve } })
        }
      />
    </ParticleModule>
  );
}
