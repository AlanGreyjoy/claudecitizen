import {
  useEffect,
  useRef,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
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

export function ColorField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}): ReactElement {
  return (
    <input
      className="ed-input"
      type="color"
      value={value}
      onChange={(event) => onCommit(event.currentTarget.value)}
    />
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
