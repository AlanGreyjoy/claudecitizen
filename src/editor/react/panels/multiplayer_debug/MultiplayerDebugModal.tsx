import { useMemo, useState, type ReactElement } from 'react';
import { DeployDialogShell, DeployLog, stopKeyPropagation } from '../deploy/DeployDialogParts';
import { MultiplayerDebugForm } from './MultiplayerDebugForm';
import { MultiplayerDebugHealthStrip } from './MultiplayerDebugHealth';
import { useMultiplayerDebugState } from './use-multiplayer-debug-state';

const COPY =
  'Launches one game window per instance, each signed in as its own debug account and '
  + 'dropped into the same shared cell, so replication can be watched side by side.';

function UnavailableDialog({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <DeployDialogShell
      title="Multiplayer Debug"
      copy="Launching test instances needs the desktop editor and is unavailable in the browser build."
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

/** Debug → Multiplayer…. Local multiplayer smoke test harness. */
export function MultiplayerDebugModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement | null {
  const state = useMultiplayerDebugState(open);
  const [filter, setFilter] = useState(0);

  const lines = useMemo(
    () => state.log.filter((line) => filter === 0 || line.instance === filter).map((line) => line.text),
    [state.log, filter],
  );

  if (!open) return null;
  if (!state.bridgeAvailable) return <UnavailableDialog onClose={onClose} />;

  const { health, options, running, busy } = state;
  const backendDown = health !== null && !health.ok;
  const launchBlocked = busy || running || health === null || backendDown;

  return (
    <DeployDialogShell
      title="Multiplayer Debug"
      copy={COPY}
      status={
        backendDown
          ? {
              message:
                `Backend unreachable at ${health.backendBase}. `
                + 'Start it with `npm run dev:infra` then `npm run dev:server`.',
              isError: true,
            }
          : state.status
      }
      onClose={onClose}
      busy={false}
      actions={
        <>
          <button
            type="button"
            className="ed-btn ed-btn-accent"
            disabled={launchBlocked}
            onClick={() => void state.launch()}
          >
            {running ? 'Running…' : `Launch ${options.instances}`}
          </button>
          <button
            type="button"
            className="ed-btn"
            disabled={!running || busy}
            onClick={() => void state.stop()}
          >
            Stop All
          </button>
          <button type="button" className="ed-btn" onClick={state.clearLog}>
            Clear Log
          </button>
          <button type="button" className="ed-btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <MultiplayerDebugHealthStrip
        health={health}
        checking={state.checkingHealth}
        onRecheck={() => void state.checkHealth()}
      />
      <MultiplayerDebugForm options={options} patch={state.patch} disabled={running} />
      <div className="ed-mp-debug-log-header">
        <span className="ed-deploy-field-label">Instance logs</span>
        <select
          className="ed-input ed-mp-debug-filter"
          value={String(filter)}
          onChange={(event) => setFilter(Number(event.target.value))}
          onKeyDown={stopKeyPropagation}
        >
          <option value="0">All instances</option>
          {Array.from({ length: options.instances }, (_unused, index) => index + 1).map((index) => (
            <option key={index} value={String(index)}>
              {options.accountPrefix}
              {index}
            </option>
          ))}
        </select>
      </div>
      <DeployLog lines={lines} />
      <p className="ed-deploy-hint">
        Windows keep running while this dialog is closed. They are destroyed when you press Stop
        All, close the editor, or return to the projects hub.
      </p>
    </DeployDialogShell>
  );
}
