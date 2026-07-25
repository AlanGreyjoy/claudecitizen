import type { ReactElement } from 'react';
import {
  CheckboxRow,
  FieldRow,
  ImageAssetUrlField,
  NumberField,
  SelectField,
} from '../../InspectorForm';
import { ParticleModule } from './Editors';
import type { ParticleComponent, ParticleModuleProps } from './types';

type RendererModuleProps = ParticleModuleProps & {
  renderer: ParticleComponent['renderer'];
};

export function ParticleRendererModule({
  component,
  update,
  renderer,
}: RendererModuleProps): ReactElement {
  return (
    <ParticleModule title="Renderer">
      <FieldRow label="Mode" wide>
        <SelectField
          options={['billboard', 'stretched-billboard', 'horizontal', 'vertical']}
          value={renderer.renderMode}
          onCommit={(renderMode) =>
            update({
              ...component,
              renderer: {
                ...renderer,
                renderMode: renderMode as typeof renderer.renderMode,
              },
            })
          }
        />
      </FieldRow>
      <ImageAssetUrlField
        label="Texture"
        value={renderer.textureUrl}
        onCommit={(textureUrl) =>
          update({ ...component, renderer: { ...renderer, textureUrl } })
        }
      />
      <FieldRow label="Blend" wide>
        <SelectField
          options={['alpha', 'additive']}
          value={renderer.blendMode}
          onCommit={(blendMode) =>
            update({
              ...component,
              renderer: {
                ...renderer,
                blendMode: blendMode as typeof renderer.blendMode,
              },
            })
          }
        />
      </FieldRow>
      <CheckboxRow
        label="Soft Particles"
        checked={renderer.softParticles}
        onChange={(softParticles) =>
          update({ ...component, renderer: { ...renderer, softParticles } })
        }
      />
      <FieldRow label="Soft Near" wide>
        <NumberField
          value={renderer.softParticleNearFade}
          onCommit={(softParticleNearFade) =>
            update({ ...component, renderer: { ...renderer, softParticleNearFade } })
          }
        />
      </FieldRow>
      <FieldRow label="Soft Far" wide>
        <NumberField
          value={renderer.softParticleFarFade}
          onCommit={(softParticleFarFade) =>
            update({ ...component, renderer: { ...renderer, softParticleFarFade } })
          }
        />
      </FieldRow>
      <FieldRow label="Length Scale" wide>
        <NumberField
          value={renderer.lengthScale}
          onCommit={(lengthScale) =>
            update({ ...component, renderer: { ...renderer, lengthScale } })
          }
        />
      </FieldRow>
      <FieldRow label="Speed Scale" wide>
        <NumberField
          value={renderer.speedScale}
          onCommit={(speedScale) =>
            update({ ...component, renderer: { ...renderer, speedScale } })
          }
        />
      </FieldRow>
      <FieldRow label="Sort" wide>
        <SelectField
          options={['none', 'by-distance']}
          value={renderer.sortMode}
          onCommit={(sortMode) =>
            update({
              ...component,
              renderer: {
                ...renderer,
                sortMode: sortMode as typeof renderer.sortMode,
              },
            })
          }
        />
      </FieldRow>
    </ParticleModule>
  );
}
