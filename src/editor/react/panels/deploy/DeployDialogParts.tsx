import { useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DeployStateHandle } from './use-deploy-state';

/** The editor binds global shortcuts (W/E/R, Delete, Ctrl+Z); dialogs must not leak keys. */
export function stopKeyPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
  detail?: string;
  /** Columns to occupy in the dialog's 4-column form grid. */
  span?: 1 | 2 | 3 | 4;
};

/**
 * Label stacked above a full-width input.
 *
 * Deliberately not the `.ed-scene-settings-field` layout the other modals use —
 * that is a `140px | 1fr` grid built for one field per row, and tiling it gives
 * every field a fat label and a squeezed input.
 */
export function DeployField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  detail,
  span = 2,
}: FieldProps): ReactElement {
  return (
    <label className={`ed-deploy-field ed-deploy-span-${span}`}>
      <span className="ed-deploy-field-label">{label}</span>
      <input
        className="ed-input"
        type={type}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={stopKeyPropagation}
      />
      {detail ? <span className="ed-deploy-field-detail">{detail}</span> : null}
    </label>
  );
}

/** Terminal-style output, pinned to the bottom as lines stream in. */
export function DeployLog({ lines }: { lines: string[] }): ReactElement {
  const scrollRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <pre className="ed-deploy-log" ref={scrollRef}>
      {lines.length > 0 ? lines.join('\n') : 'No output yet.'}
    </pre>
  );
}

export function DeployProgress({ run }: { run: DeployStateHandle['run'] }): ReactElement | null {
  if (run.steps.length === 0) return null;
  return (
    <ol className="ed-deploy-progress">
      {run.steps.map((label, index) => {
        const failed = run.failedStep === index;
        const done = !failed && index < run.stepIndex;
        const current = !failed && index === run.stepIndex && run.running;
        const status = failed ? 'is-failed' : done ? 'is-done' : current ? 'is-active' : '';
        return (
          <li key={label} className={`ed-deploy-progress-item ${status}`}>
            <span className="ed-deploy-progress-marker" aria-hidden="true" />
            {label}
          </li>
        );
      })}
    </ol>
  );
}

type DialogShellProps = {
  title: string;
  copy: string;
  status: DeployStateHandle['status'];
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
  actions: ReactNode;
};

/**
 * Shared chrome for both deploy dialogs. Closing is blocked while a deploy is
 * in flight — a backdrop click mid-`docker compose build` would orphan the log
 * with no way back to it.
 */
export function DeployDialogShell({
  title,
  copy,
  status,
  onClose,
  busy,
  children,
  actions,
}: DialogShellProps): ReactElement {
  return createPortal(
    <div
      className="ed-dialog-overlay is-visible"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="ed-dialog ed-deploy-dialog" role="dialog" aria-modal="true">
        <div className="ed-scene-settings-heading">{title}</div>
        <p className="ed-scene-settings-copy">{copy}</p>
        {status.message ? (
          <div className={`ed-system-status${status.isError ? ' is-error' : ''}`}>
            {status.message}
          </div>
        ) : null}
        <div className="ed-deploy-dialog-body">{children}</div>
        <div className="ed-base-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
