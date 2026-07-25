import type { ReactElement } from 'react';
import { CheckboxRow, FieldRow, NumberField, SelectField } from '../../InspectorForm';
import { ParticleModule } from './Editors';
import type { ParticleComponent, ParticleModuleProps } from './types';

type ShapeModuleProps = ParticleModuleProps & {
  shape: ParticleComponent['shape'];
};

export function ParticleShapeModule({
  component,
  update,
  shape,
}: ShapeModuleProps): ReactElement {
  return (
    <ParticleModule
      title="Shape"
      enabled={shape.enabled}
      onToggle={(enabled) => update({ ...component, shape: { ...shape, enabled } })}
    >
      <FieldRow label="Shape" wide>
        <SelectField
          options={['sphere', 'hemisphere', 'cone', 'box', 'circle', 'edge']}
          value={shape.shape}
          onCommit={(next) =>
            update({
              ...component,
              shape: { ...shape, shape: next as typeof shape.shape },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Radius" wide>
        <NumberField
          value={shape.radius}
          onCommit={(radius) =>
            update({ ...component, shape: { ...shape, radius: Math.max(0, radius) } })
          }
        />
      </FieldRow>
      <FieldRow label="Radius Thickness" wide>
        <NumberField
          value={shape.radiusThickness}
          onCommit={(radiusThickness) =>
            update({
              ...component,
              shape: {
                ...shape,
                radiusThickness: Math.min(1, Math.max(0, radiusThickness)),
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Angle" wide>
        <NumberField
          value={shape.angle}
          onCommit={(angle) =>
            update({
              ...component,
              shape: { ...shape, angle: Math.min(180, Math.max(0, angle)) },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Arc" wide>
        <NumberField
          value={shape.arc}
          onCommit={(arc) =>
            update({
              ...component,
              shape: { ...shape, arc: Math.min(360, Math.max(0, arc)) },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Box">
        <NumberField
          value={shape.box.x}
          onCommit={(x) =>
            update({ ...component, shape: { ...shape, box: { ...shape.box, x } } })
          }
        />
        <NumberField
          value={shape.box.y}
          onCommit={(y) =>
            update({ ...component, shape: { ...shape, box: { ...shape.box, y } } })
          }
        />
        <NumberField
          value={shape.box.z}
          onCommit={(z) =>
            update({ ...component, shape: { ...shape, box: { ...shape.box, z } } })
          }
        />
      </FieldRow>
      <FieldRow label="Emit From" wide>
        <SelectField
          options={['volume', 'shell', 'edge']}
          value={shape.emitFrom}
          onCommit={(emitFrom) =>
            update({
              ...component,
              shape: { ...shape, emitFrom: emitFrom as typeof shape.emitFrom },
            })
          }
        />
      </FieldRow>
      <CheckboxRow
        label="Align To Direction"
        checked={shape.alignToDirection}
        onChange={(alignToDirection) =>
          update({ ...component, shape: { ...shape, alignToDirection } })
        }
      />
    </ParticleModule>
  );
}
