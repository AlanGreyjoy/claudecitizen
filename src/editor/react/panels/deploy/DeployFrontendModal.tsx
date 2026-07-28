import { useEffect, useState, type ReactElement } from 'react';
import { fetchProjectSettings, type ProjectSettingsDocument } from '../../../api';
import { DeployDialogShell, DeployField, DeployLog, DeployProgress } from './DeployDialogParts';
import { useDeployState } from './use-deploy-state';

/**
 * What the release will be stamped with. `backendUrl` is the value most likely
 * to be wrong: an HTTPS page cannot call an HTTP API, and the browser blocks it
 * as mixed content with no in-game error, so a plain `http://` is called out.
 */
function ReleaseSummary({ settings }: { settings: ProjectSettingsDocument | null }): ReactElement {
  if (!settings) return <p className="ed-deploy-hint">Reading project settings…</p>;
  const insecureBackend = !settings.backendUrl.startsWith('https://');
  return (
    <dl className="ed-deploy-summary">
      <div>
        <dt>Project</dt>
        <dd>{settings.name}</dd>
      </div>
      <div>
        <dt>Release Backend URL</dt>
        <dd className={insecureBackend ? 'is-warning' : undefined}>
          {settings.backendUrl || '—'}
          {insecureBackend ? ' — not HTTPS; the browser will block this as mixed content.' : ''}
        </dd>
      </div>
      <div>
        <dt>Boot scene</dt>
        <dd>{settings.defaultScene}</dd>
      </div>
      <div>
        <dt>Output</dt>
        <dd>{settings.build.outDir}</dd>
      </div>
    </dl>
  );
}

/** Deploy → Front End…. Builds the web release and publishes it to Netlify. */
export function DeployFrontendModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement | null {
  const state = useDeployState(open);
  const [settings, setSettings] = useState<ProjectSettingsDocument | null>(null);

  useEffect(() => {
    if (!open) {
      setSettings(null);
      return;
    }
    let cancelled = false;
    void fetchProjectSettings()
      .then((document) => {
        if (!cancelled) setSettings(document);
      })
      .catch(() => {
        // Summary is context, not a gate — the build reads these values itself.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  if (!state.bridgeAvailable) {
    return (
      <DeployDialogShell
        title="Deploy Front End"
        copy="Publishing runs from the desktop editor and is unavailable in the browser build."
        status={{ message: '', isError: false }}
        onClose={onClose}
        busy={false}
        actions={
          <button type="button" className="ed-btn" onClick={onClose}>
            Close
          </button>
        }
      >
        <span />
      </DeployDialogShell>
    );
  }

  const { config, dirty, run, save, deploy, cancel, patch } = state;
  const busy = run.running;

  return (
    <DeployDialogShell
      title="Deploy Front End"
      copy="Builds the web release from this project and publishes it to Netlify as production."
      status={state.status}
      onClose={onClose}
      busy={busy}
      actions={
        <>
          <button
            type="button"
            className="ed-btn ed-btn-accent"
            disabled={busy || dirty}
            title={dirty ? 'Save settings first.' : undefined}
            onClick={() => void deploy('client')}
          >
            {busy ? 'Deploying…' : 'Build & Deploy'}
          </button>
          <button type="button" className="ed-btn" disabled={!dirty} onClick={() => void save()}>
            {dirty ? 'Save' : 'Saved'}
          </button>
          <button type="button" className="ed-btn" onClick={busy ? cancel : onClose}>
            {busy ? 'Cancel' : 'Close'}
          </button>
        </>
      }
    >
      {state.loading ? (
        <p className="ed-deploy-hint">Loading deploy settings…</p>
      ) : (
        <>
          <ReleaseSummary settings={settings} />
          <div className="ed-deploy-form">
            <DeployField
              label="Netlify site"
              span={4}
              value={config?.netlifySite ?? ''}
              placeholder="asteron-play"
              onChange={(netlifySite) => patch({ netlifySite })}
              detail="Blank uses whichever site is linked in the project folder."
            />
          </div>
          <p className="ed-deploy-hint">
            Runs <code>build:project-web</code>, then <code>netlify deploy --prod --no-build</code>.
            Without <code>--no-build</code> the CLI finds <code>docs/netlify.toml</code> and uploads
            the documentation site instead.
          </p>
          <DeployProgress run={run} />
          <DeployLog lines={state.log} />
        </>
      )}
    </DeployDialogShell>
  );
}
