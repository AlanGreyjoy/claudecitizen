import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ASSET_DND_TYPE, ENTITY_DND_TYPE } from '../../api';
import {
  findEntityById,
  formatInspectorNumber,
  isAudioAssetUrl,
  isImageAssetUrl,
  isModelAssetUrl,
  parseDraggedEntityIds,
} from '../../panels/inspector-logic';
import {
  GLB_NODE_DND_TYPE,
  parseDraggedGlbNode,
} from '../../panels/hierarchy-logic';
import type { EditorStore } from '../../document';
import { UiIcons } from '../../../ui/icons';
import { UiIcon } from '../UiIcon';

export function TextField({
  value,
  onCommit,
  readOnly = false,
  placeholder,
  title,
  className,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  value: string;
  onCommit?: (next: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  title?: string;
  className?: string;
  onDragOver?: (event: DragEvent<HTMLInputElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLInputElement>) => void;
  onDrop?: (event: DragEvent<HTMLInputElement>) => void;
}): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const input = ref.current;
    if (!input || document.activeElement === input) return;
    if (input.value !== value) input.value = value;
  }, [value]);

  useEffect(() => {
    const input = ref.current;
    if (!input || readOnly || !onCommitRef.current) return;
    const onNativeChange = () => onCommitRef.current?.(input.value);
    const onKeyDown = (event: KeyboardEvent) => event.stopPropagation();
    input.addEventListener('change', onNativeChange);
    input.addEventListener('keydown', onKeyDown);
    return () => {
      input.removeEventListener('change', onNativeChange);
      input.removeEventListener('keydown', onKeyDown);
    };
  }, [readOnly]);

  return (
    <input
      ref={ref}
      className={className ?? 'ed-input'}
      type="text"
      readOnly={readOnly}
      placeholder={placeholder}
      title={title}
      defaultValue={value}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    />
  );
}

export type ColorSwatch = {
  label: string;
  color: string;
};

/** Authored light looks — warm practicals through sci-fi accents. */
export const LIGHT_COLOR_SWATCHES: readonly ColorSwatch[] = [
  { label: 'Daylight', color: '#ffffff' },
  { label: 'Cool', color: '#a8c8ff' },
  { label: 'Warm', color: '#ffb36b' },
  { label: 'Candle', color: '#ff8c42' },
  { label: 'Moonlight', color: '#8ea8ff' },
  { label: 'Overcast', color: '#c8d4e8' },
  { label: 'Sci-Fi Green', color: '#5dff9a' },
  { label: 'Holo Cyan', color: '#4de8ff' },
  { label: 'Neon Magenta', color: '#ff4dc8' },
  { label: 'Amber', color: '#ffc45a' },
  { label: 'Alert Red', color: '#ff4a4a' },
  { label: 'UV Violet', color: '#b48cff' },
];

function normalizeHexColor(value: string): string {
  return value.trim().toLowerCase();
}

export function ColorField({
  value,
  onCommit,
  swatches,
}: {
  value: string;
  onCommit: (next: string) => void;
  swatches?: readonly ColorSwatch[];
}): ReactElement {
  const active = normalizeHexColor(value);
  return (
    <div className="ed-color-field">
      <input
        className="ed-input ed-color-picker"
        type="color"
        value={value}
        onChange={(event) => onCommit(event.currentTarget.value)}
      />
      {swatches && swatches.length > 0 ? (
        <div className="ed-color-swatches" role="list">
          {swatches.map((swatch) => {
            const selected = active === normalizeHexColor(swatch.color);
            return (
              <button
                key={`${swatch.label}:${swatch.color}`}
                type="button"
                role="listitem"
                className={`ed-color-swatch${selected ? ' is-active' : ''}`}
                style={{ background: swatch.color }}
                title={swatch.label}
                aria-label={swatch.label}
                aria-pressed={selected}
                onClick={() => onCommit(swatch.color)}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): ReactElement {
  return (
    <label className="ed-checkbox-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function FieldRow({
  label,
  wide = false,
  className,
  children,
}: {
  label: string;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`${wide ? 'ed-field-row-wide' : 'ed-field-row'}${className ? ` ${className}` : ''}`}
    >
      <span className="ed-field-label">{label}</span>
      {children}
    </div>
  );
}

export function RemoveButton({
  title,
  onClick,
}: {
  title: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className="ed-remove-btn" title={title} onClick={onClick}>
      <UiIcon icon={UiIcons.x} className="ed-ui-icon" size={12} />
    </button>
  );
}

export function EmptyNote({ children }: { children: ReactNode }): ReactElement {
  return <div className="ed-empty-note">{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }): ReactElement {
  return <div className="ed-section-label">{children}</div>;
}

export function Hint({ children }: { children: ReactNode }): ReactElement {
  return <div className="ed-hint">{children}</div>;
}

export function EdButton({
  children,
  title,
  disabled,
  onClick,
}: {
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="ed-btn"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function NumberField({
  value,
  onCommit,
  step = 0.1,
  className,
}: {
  value: number;
  onCommit: (next: number) => void;
  step?: number;
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const display = formatInspectorNumber(value);

  useEffect(() => {
    const input = ref.current;
    if (!input || document.activeElement === input) return;
    if (input.value !== display) input.value = display;
  }, [display]);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const onNativeChange = () => {
      const next = Number(input.value);
      if (Number.isFinite(next)) onCommitRef.current(next);
    };
    const onKeyDown = (event: KeyboardEvent) => event.stopPropagation();
    input.addEventListener('change', onNativeChange);
    input.addEventListener('keydown', onKeyDown);
    return () => {
      input.removeEventListener('change', onNativeChange);
      input.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <input
      ref={ref}
      className={className ?? 'ed-input'}
      type="number"
      step={String(step)}
      defaultValue={display}
    />
  );
}

export function SelectField({
  options,
  value,
  onCommit,
  className,
}: {
  options: readonly string[];
  value: string;
  onCommit: (next: string) => void;
  className?: string;
}): ReactElement {
  return (
    <select
      className={className ?? 'ed-select'}
      value={value}
      onChange={(event) => onCommit(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function useAssetDrop(accepts: (url: string) => boolean, onCommit: (url: string) => void) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const onDragOver = (event: DragEvent<HTMLInputElement>) => {
    event.preventDefault();
    setIsDropTarget(true);
  };
  const onDragLeave = () => setIsDropTarget(false);
  const onDrop = (event: DragEvent<HTMLInputElement>) => {
    event.preventDefault();
    setIsDropTarget(false);
    const url =
      event.dataTransfer?.getData(ASSET_DND_TYPE) ||
      event.dataTransfer?.getData('text/plain');
    if (url?.startsWith('/') && accepts(url)) onCommit(url);
  };
  return { isDropTarget, onDragOver, onDragLeave, onDrop };
}

function TypedAssetUrlField({
  label,
  value,
  onCommit,
  accepts,
}: {
  label: string;
  value: string | undefined;
  onCommit: (next: string | undefined) => void;
  accepts: (url: string) => boolean;
}): ReactElement {
  const drop = useAssetDrop(accepts, (url) => onCommit(url));
  return (
    <FieldRow label={label} wide>
      <div className="ed-field-controls">
        <TextField
          value={value ?? ''}
          onCommit={(next) => onCommit(next.trim() || undefined)}
          className={drop.isDropTarget ? 'ed-input is-drop-target' : 'ed-input'}
          onDragOver={drop.onDragOver}
          onDragLeave={drop.onDragLeave}
          onDrop={drop.onDrop}
        />
        <EdButton title="Remove assigned asset" onClick={() => onCommit(undefined)}>
          Clear
        </EdButton>
      </div>
    </FieldRow>
  );
}

export function AssetUrlField(props: {
  label: string;
  value: string | undefined;
  onCommit: (next: string | undefined) => void;
}): ReactElement {
  return <TypedAssetUrlField {...props} accepts={isAudioAssetUrl} />;
}

export function ImageAssetUrlField(props: {
  label: string;
  value: string | undefined;
  onCommit: (next: string | undefined) => void;
}): ReactElement {
  return <TypedAssetUrlField {...props} accepts={isImageAssetUrl} />;
}

/** GLB/glTF slot fed by dragging a model out of the Project asset browser. */
export function ModelAssetUrlField(props: {
  label: string;
  value: string | undefined;
  onCommit: (next: string | undefined) => void;
}): ReactElement {
  return <TypedAssetUrlField {...props} accepts={isModelAssetUrl} />;
}

export function Vec3NumberRow({
  label,
  values,
  onCommitAxis,
}: {
  label: string;
  values: { x: number; y: number; z: number };
  onCommitAxis: (axis: 'x' | 'y' | 'z', next: number) => void;
}): ReactElement {
  return (
    <FieldRow label={label}>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <NumberField
          key={axis}
          value={values[axis]}
          onCommit={(next) => onCommitAxis(axis, next)}
        />
      ))}
      <span />
    </FieldRow>
  );
}

export function EntityRefField({
  store,
  value,
  onPick,
}: {
  store: EditorStore;
  value: string | undefined;
  onPick: (next: string | undefined) => void;
}): ReactElement {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const matched = value ? findEntityById(store.getState().roots, value) : null;
  const display = matched?.name ?? value ?? '';
  const title = value
    ? matched
      ? `${matched.name} (${value})`
      : `Missing entity: ${value}`
    : 'Drag an entity from the Hierarchy onto this field';

  const onDragOver = (event: DragEvent<HTMLInputElement>) => {
    if (!event.dataTransfer?.types.includes(ENTITY_DND_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDropTarget(true);
  };

  return (
    <div className="ed-field-controls">
      <input
        className={`ed-input${value && !matched ? ' is-missing-ref' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
        type="text"
        readOnly
        value={display}
        placeholder="Drop from Hierarchy"
        title={title}
        onDragOver={onDragOver}
        onDragLeave={() => setIsDropTarget(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDropTarget(false);
          const ids = parseDraggedEntityIds(
            event.dataTransfer?.getData(ENTITY_DND_TYPE) ?? '',
          );
          const nextId = ids[0];
          if (!nextId) return;
          if (!findEntityById(store.getState().roots, nextId)) return;
          onPick(nextId);
        }}
      />
      <EdButton title="Clear entity reference" onClick={() => onPick(undefined)}>
        Clear
      </EdButton>
    </div>
  );
}

/**
 * GLB node name that also accepts a node dragged from the Hierarchy. Typing
 * still works — node names are the binding contract with the GLB, and hunting
 * one down by eye is how they get misspelled.
 *
 * `dropEffect` must be `move`: the hierarchy's GLB rows set
 * `effectAllowed = 'move'`, and a mismatched effect makes the browser refuse
 * the drop with no event at all.
 */
export function GlbNodeRefField({
  store,
  value,
  onCommit,
  placeholder,
}: {
  store: EditorStore;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
}): ReactElement {
  const [isDropTarget, setIsDropTarget] = useState(false);

  return (
    <TextField
      value={value}
      onCommit={onCommit}
      placeholder={placeholder ?? 'Drop a GLB node'}
      title="Type a GLB node name, or drag one from the Hierarchy"
      className={`ed-input${isDropTarget ? ' is-drop-target' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes(GLB_NODE_DND_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setIsDropTarget(true);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(event) => {
        setIsDropTarget(false);
        const dragged = parseDraggedGlbNode(
          event.dataTransfer?.getData(GLB_NODE_DND_TYPE) ?? '',
        );
        if (!dragged) return;
        event.preventDefault();
        event.stopPropagation();
        const name = store.getGlbNodeName(dragged.entityId, dragged.nodeUuid);
        if (name) onCommit(name);
      }}
    />
  );
}

export function ModuleBlock({
  title,
  enabled,
  onToggle,
  defaultOpen = true,
  children,
}: {
  title: string;
  enabled?: boolean;
  onToggle?: (next: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <details className="ed-particle-module" open={enabled !== false && defaultOpen}>
      <summary className="ed-particle-module-title">
        {onToggle ? (
          <input
            type="checkbox"
            checked={Boolean(enabled)}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              onToggle(event.currentTarget.checked);
            }}
          />
        ) : null}
        {onToggle ? ` ${title}` : title}
      </summary>
      <div className="ed-particle-module-body">{children}</div>
    </details>
  );
}

export function DoorNodeRow({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <div className="ed-door-node-row">{children}</div>;
}
