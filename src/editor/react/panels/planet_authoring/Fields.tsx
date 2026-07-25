import {
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ASSET_DND_TYPE } from '../../../api';
import { UiIcons } from '../../../../ui/icons';
import { UiIcon } from '../../UiIcon';

export function PlanetField({
  label,
  wide = false,
  check = false,
  children,
}: {
  label: string;
  wide?: boolean;
  check?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <label
      className={`ed-planet-field${wide ? ' ed-planet-field-wide' : ''}${
        check ? ' ed-planet-field-check' : ''
      }`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function stopKeyPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

export function PlanetTextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): ReactElement {
  return (
    <PlanetField label={label}>
      <input
        className="ed-input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={stopKeyPropagation}
      />
    </PlanetField>
  );
}

export function PlanetNumberField({
  label,
  value,
  onChange,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}): ReactElement {
  return (
    <PlanetField label={label}>
      <input
        className="ed-input"
        type="number"
        step={String(step)}
        value={String(value)}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        onKeyDown={stopKeyPropagation}
      />
    </PlanetField>
  );
}

export function PlanetColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <PlanetField label={label}>
      <input
        className="ed-input ed-planet-color"
        type="color"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={stopKeyPropagation}
      />
    </PlanetField>
  );
}

export function PlanetCheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}): ReactElement {
  return (
    <PlanetField label={label} check>
      <input
        className="ed-planet-checkbox"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        onKeyDown={stopKeyPropagation}
      />
    </PlanetField>
  );
}

function useAssetDrop(accepts: (url: string) => boolean, onChange: (url: string) => void) {
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
    if (url?.startsWith('/') && accepts(url)) onChange(url);
  };
  return { isDropTarget, onDragOver, onDragLeave, onDrop };
}

export function PlanetDropAssetField({
  label,
  value,
  placeholder,
  accept,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  accept: (url: string) => boolean;
  onChange: (value: string) => void;
}): ReactElement {
  const drop = useAssetDrop(accept, onChange);
  return (
    <PlanetField label={label} wide>
      <input
        className={`ed-input ed-planet-drop-input${drop.isDropTarget ? ' is-drop-target' : ''}`}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value.trim())}
        onKeyDown={stopKeyPropagation}
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={drop.onDrop}
      />
    </PlanetField>
  );
}

export function PlanetSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <section className={`ed-planet-section${expanded ? '' : ' is-collapsed'}`}>
      <h3
        className="ed-planet-section-title ed-section-title-toggle"
        title={expanded ? `Collapse ${title}` : `Expand ${title}`}
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onToggle();
        }}
      >
        <span>{title}</span>
        <span className="ed-section-caret">
          <UiIcon
            icon={expanded ? UiIcons.chevronDown : UiIcons.chevronRight}
            className="ed-ui-icon"
            size={14}
          />
        </span>
      </h3>
      {expanded ? <div className="ed-planet-section-body">{children}</div> : null}
    </section>
  );
}
