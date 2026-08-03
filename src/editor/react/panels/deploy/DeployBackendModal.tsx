import { useState, type ReactElement } from 'react';
import {
  DeployDialogShell,
  DeployField,
  DeployLog,
  DeployProgress,
  DeployToggle,
  stopKeyPropagation,
} from './DeployDialogParts';
import { useDeployState, type DeployStateHandle } from './use-deploy-state';

/**
 * Local checkout versus the branch the box pulls.
 *
 * The server builds the backend from source and gets that source with `git pull`,
 * so a deploy ships the pushed branch — never the working tree. This banner is
 * the difference between "deployed" and "deployed something else".
 */
function PreflightBanner({ state }: { state: DeployStateHandle }): ReactElement | null {
  const { preflight, refreshPreflight } = state;
  if (!preflight) return null;
  const clean = preflight.warnings.length === 0;
  return (
    <div className={`ed-deploy-preflight${clean ? '' : ' is-warning'}`}>
      <div className="ed-deploy-preflight-head">
        <span>
          Local <code>{preflight.head || '—'}</code>
          {' → '}
          <code>{`${preflight.remote}/${preflight.branch}`}</code>{' '}
          <code>{preflight.remoteHead || '—'}</code>
        </span>
        <button type="button" className="ed-btn ed-btn-small" onClick={() => void refreshPreflight()}>
          Recheck
        </button>
      </div>
      {clean ? (
        <p className="ed-deploy-hint">
          In sync — this deploy ships {preflight.headSubject || 'the current commit'}.
        </p>
      ) : (
        <ul className="ed-deploy-warnings">
          {preflight.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionFields({ state }: { state: DeployStateHandle }): ReactElement | null {
  const { config, password, patch, setPassword } = state;
  if (!config) return null;
  return (
    <div className="ed-deploy-form">
      <DeployField
        label="Host or IP"
        span={3}
        value={config.host}
        placeholder="203.0.113.10"
        onChange={(host) => patch({ host })}
      />
      <DeployField
        label="Port"
        span={1}
        type="number"
        value={String(config.port)}
        onChange={(value) => patch({ port: Number.parseInt(value, 10) || 22 })}
      />
      <DeployField
        label="User"
        span={2}
        value={config.username}
        placeholder="root"
        onChange={(username) => patch({ username })}
      />
      <DeployField
        label={config.privateKeyPath ? 'Key passphrase' : 'Password'}
        span={2}
        type="password"
        value={password ?? ''}
        placeholder={config.hasPassword ? '•••••••• (stored)' : 'not set'}
        onChange={setPassword}
        detail="Kept in ~/.asteron/deploy.json at mode 0600 — never in the project or the repo."
      />
      <DeployField
        label="Private key path"
        span={4}
        value={config.privateKeyPath}
        placeholder="optional — /home/you/.ssh/id_ed25519"
        onChange={(privateKeyPath) => patch({ privateKeyPath })}
        detail="Set this to use key auth instead of a password."
      />
    </div>
  );
}

function RemoteFields({ state }: { state: DeployStateHandle }): ReactElement | null {
  const { config, patch } = state;
  if (!config) return null;
  return (
    <div className="ed-deploy-form">
      <DeployField
        label="Server path"
        span={2}
        value={config.remotePath}
        placeholder="/opt/claudecitizen"
        onChange={(remotePath) => patch({ remotePath })}
      />
      <DeployField
        label="Git remote"
        span={1}
        value={config.gitRemote}
        onChange={(gitRemote) => patch({ gitRemote })}
      />
      <DeployField
        label="Branch"
        span={1}
        value={config.branch}
        onChange={(branch) => patch({ branch })}
      />
      <DeployField
        label="Compose files"
        span={3}
        value={config.composeFiles.join(', ')}
        onChange={(value) =>
          patch({ composeFiles: value.split(',').map((file) => file.trim()).filter(Boolean) })
        }
        detail="Comma separated, in -f order."
      />
      <DeployField
        label="Env file"
        span={1}
        value={config.envFile}
        placeholder="deploy/.env"
        onChange={(envFile) => patch({ envFile })}
        detail="On the server, relative to the server path."
      />
      <DeployToggle
        label="Upload env file before deploying"
        checked={config.envUpload}
        onChange={(envUpload) => patch({ envUpload })}
        detail={
          config.envUpload
            ? 'Copied over SSH at mode 600 each deploy; the previous copy is kept as .bak. Contents never reach the log.'
            : 'Off: the deploy only checks the file exists on the server and stops early if it does not.'
        }
      />
      {config.envUpload ? (
        <DeployField
          label="Local env file"
          span={4}
          value={config.envSourcePath}
          placeholder="blank — this checkout's deploy/.env"
          onChange={(envSourcePath) => patch({ envSourcePath })}
          detail="Leave blank to ship deploy/.env from this checkout. Only the path is stored in ~/.asteron/deploy.json — the secrets stay in the file, on this machine."
        />
      ) : null}
      <DeployField
        label="Health check URL"
        span={4}
        value={config.healthUrl}
        placeholder="https://api.example.com/readyz"
        onChange={(healthUrl) => patch({ healthUrl })}
        detail="Polled once the containers are back up. Leave blank to skip."
      />
    </div>
  );
}

function PipelineFields({ state }: { state: DeployStateHandle }): ReactElement | null {
  const { config, defaultSteps, patch } = state;
  if (!config) return null;

  const update = (index: number, changes: Partial<(typeof config.steps)[number]>): void => {
    patch({ steps: config.steps.map((step, i) => (i === index ? { ...step, ...changes } : step)) });
  };

  return (
    <>
      <p className="ed-deploy-hint">
        Runs in order over one SSH session, stopping at the first non-zero exit.{' '}
        <code>{'{{remotePath}}'}</code>, <code>{'{{branch}}'}</code>, <code>{'{{gitRemote}}'}</code>,{' '}
        <code>{'{{envFile}}'}</code> and <code>{'{{compose}}'}</code> expand from the fields above.
      </p>
      <ol className="ed-deploy-steps">
        {config.steps.map((step, index) => (
          <li key={step.id} className="ed-deploy-step">
            <label className="ed-deploy-step-toggle">
              <input
                type="checkbox"
                checked={step.enabled}
                onChange={(event) => update(index, { enabled: event.target.checked })}
              />
              <input
                className="ed-input ed-deploy-step-label"
                value={step.label}
                spellCheck={false}
                onChange={(event) => update(index, { label: event.target.value })}
                onKeyDown={stopKeyPropagation}
              />
            </label>
            <textarea
              className="ed-input ed-deploy-step-command"
              value={step.command}
              rows={2}
              spellCheck={false}
              onChange={(event) => update(index, { command: event.target.value })}
              onKeyDown={stopKeyPropagation}
            />
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="ed-btn ed-btn-small"
        onClick={() => patch({ steps: defaultSteps.map((step) => ({ ...step })) })}
      >
        Reset pipeline to defaults
      </button>
    </>
  );
}

type Section = 'connection' | 'remote' | 'pipeline';

function SectionTabs({
  section,
  setSection,
}: {
  section: Section;
  setSection: (next: Section) => void;
}): ReactElement {
  const entries: Array<[Section, string]> = [
    ['connection', 'Connection'],
    ['remote', 'Remote'],
    ['pipeline', 'Pipeline'],
  ];
  return (
    <div className="ed-deploy-section-tabs">
      {entries.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`ed-deploy-section-tab${section === id ? ' is-active' : ''}`}
          onClick={() => setSection(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function BackendActions({
  state,
  onClose,
}: {
  state: DeployStateHandle;
  onClose: () => void;
}): ReactElement {
  const { config, dirty, run, save, testConnection, deploy, cancel } = state;
  const busy = run.running;
  const connectable = Boolean(config?.host) && Boolean(config?.hasPassword || config?.privateKeyPath);

  return (
    <>
      <button
        type="button"
        className="ed-btn ed-btn-accent"
        disabled={busy || dirty || !connectable}
        title={dirty ? 'Save settings first.' : undefined}
        onClick={() => void deploy('backend')}
      >
        {busy ? 'Deploying…' : 'Deploy'}
      </button>
      <button type="button" className="ed-btn" disabled={!dirty} onClick={() => void save()}>
        {dirty ? 'Save' : 'Saved'}
      </button>
      <button
        type="button"
        className="ed-btn"
        disabled={busy || !connectable}
        onClick={() => void testConnection()}
      >
        Test connection
      </button>
      <button type="button" className="ed-btn" onClick={busy ? cancel : onClose}>
        {busy ? 'Cancel' : 'Close'}
      </button>
    </>
  );
}

/** Deploy → Backend…. Pulls the branch on the box and rebuilds the Docker stack. */
export function DeployBackendModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement | null {
  const state = useDeployState(open, true);
  const [section, setSection] = useState<Section>('connection');

  if (!open) return null;

  if (!state.bridgeAvailable) {
    return (
      <DeployDialogShell
        title="Deploy Backend"
        copy="Deployment runs over SSH from the desktop editor and is unavailable in the browser build."
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

  const busy = state.run.running;

  return (
    <DeployDialogShell
      title="Deploy Backend"
      copy="Pulls the branch on the server, rebuilds the Docker stack, and health-checks the API."
      status={state.status}
      onClose={onClose}
      busy={busy}
      actions={<BackendActions state={state} onClose={onClose} />}
    >
      {state.loading ? (
        <p className="ed-deploy-hint">Loading deploy settings…</p>
      ) : (
        <>
          <PreflightBanner state={state} />
          <SectionTabs section={section} setSection={setSection} />
          {section === 'connection' ? <ConnectionFields state={state} /> : null}
          {section === 'remote' ? <RemoteFields state={state} /> : null}
          {section === 'pipeline' ? <PipelineFields state={state} /> : null}
          <DeployProgress run={state.run} />
          <DeployLog
            lines={state.log}
            showCopy={!busy && state.status.isError && state.log.length > 0}
          />
        </>
      )}
    </DeployDialogShell>
  );
}
