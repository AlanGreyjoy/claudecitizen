import { useEffect, useState, type ReactElement } from 'react';
import { getDesktopEditorBridge } from '../../../../platform/editor-desktop';
import type { CatalogSyncConfig, CatalogSyncState } from '../../../../platform/editor-desktop';
import {
  DeployDialogShell,
  DeployField,
  DeployLog,
  DeployToggle,
} from './DeployDialogParts';

/** Deploy → Sync Catalog…. Pushes local catalog defs to the release backendUrl. */
export function DeploySyncCatalogModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement | null {
  const bridge = getDesktopEditorBridge();
  const [config, setConfig] = useState<CatalogSyncConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [targetEmail, setTargetEmail] = useState('');
  const [targetPassword, setTargetPassword] = useState('');
  const [sourceEmail, setSourceEmail] = useState('');
  const [sourcePassword, setSourcePassword] = useState('');
  const [includeGameSettings, setIncludeGameSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<{ message: string; isError: boolean }>({
    message: '',
    isError: false,
  });

  useEffect(() => {
    if (!open || !bridge) return;
    setLines([]);
    setStatus({ message: '', isError: false });
    setConfigError('');
    setTargetPassword('');
    setSourcePassword('');
    void bridge
      .getCatalogSyncConfig()
      .then((next) => {
        setConfig(next);
        setTargetEmail(next.targetEmail);
        setSourceEmail(next.sourceEmail);
        setIncludeGameSettings(next.includeGameSettings);
      })
      .catch((error: unknown) => {
        setConfig(null);
        setConfigError(
          error instanceof Error ? error.message : 'Could not read catalog sync settings.',
        );
      });
  }, [open, bridge]);

  useEffect(() => {
    if (!open || !bridge) return;
    return bridge.onCatalogSyncState((event: CatalogSyncState) => {
      if (event.phase === 'log' && event.line) {
        setLines((prev) => [...prev, event.line]);
      }
      if (event.phase === 'started') {
        setBusy(true);
        setLines([]);
        setStatus({ message: event.message ?? 'Syncing…', isError: false });
      }
      if (event.phase === 'success' || event.phase === 'error') {
        setBusy(false);
        setStatus({
          message: event.message ?? (event.ok ? 'Done.' : 'Failed.'),
          isError: !event.ok,
        });
        // Refresh has*Password flags after sync persists credentials.
        void bridge.getCatalogSyncConfig().then((next) => {
          setConfig(next);
          setTargetPassword('');
          setSourcePassword('');
        });
      }
    });
  }, [open, bridge]);

  if (!open) return null;

  if (!bridge) {
    return (
      <DeployDialogShell
        title="Sync Catalog"
        copy="Catalog sync runs over the desktop editor and is unavailable in the browser build."
        status={{ message: '', isError: false }}
        onClose={onClose}
        busy={false}
        actions={
          <button type="button" className="ed-btn" onClick={onClose}>
            Close
          </button>
        }
      >
        <p className="ed-deploy-hint">Open this dialog from the Electron editor.</p>
      </DeployDialogShell>
    );
  }

  const urls = config?.urls ?? null;
  const sameUrl = Boolean(urls && urls.sourceUrl === urls.targetUrl);
  const hasTargetPassword = Boolean(config?.hasTargetPassword) || targetPassword.length > 0;
  const canSync =
    Boolean(urls) &&
    !sameUrl &&
    !busy &&
    targetEmail.trim().length > 0 &&
    hasTargetPassword;

  const runSync = async (): Promise<void> => {
    setBusy(true);
    setLines([]);
    setStatus({ message: 'Starting…', isError: false });
    try {
      const result = await bridge.syncCatalog({
        targetEmail: targetEmail.trim(),
        targetPassword: targetPassword || undefined,
        sourceEmail: sourceEmail.trim() || undefined,
        sourcePassword: sourcePassword || undefined,
        includeGameSettings,
      });
      setStatus({ message: result.message, isError: !result.ok });
    } catch (error) {
      setStatus({
        message: error instanceof Error ? error.message : 'Catalog sync failed.',
        isError: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DeployDialogShell
      title="Sync Catalog"
      copy="Export ships, props, items, weapons, and commerce metadata from the editor backend, then upsert them into the release backend. Does not sync players, inventory, or Stripe secrets."
      status={status}
      onClose={onClose}
      busy={busy}
      actions={
        <>
          <button type="button" className="ed-btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="ed-btn ed-btn-primary"
            disabled={!canSync}
            onClick={() => void runSync()}
          >
            {busy ? 'Syncing…' : 'Sync Catalog'}
          </button>
        </>
      }
    >
      {configError ? <p className="ed-deploy-hint is-warning">{configError}</p> : null}

      {urls ? (
        <div className="ed-deploy-form">
          <div className="ed-deploy-field ed-deploy-span-2">
            <span className="ed-deploy-field-label">Source (editorBackendUrl)</span>
            <span className="ed-deploy-url-value">{urls.sourceUrl}</span>
            <span className="ed-deploy-field-detail">
              Local Server Console catalog. Leave source admin blank to reuse a Server-tab session.
            </span>
          </div>
          <div className="ed-deploy-field ed-deploy-span-2">
            <span className="ed-deploy-field-label">Target (backendUrl)</span>
            <span className="ed-deploy-url-value">{urls.targetUrl}</span>
            <span className="ed-deploy-field-detail">Release / prod API that receives the upsert.</span>
          </div>

          {sameUrl ? (
            <p className="ed-deploy-hint is-warning" style={{ gridColumn: '1 / -1' }}>
              Source and target are the same URL. Set a distinct backendUrl in Project Settings
              before syncing.
            </p>
          ) : null}

          <DeployField
            label="Source admin email (optional)"
            value={sourceEmail}
            onChange={setSourceEmail}
            span={2}
          />
          <DeployField
            label="Target admin email"
            value={targetEmail}
            onChange={setTargetEmail}
            span={2}
          />
          <DeployField
            label="Source admin password"
            value={sourcePassword}
            onChange={setSourcePassword}
            type="password"
            span={2}
            placeholder={config?.hasSourcePassword ? '•••••••• (stored)' : 'optional'}
            detail="Kept in ~/.asteron/catalog-sync.json at mode 0600 — never in the project."
          />
          <DeployField
            label="Target admin password"
            value={targetPassword}
            onChange={setTargetPassword}
            type="password"
            span={2}
            placeholder={config?.hasTargetPassword ? '•••••••• (stored)' : 'required'}
            detail="Leave blank to keep the stored password. Saved when you sync."
          />
          <DeployToggle
            label="Include game settings"
            checked={includeGameSettings}
            onChange={setIncludeGameSettings}
            detail="Off by default — avoids overwriting prod starter ARC / starter ship and item ids."
          />
        </div>
      ) : !configError ? (
        <p className="ed-deploy-hint">Loading catalog sync settings…</p>
      ) : null}

      <DeployLog lines={lines} />
    </DeployDialogShell>
  );
}
