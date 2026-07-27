import { useState, type FormEvent, type ReactElement } from 'react';
import { AdminAuthError, adminLogin, adminLogout } from '../../../../net/admin-api';
import { useServerConsole } from './ServerConsoleContext';
import { AdminButton, AdminField, AdminMessage } from './Components';
import { isTabActive } from './utils';

export function LoginPanel(): ReactElement {
  const { setSession, navigate } = useServerConsole();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = new FormData(form).get('email');
    const password = new FormData(form).get('password');
    if (typeof email !== 'string' || typeof password !== 'string') return;

    setSubmitting(true);
    setMessage('Authenticating...');
    adminLogin(email.trim(), password)
      .then((nextSession) => {
        setSession(nextSession);
        navigate({ scene: 'users' });
      })
      .catch((error) => {
        const messageText =
          error instanceof AdminAuthError || error instanceof Error
            ? error.message
            : 'Login failed.';
        setMessage(messageText);
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <div className="sc-admin-login-wrap">
      <div className="sc-admin-login">
        <form className="sc-admin-form" onSubmit={handleSubmit}>
          <div className="sc-admin-login-brand">ClaudeCitizen</div>
          <div className="sc-admin-login-eyebrow">Restricted Access</div>
          <h1>Operator Login</h1>
          <p className="sc-admin-login-tag">
            Authenticate to manage catalog and player intelligence.
          </p>
          <AdminField label="Email">
            <input
              className="sc-admin-input"
              name="email"
              type="email"
              defaultValue="admin@claude-citizen.com"
              placeholder="admin@claude-citizen.com"
              required
              autoComplete="username"
            />
          </AdminField>
          <AdminField label="Password">
            <input
              className="sc-admin-input"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </AdminField>
          <AdminButton type="submit" disabled={submitting}>
            Authorize
          </AdminButton>
          <AdminMessage message={message} isError={message !== '' && message !== 'Authenticating...'} />
        </form>
      </div>
    </div>
  );
}

export function Sidebar(): ReactElement {
  const { session, currentTab, currentScene, navigate, setSession, setStatus } = useServerConsole();

  if (!session) return <></>;

  const sections: Array<{ heading: string; tabs: Array<{ id: typeof currentTab; label: string }> }> =
    [
      {
        heading: 'Intelligence',
        tabs: [{ id: 'users', label: 'Users' }],
      },
      {
        heading: 'Catalog',
        tabs: [
          { id: 'ships', label: 'Ships' },
          { id: 'props', label: 'Props' },
          { id: 'items', label: 'Items' },
          { id: 'weapons', label: 'Weapons' },
          { id: 'backpacks', label: 'Backpacks' },
          { id: 'wearables', label: 'Wearables' },
        ],
      },
      {
        heading: 'Commerce',
        tabs: [
          { id: 'payments', label: 'Payments' },
          { id: 'credit-packs', label: 'Credit Packs' },
          { id: 'mall', label: 'Item Mall' },
          { id: 'purchases', label: 'Purchases' },
        ],
      },
      {
        heading: 'Systems',
        tabs: [{ id: 'settings', label: 'Game Settings' }],
      },
    ];

  const goToTab = (tab: typeof currentTab): void => {
    navigate({ scene: tab });
  };

  const handleLogout = (): void => {
    setStatus('Signing out...');
    adminLogout()
      .catch(() => undefined)
      .finally(() => {
        setSession(null);
        navigate({ scene: 'login' });
      });
  };

  return (
    <aside className="sc-admin-sidebar">
      <div className="sc-admin-sidebar-brand">
        <div className="sc-admin-sidebar-brand-mark" aria-hidden="true" />
        <div className="sc-admin-sidebar-brand-text">
          <div className="sc-admin-sidebar-brand-title">ClaudeCitizen</div>
          <div className="sc-admin-sidebar-subtitle">Operator Console</div>
        </div>
      </div>
      <nav className="sc-admin-sidebar-nav" aria-label="Admin sections">
        {sections.map((section) => (
          <div key={section.heading}>
            <div className="sc-admin-sidebar-section">{section.heading}</div>
            {section.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`sc-admin-sidebar-link${
                  isTabActive(tab.id, currentTab, currentScene) ? ' is-active' : ''
                }`}
                onClick={() => goToTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sc-admin-sidebar-footer">
        <div className="sc-admin-sidebar-session">{session.email}</div>
        <AdminButton variant="secondary" type="button" onClick={handleLogout}>
          Log out
        </AdminButton>
      </div>
    </aside>
  );
}

export function ServerLayout({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <div className="sc-admin-layout">
      <Sidebar />
      <main className="sc-admin-main">
        <div className="sc-admin-content">{children}</div>
      </main>
    </div>
  );
}
