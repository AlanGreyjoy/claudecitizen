import type { ReactElement } from 'react';
import { GradientEditor, ParticleModule } from './Editors';
import type { ParticleComponent, ParticleModuleProps } from './types';

type ColorModuleProps = ParticleModuleProps & {
  colorOver: NonNullable<ParticleComponent['colorOverLifetime']>;
};

export function ParticleColorModule({
  component,
  update,
  colorOver,
}: ColorModuleProps): ReactElement {
  return (
    <ParticleModule
      title="Color over Lifetime"
      enabled={colorOver.enabled}
      onToggle={(enabled) =>
        update({ ...component, colorOverLifetime: { ...colorOver, enabled } })
      }
    >
      <GradientEditor
        label="Gradient"
        gradient={colorOver.gradient}
        onCommit={(gradient) =>
          update({ ...component, colorOverLifetime: { ...colorOver, gradient } })
        }
      />
    </ParticleModule>
  );
}
