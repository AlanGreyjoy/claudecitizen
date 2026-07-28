import type { ReactElement } from 'react';
import type { MultiplayerDebugHealth, MultiplayerDebugProbe } from '../../../../platform/editor-desktop';

function Pill({ label, probe }: { label: string; probe: MultiplayerDebugProbe }): ReactElement {
  const detail = probe.ok ? String(probe.status) : (probe.error ?? String(probe.status || 'down'));
  return (
    <span className={`ed-mp-debug-pill ${probe.ok ? 'is-ok' : 'is-down'}`} title={detail}>
      <span className="ed-mp-debug-pill-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Backend reachability, shown rather than assumed: the whole harness is
 * meaningless without Postgres, Redis and the Rust server, and a failure there
 * otherwise surfaces as N windows silently falling back to local simulation.
 */
export function MultiplayerDebugHealthStrip({
  health,
  checking,
  onRecheck,
}: {
  health: MultiplayerDebugHealth | null;
  checking: boolean;
  onRecheck: () => void;
}): ReactElement {
  return (
    <div className="ed-mp-debug-health">
      <div className="ed-mp-debug-health-pills">
        {health ? (
          <>
            <Pill label="/livez" probe={health.live} />
            <Pill label="/readyz" probe={health.ready} />
            <code className="ed-mp-debug-health-url">{health.backendBase}</code>
          </>
        ) : (
          <span className="ed-deploy-field-detail">
            {checking ? 'Probing backend…' : 'Backend not probed yet.'}
          </span>
        )}
      </div>
      <button type="button" className="ed-btn" disabled={checking} onClick={onRecheck}>
        {checking ? 'Checking…' : 'Re-check'}
      </button>
    </div>
  );
}
