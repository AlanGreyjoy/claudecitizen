import type { ReactElement } from 'react';
import { CheckboxRow, FieldRow, NumberField } from '../../InspectorForm';
import { CurveEditor, GradientEditor, ParticleModule } from './Editors';
import type { ParticleComponent, ParticleModuleProps } from './types';

type TrailsModuleProps = ParticleModuleProps & {
  trails: NonNullable<ParticleComponent['trails']>;
};

export function ParticleTrailsModule({
  component,
  update,
  trails,
}: TrailsModuleProps): ReactElement {
  return (
    <ParticleModule
      title="Trails"
      enabled={trails.enabled}
      onToggle={(enabled) => update({ ...component, trails: { ...trails, enabled } })}
    >
      <FieldRow label="Ratio" wide>
        <NumberField
          value={trails.ratio}
          onCommit={(ratio) =>
            update({
              ...component,
              trails: { ...trails, ratio: Math.min(1, Math.max(0, ratio)) },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Lifetime" wide>
        <NumberField
          value={trails.lifetime}
          onCommit={(lifetime) =>
            update({
              ...component,
              trails: { ...trails, lifetime: Math.max(0.01, lifetime) },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Min Vertex Dist" wide>
        <NumberField
          value={trails.minVertexDistance}
          onCommit={(minVertexDistance) =>
            update({
              ...component,
              trails: {
                ...trails,
                minVertexDistance: Math.max(0.001, minVertexDistance),
              },
            })
          }
        />
      </FieldRow>
      <CheckboxRow
        label="Die With Particles"
        checked={trails.dieWithParticles}
        onChange={(dieWithParticles) =>
          update({ ...component, trails: { ...trails, dieWithParticles } })
        }
      />
      <CurveEditor
        label="Width over Trail"
        curve={trails.widthOverTrail}
        onCommit={(widthOverTrail) =>
          update({ ...component, trails: { ...trails, widthOverTrail } })
        }
      />
      <GradientEditor
        label="Color over Trail"
        gradient={trails.colorOverTrail}
        onCommit={(colorOverTrail) =>
          update({ ...component, trails: { ...trails, colorOverTrail } })
        }
      />
    </ParticleModule>
  );
}
