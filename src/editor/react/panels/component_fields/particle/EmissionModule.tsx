import type { ReactElement } from 'react';
import { EdButton, FieldRow, NumberField } from '../../InspectorForm';
import { MinMaxEditor, ParticleModule } from './Editors';
import type { ParticleModuleProps } from './types';

export function ParticleEmissionModule({ component, update }: ParticleModuleProps): ReactElement {
  return (
    <ParticleModule title="Emission">
      <FieldRow label="Rate over Time" wide>
        <NumberField
          value={component.emission.rateOverTime}
          onCommit={(rateOverTime) =>
            update({
              ...component,
              emission: {
                ...component.emission,
                rateOverTime: Math.max(0, rateOverTime),
              },
            })
          }
        />
      </FieldRow>
      <div className="ed-field-label">Bursts ({component.emission.bursts.length})</div>
      {component.emission.bursts.map((burst, index) => (
        <div key={index}>
          <FieldRow label={`Burst ${index} time`}>
            <NumberField
              value={burst.time}
              onCommit={(time) => {
                const bursts = component.emission.bursts.map((b, i) =>
                  i === index ? { ...b, time: Math.max(0, time) } : b,
                );
                update({ ...component, emission: { ...component.emission, bursts } });
              }}
            />
            <EdButton
              onClick={() => {
                const bursts = component.emission.bursts.filter((_, i) => i !== index);
                update({ ...component, emission: { ...component.emission, bursts } });
              }}
            >
              ×
            </EdButton>
          </FieldRow>
          <MinMaxEditor
            label={`Burst ${index} count`}
            value={burst.count}
            onCommit={(count) => {
              const bursts = component.emission.bursts.map((b, i) =>
                i === index ? { ...b, count } : b,
              );
              update({ ...component, emission: { ...component.emission, bursts } });
            }}
          />
        </div>
      ))}
      <EdButton
        onClick={() =>
          update({
            ...component,
            emission: {
              ...component.emission,
              bursts: [
                ...component.emission.bursts,
                {
                  time: 0,
                  count: { mode: 'constant', value: 12 },
                  cycles: 1,
                  interval: 0.5,
                },
              ],
            },
          })
        }
      >
        Add burst
      </EdButton>
    </ParticleModule>
  );
}
