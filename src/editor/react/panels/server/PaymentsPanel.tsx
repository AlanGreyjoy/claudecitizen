import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { PaymentConfig, PaymentSecretSource } from '../../../../net/admin-api';
import { AdminAuthError, getPaymentConfig, updatePaymentConfig } from './server-console-api';
import { useServerConsole } from './ServerConsoleContext';
import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminMessage,
  AdminPageHeader,
} from './Components';

function sourceLabel(source: PaymentSecretSource): string {
  if (source === 'environment') return 'set by environment variable';
  if (source === 'console') return 'stored by this console';
  return 'not configured';
}

/**
 * Read-only banner explaining what still blocks live payments. Downstream engine users hit this
 * panel with no Stripe knowledge, so the panel has to say what to do next rather than just fail.
 */
function SetupChecklist({ config }: { config: PaymentConfig }): ReactElement {
  const steps: Array<{ done: boolean; text: string }> = [
    {
      done: config.encryptionConfigured,
      text: 'Set PAYMENTS_ENCRYPTION_KEY on the server (openssl rand -base64 32), then restart it.',
    },
    {
      done: config.secretKeyConfigured,
      text: 'Paste your Stripe secret key below. Use a test key (sk_test_…) until you go live.',
    },
    {
      done: config.webhookSecretConfigured,
      text: 'Register the webhook URL in Stripe, then paste the signing secret (whsec_…) below.',
    },
  ];
  return (
    <AdminCard>
      <h2 className="sc-admin-section-title">Setup</h2>
      <ol className="sc-admin-checklist">
        {steps.map((step) => (
          <li key={step.text} className={step.done ? 'is-done' : undefined}>
            <span aria-hidden="true">{step.done ? '✓' : '○'}</span> {step.text}
          </li>
        ))}
      </ol>
      <p className="sc-admin-hint">
        Credits are granted only when Stripe calls the webhook, so a missing webhook secret means
        players are charged but never paid out. Configure it before taking real money.
      </p>
    </AdminCard>
  );
}

function WebhookEndpoint({ url }: { url: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <AdminCard>
      <h2 className="sc-admin-section-title">Webhook endpoint</h2>
      <p className="sc-admin-hint">
        Add this URL in the Stripe dashboard under Developers → Webhooks, subscribed to{' '}
        <code>checkout.session.completed</code>, <code>checkout.session.expired</code>,{' '}
        <code>charge.refunded</code>, and <code>charge.dispute.created</code>.
      </p>
      <div className="sc-admin-copy-row">
        <input className="sc-admin-input sc-admin-cell-mono" readOnly value={url} />
        <AdminButton variant="secondary" type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </AdminButton>
      </div>
      <p className="sc-admin-hint">
        Testing locally? Run{' '}
        <code>stripe listen --forward-to localhost:3000/payments/stripe/webhook</code> and paste
        the <code>whsec_</code> value it prints.
      </p>
    </AdminCard>
  );
}

export function PaymentsPanel(): ReactElement {
  const { onAuthError, setStatus } = useServerConsole();
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getPaymentConfig()
      .then(setConfig)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load payment settings.');
      });
  }, [onAuthError]);

  useEffect(() => {
    setConfig(null);
    setError(null);
    load();
  }, [load]);

  if (error) {
    return (
      <>
        <AdminPageHeader title="Payments" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  if (!config) return <AdminMessage message="Loading payment settings..." status />;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const secretKey = String(form.get('secretKey') ?? '').trim();
    const webhookSecret = String(form.get('webhookSecret') ?? '').trim();
    setStatus('Saving payment settings...');
    // Empty secret fields mean "leave what is stored alone", so the console never has to hold
    // a live key in order to edit an unrelated field.
    updatePaymentConfig({
      mode: String(form.get('mode') ?? 'test') === 'live' ? 'live' : 'test',
      successUrl: String(form.get('successUrl') ?? '').trim(),
      cancelUrl: String(form.get('cancelUrl') ?? '').trim(),
      ...(secretKey ? { secretKey } : {}),
      ...(webhookSecret ? { webhookSecret } : {}),
    })
      .then((saved) => {
        setConfig(saved);
        setStatus('Payment settings saved.');
        event.currentTarget?.reset?.();
      })
      .catch((err) => {
        setStatus(err instanceof Error ? err.message : 'Save failed.', true);
      });
  };

  const envLocked = config.secretKeySource === 'environment';

  return (
    <>
      <AdminPageHeader
        title="Payments"
        subtitle={`Stripe · ${config.mode} mode · checkout ${
          config.checkoutEnabled ? 'enabled' : 'disabled'
        }`}
      />
      <SetupChecklist config={config} />
      <WebhookEndpoint url={config.webhookUrl} />
      <AdminCard>
        <h2 className="sc-admin-section-title">Stripe credentials</h2>
        {!config.encryptionConfigured ? (
          <AdminMessage
            message="PAYMENTS_ENCRYPTION_KEY is not set on the server, so secrets cannot be stored here. Set it and restart, or supply STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET as environment variables instead."
            isError
          />
        ) : null}
        {envLocked ? (
          <AdminMessage message="Stripe secrets are supplied by environment variables, which take priority. Values entered here are stored but will stay inactive until those variables are removed." />
        ) : null}
        <form className="sc-admin-form sc-admin-form-wide" onSubmit={handleSubmit}>
          <AdminField label="Mode">
            <select className="sc-admin-select" name="mode" defaultValue={config.mode}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </AdminField>
          <AdminField
            label={`Secret key — ${sourceLabel(config.secretKeySource)}`}
          >
            <input
              className="sc-admin-input"
              name="secretKey"
              type="password"
              autoComplete="off"
              placeholder={config.secretKeyPreview ?? 'sk_test_…'}
            />
          </AdminField>
          <AdminField
            label={`Webhook signing secret — ${sourceLabel(config.webhookSecretSource)}`}
          >
            <input
              className="sc-admin-input"
              name="webhookSecret"
              type="password"
              autoComplete="off"
              placeholder={config.webhookSecretConfigured ? 'whsec_••••' : 'whsec_…'}
            />
          </AdminField>
          <AdminField label="Success URL (blank uses the client origin)">
            <input
              className="sc-admin-input"
              name="successUrl"
              type="text"
              defaultValue={config.successUrl}
              placeholder="https://your-game.example/?checkout=success"
            />
          </AdminField>
          <AdminField label="Cancel URL (blank uses the client origin)">
            <input
              className="sc-admin-input"
              name="cancelUrl"
              type="text"
              defaultValue={config.cancelUrl}
              placeholder="https://your-game.example/?checkout=cancelled"
            />
          </AdminField>
          <div className="sc-admin-actions">
            <AdminButton type="submit">Save payment settings</AdminButton>
          </div>
          <p className="sc-admin-hint">
            Secret fields are write-only. Leave them blank to keep what is already stored.
          </p>
          <AdminMessage message="" status />
        </form>
      </AdminCard>
    </>
  );
}
