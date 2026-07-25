import type { ReactElement } from 'react';
import { PARTICLE_MAX_PARTICLES_HARD_CAP } from '../../../../../world/prefabs/schema';
import { CheckboxRow, ColorField, FieldRow, NumberField, SelectField } from '../../InspectorForm';
import { MinMaxEditor, ParticleModule } from './Editors';
import type { ParticleModuleProps } from './types';

export function ParticleMainModule({ component, update }: ParticleModuleProps): ReactElement {
  return (
    <ParticleModule title="Main">
      <CheckboxRow
        label="Enabled"
        checked={component.enabled !== false}
        onChange={(enabled) => update({ ...component, enabled })}
      />
      <CheckboxRow
        label="Play On Awake"
        checked={component.playOnAwake !== false}
        onChange={(playOnAwake) => update({ ...component, playOnAwake })}
      />
      <CheckboxRow
        label="Looping"
        checked={component.looping}
        onChange={(looping) => update({ ...component, looping })}
      />
      <CheckboxRow
        label="Prewarm"
        checked={Boolean(component.prewarm)}
        onChange={(prewarm) => update({ ...component, prewarm })}
      />
      <FieldRow label="Duration" wide>
        <NumberField
          value={component.duration}
          onCommit={(duration) =>
            update({ ...component, duration: Math.max(0.01, duration) })
          }
        />
      </FieldRow>
      <MinMaxEditor
        label="Start Delay"
        value={component.startDelay}
        onCommit={(startDelay) => update({ ...component, startDelay })}
      />
      <MinMaxEditor
        label="Start Lifetime"
        value={component.startLifetime}
        onCommit={(startLifetime) => update({ ...component, startLifetime })}
      />
      <MinMaxEditor
        label="Start Speed"
        value={component.startSpeed}
        onCommit={(startSpeed) => update({ ...component, startSpeed })}
      />
      <MinMaxEditor
        label="Start Size"
        value={component.startSize}
        onCommit={(startSize) => update({ ...component, startSize })}
      />
      <FieldRow label="Start Color" wide>
        <ColorField
          value={component.startColor}
          onCommit={(startColor) => update({ ...component, startColor })}
        />
      </FieldRow>
      <MinMaxEditor
        label="Start Rotation"
        value={component.startRotation}
        onCommit={(startRotation) => update({ ...component, startRotation })}
      />
      <FieldRow label="Gravity" wide>
        <NumberField
          value={component.gravityModifier}
          onCommit={(gravityModifier) => update({ ...component, gravityModifier })}
        />
      </FieldRow>
      <FieldRow label="Simulation" wide>
        <SelectField
          options={['local', 'world']}
          value={component.simulationSpace}
          onCommit={(simulationSpace) =>
            update({
              ...component,
              simulationSpace: simulationSpace as 'local' | 'world',
            })
          }
        />
      </FieldRow>
      <FieldRow label="Max Particles" wide>
        <NumberField
          value={component.maxParticles}
          step={1}
          onCommit={(maxParticles) =>
            update({
              ...component,
              maxParticles: Math.min(
                PARTICLE_MAX_PARTICLES_HARD_CAP,
                Math.max(1, Math.floor(maxParticles)),
              ),
            })
          }
        />
      </FieldRow>
    </ParticleModule>
  );
}
