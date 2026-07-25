import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

export function SystemField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <label className="ed-system-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function stopKeyPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

export function SystemTextField({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}): ReactElement {
  return (
    <SystemField label={label}>
      <input
        className="ed-input"
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={readOnly ? undefined : (event) => onChange?.(event.currentTarget.value)}
        onKeyDown={stopKeyPropagation}
      />
    </SystemField>
  );
}

export function SystemNumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}): ReactElement {
  return (
    <SystemField label={label}>
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
    </SystemField>
  );
}

export function SystemSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <SystemField label={label}>
      <select
        className="ed-input"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={stopKeyPropagation}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </SystemField>
  );
}

export function SystemSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="ed-system-section">
      <h3 className="ed-base-subtitle">{title}</h3>
      {children}
    </section>
  );
}

export function SystemListRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={`ed-system-list-row${selected ? ' is-selected' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function SystemEmpty({ children }: { children: ReactNode }): ReactElement {
  return <div className="ed-system-empty">{children}</div>;
}
