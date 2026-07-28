import { useEffect, useRef, type ReactElement } from 'react';
import {
  clampMaterialNumber,
  formatMaterialNumber,
} from '../../panels/material-manager';

/**
 * Uncontrolled number box that re-syncs from props whenever it is not the
 * focused element — lets a slider drag update the readout 60×/s without
 * remounting the input or stealing a half-typed value.
 */
function NumberBox({
  value,
  max,
  onCommit,
}: {
  value: number;
  max: number;
  onCommit: (next: number) => void;
}): ReactElement {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input || document.activeElement === input) return;
    input.value = formatMaterialNumber(value);
  }, [value]);

  return (
    <input
      ref={ref}
      className="ed-input ed-material-number"
      type="number"
      min={0}
      max={max}
      step={0.01}
      defaultValue={formatMaterialNumber(value)}
      onBlur={(event) =>
        onCommit(clampMaterialNumber(Number(event.currentTarget.value), 0, max))
      }
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

/**
 * Slider + numeric readout. `onScrub` fires per frame while dragging (live
 * preview only), `onCommit` fires once on release so undo history gets one
 * entry per edit instead of one per pixel.
 */
export function MaterialSliderRow({
  label,
  value,
  max,
  step = 0.01,
  onScrub,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  step?: number;
  onScrub: (next: number) => void;
  onCommit: (next: number) => void;
}): ReactElement {
  const latest = useRef(value);
  latest.current = value;
  const commit = (): void => onCommit(latest.current);

  return (
    <div className="ed-material-field">
      <span className="ed-material-field-label">{label}</span>
      <input
        className="ed-material-slider"
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onScrub(Number(event.currentTarget.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <NumberBox value={value} max={max} onCommit={onCommit} />
    </div>
  );
}

/**
 * Colour swatch with hex entry. The OS picker streams `input` events while the
 * user drags inside it (live preview) and one `change` when it closes (commit).
 */
export function MaterialColorRow({
  label,
  value,
  onScrub,
  onCommit,
}: {
  label: string;
  value: string;
  onScrub: (next: string) => void;
  onCommit: (next: string) => void;
}): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const onNativeChange = (): void => onCommitRef.current(input.value);
    input.addEventListener('change', onNativeChange);
    return () => input.removeEventListener('change', onNativeChange);
  }, []);

  return (
    <div className="ed-material-field">
      <span className="ed-material-field-label">{label}</span>
      <input
        ref={ref}
        className="ed-material-color"
        type="color"
        value={value}
        onInput={(event) => onScrub(event.currentTarget.value)}
        onChange={(event) => onScrub(event.currentTarget.value)}
      />
      <input
        className="ed-input ed-material-hex"
        type="text"
        spellCheck={false}
        key={value}
        defaultValue={value}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(next)) onCommit(next.toLowerCase());
          else event.currentTarget.value = value;
        }}
      />
    </div>
  );
}
