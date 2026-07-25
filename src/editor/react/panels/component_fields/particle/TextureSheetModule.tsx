import type { ReactElement } from 'react';
import { FieldRow, NumberField, SelectField } from '../../InspectorForm';
import { ParticleModule } from './Editors';
import type { ParticleComponent, ParticleModuleProps } from './types';

type TextureSheetModuleProps = ParticleModuleProps & {
  sheet: NonNullable<ParticleComponent['textureSheetAnimation']>;
};

export function ParticleTextureSheetModule({
  component,
  update,
  sheet,
}: TextureSheetModuleProps): ReactElement {
  return (
    <ParticleModule
      title="Texture Sheet Animation"
      enabled={sheet.enabled}
      onToggle={(enabled) =>
        update({ ...component, textureSheetAnimation: { ...sheet, enabled } })
      }
    >
      <FieldRow label="Tiles X" wide>
        <NumberField
          value={sheet.tilesX}
          step={1}
          onCommit={(tilesX) =>
            update({
              ...component,
              textureSheetAnimation: {
                ...sheet,
                tilesX: Math.max(1, Math.floor(tilesX)),
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Tiles Y" wide>
        <NumberField
          value={sheet.tilesY}
          step={1}
          onCommit={(tilesY) =>
            update({
              ...component,
              textureSheetAnimation: {
                ...sheet,
                tilesY: Math.max(1, Math.floor(tilesY)),
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Animation" wide>
        <SelectField
          options={['whole-sheet', 'single-row']}
          value={sheet.animation}
          onCommit={(animation) =>
            update({
              ...component,
              textureSheetAnimation: {
                ...sheet,
                animation: animation as 'whole-sheet' | 'single-row',
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Cycles" wide>
        <NumberField
          value={sheet.cycles}
          onCommit={(cycles) =>
            update({
              ...component,
              textureSheetAnimation: { ...sheet, cycles: Math.max(0.01, cycles) },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Start Frame" wide>
        <NumberField
          value={sheet.startFrame}
          step={1}
          onCommit={(startFrame) =>
            update({
              ...component,
              textureSheetAnimation: {
                ...sheet,
                startFrame: Math.max(0, Math.floor(startFrame)),
              },
            })
          }
        />
      </FieldRow>
    </ParticleModule>
  );
}
