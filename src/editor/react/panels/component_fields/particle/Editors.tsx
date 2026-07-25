import type { ReactElement, ReactNode } from 'react';
import type { PrefabCurve, PrefabGradient, PrefabMinMax } from '../../../../../world/prefabs/schema';
import {
  ColorField,
  EdButton,
  FieldRow,
  ModuleBlock,
  NumberField,
  SelectField,
} from '../../InspectorForm';

export function MinMaxEditor({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: PrefabMinMax;
  onCommit: (next: PrefabMinMax) => void;
}): ReactElement {
  const mode = value.mode;
  return (
    <>
      <FieldRow label={label} wide>
        <SelectField
          options={['constant', 'random']}
          value={mode}
          onCommit={(nextMode) => {
            if (nextMode === 'random') {
              const base = mode === 'constant' ? value.value : value.min;
              onCommit({ mode: 'random', min: base, max: base });
            } else {
              const base =
                mode === 'constant' ? value.value : (value.min + value.max) * 0.5;
              onCommit({ mode: 'constant', value: base });
            }
          }}
        />
      </FieldRow>
      {mode === 'constant' ? (
        <FieldRow label={`${label} value`} wide>
          <NumberField
            value={value.value}
            onCommit={(v) => onCommit({ mode: 'constant', value: v })}
          />
        </FieldRow>
      ) : (
        <FieldRow label={`${label} min/max`}>
          <NumberField
            value={value.min}
            onCommit={(min) =>
              onCommit({ mode: 'random', min, max: Math.max(min, value.max) })
            }
          />
          <NumberField
            value={value.max}
            onCommit={(max) =>
              onCommit({ mode: 'random', min: Math.min(value.min, max), max })
            }
          />
          <span />
        </FieldRow>
      )}
    </>
  );
}

export function CurveEditor({
  label,
  curve,
  onCommit,
}: {
  label: string;
  curve: PrefabCurve;
  onCommit: (next: PrefabCurve) => void;
}): ReactElement {
  return (
    <div className="ed-particle-module-body">
      <div className="ed-field-label">{label}</div>
      {curve.map((key, index) => (
        <FieldRow key={index} label={`Key ${index}`}>
          <NumberField
            value={key.t}
            step={0.05}
            onCommit={(t) => {
              const next = curve.map((k, i) =>
                i === index ? { ...k, t: Math.min(1, Math.max(0, t)) } : k,
              );
              onCommit(next);
            }}
          />
          <NumberField
            value={key.value}
            onCommit={(val) => {
              const next = curve.map((k, i) => (i === index ? { ...k, value: val } : k));
              onCommit(next);
            }}
          />
          <EdButton
            onClick={() => {
              if (curve.length <= 1) return;
              onCommit(curve.filter((_, i) => i !== index));
            }}
          >
            ×
          </EdButton>
        </FieldRow>
      ))}
      <EdButton
        onClick={() =>
          onCommit([...curve, { t: 1, value: curve[curve.length - 1]?.value ?? 1 }])
        }
      >
        Add key
      </EdButton>
    </div>
  );
}

export function GradientEditor({
  label,
  gradient,
  onCommit,
}: {
  label: string;
  gradient: PrefabGradient;
  onCommit: (next: PrefabGradient) => void;
}): ReactElement {
  return (
    <div className="ed-particle-module-body">
      <div className="ed-field-label">{label}</div>
      {gradient.map((key, index) => (
        <FieldRow key={index} label={`Key ${index}`}>
          <NumberField
            value={key.t}
            step={0.05}
            onCommit={(t) => {
              const next = gradient.map((k, i) =>
                i === index ? { ...k, t: Math.min(1, Math.max(0, t)) } : k,
              );
              onCommit(next);
            }}
          />
          <ColorField
            value={key.color}
            onCommit={(color) => {
              const next = gradient.map((k, i) => (i === index ? { ...k, color } : k));
              onCommit(next);
            }}
          />
          <NumberField
            value={key.alpha ?? 1}
            step={0.05}
            onCommit={(alpha) => {
              const next = gradient.map((k, i) =>
                i === index
                  ? { ...k, alpha: Math.min(1, Math.max(0, alpha)) }
                  : k,
              );
              onCommit(next);
            }}
          />
          <EdButton
            onClick={() => {
              if (gradient.length <= 1) return;
              onCommit(gradient.filter((_, i) => i !== index));
            }}
          >
            ×
          </EdButton>
        </FieldRow>
      ))}
      <EdButton
        onClick={() =>
          onCommit([
            ...gradient,
            {
              t: 1,
              color: gradient[gradient.length - 1]?.color ?? '#ffffff',
              alpha: 0,
            },
          ])
        }
      >
        Add key
      </EdButton>
    </div>
  );
}

export function ParticleModule({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled?: boolean;
  onToggle?: (next: boolean) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <ModuleBlock title={title} enabled={enabled} onToggle={onToggle}>
      {children}
    </ModuleBlock>
  );
}
