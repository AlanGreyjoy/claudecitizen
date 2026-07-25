import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

type AdminButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  small?: boolean;
};

export function AdminButton({
  variant = 'primary',
  small = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: AdminButtonProps): ReactElement {
  const classes = [
    'sc-admin-btn',
    variant === 'secondary' ? 'sc-admin-btn-secondary' : '',
    small ? 'sc-admin-btn-small' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

export function AdminField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <label className="sc-admin-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function AdminCard({ children }: { children: ReactNode }): ReactElement {
  return <div className="sc-admin-card">{children}</div>;
}

export function AdminToolbar({ children }: { children: ReactNode }): ReactElement {
  return <div className="sc-admin-toolbar">{children}</div>;
}

export function AdminMessage({
  message,
  isError = false,
  status = false,
}: {
  message: string;
  isError?: boolean;
  status?: boolean;
}): ReactElement {
  return (
    <p
      className={`sc-admin-message${isError ? ' is-error' : ''}`}
      {...(status ? { 'data-admin-status': 'true' } : {})}
    >
      {message}
    </p>
  );
}

export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): ReactElement {
  return (
    <header className="sc-admin-page-header">
      <div className="sc-admin-page-header-text">
        <div className="sc-admin-page-eyebrow">Operator Console</div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="sc-admin-page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function AdminSearch({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <input
      type="search"
      className="sc-admin-search"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

export function TruncatedCell({
  text,
  maxLen = 24,
  mono = false,
}: {
  text: string;
  maxLen?: number;
  mono?: boolean;
}): ReactElement {
  const truncated = text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
  return (
    <td
      className={mono ? 'sc-admin-cell-truncate sc-admin-cell-mono' : 'sc-admin-cell-truncate'}
      title={text.length > maxLen ? text : undefined}
    >
      {truncated}
    </td>
  );
}

export function DetailItem({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}): ReactElement {
  const display =
    truncate && value.length > 36 ? `${value.slice(0, 35)}…` : value;
  return (
    <div className="sc-admin-detail-item">
      <dt>{label}</dt>
      <dd
        className={truncate ? 'sc-admin-cell-mono' : undefined}
        title={truncate && value.length > 36 ? value : undefined}
      >
        {display}
      </dd>
    </div>
  );
}
