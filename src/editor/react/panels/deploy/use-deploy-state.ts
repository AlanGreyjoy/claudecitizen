import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDesktopEditorBridge,
  type DeployConfig,
  type DeployConfigInput,
  type DeployPreflight,
  type DeployState,
  type DeployTarget,
} from '../../../../platform/editor-desktop';

/** Trimmed so a long `docker compose build` cannot grow the log without bound. */
const MAX_LOG_LINES = 4_000;

export type DeployRun = {
  target: DeployTarget | null;
  running: boolean;
  steps: string[];
  stepIndex: number;
  failedStep: number | null;
};

const IDLE_RUN: DeployRun = {
  target: null,
  running: false,
  steps: [],
  stepIndex: -1,
  failedStep: null,
};

export type DeployStatus = { message: string; isError: boolean };

/**
 * Strips `hasPassword` — a read-only report from the main process, not a stored
 * field — and attaches the password only when the user actually typed one, so
 * an untouched field leaves the stored secret intact.
 */
function toConfigInput(config: DeployConfig, password: string | null): DeployConfigInput {
  const fields: Record<string, unknown> = { ...config };
  delete fields.hasPassword;
  const input = fields as DeployConfigInput;
  return password === null ? input : { ...input, password };
}

export type DeployStateHandle = {
  bridgeAvailable: boolean;
  loading: boolean;
  config: DeployConfig | null;
  defaultSteps: DeployConfig['steps'];
  dirty: boolean;
  password: string | null;
  preflight: DeployPreflight | null;
  run: DeployRun;
  log: string[];
  status: DeployStatus;
  setStatus: (message: string, isError?: boolean) => void;
  patch: (changes: Partial<DeployConfigInput>) => void;
  setPassword: (value: string) => void;
  save: () => Promise<boolean>;
  refreshPreflight: () => Promise<void>;
  testConnection: () => Promise<void>;
  deploy: (target: DeployTarget) => Promise<void>;
  cancel: () => void;
  clearLog: () => void;
};

function applyState(state: DeployState, setRun: (update: (prev: DeployRun) => DeployRun) => void): void {
  if (state.phase === 'started') {
    setRun(() => ({
      target: state.target,
      running: true,
      steps: state.steps,
      stepIndex: -1,
      failedStep: null,
    }));
    return;
  }
  if (state.phase === 'step') {
    setRun((prev) => ({ ...prev, stepIndex: state.stepIndex }));
    return;
  }
  if (state.phase === 'success' || state.phase === 'error') {
    setRun((prev) => ({
      ...prev,
      running: false,
      failedStep: state.phase === 'error' ? state.failedStep ?? prev.stepIndex : null,
    }));
  }
}

/**
 * Owns a deploy dialog's state: config editing, the streamed log, and run
 * progress. Both dialogs share one config store, so either can edit its own
 * half without clobbering the other's fields.
 *
 * The password is held separately from `config` because the main process never
 * returns it — the field starts blank and is only sent when the user types one.
 *
 * `withPreflight` is for the backend dialog: the git comparison is meaningless
 * for the client half, which ships the local build output rather than a commit.
 */
export function useDeployState(active: boolean, withPreflight = false): DeployStateHandle {
  const bridge = getDesktopEditorBridge();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<DeployConfig | null>(null);
  const [defaultSteps, setDefaultSteps] = useState<DeployConfig['steps']>([]);
  const [dirty, setDirty] = useState(false);
  const [password, setPasswordState] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<DeployPreflight | null>(null);
  const [run, setRun] = useState<DeployRun>(IDLE_RUN);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatusState] = useState<DeployStatus>({ message: '', isError: false });
  const configRef = useRef<DeployConfig | null>(null);
  const passwordRef = useRef<string | null>(null);

  configRef.current = config;
  passwordRef.current = password;

  const setStatus = useCallback((message: string, isError = false): void => {
    setStatusState({ message, isError });
  }, []);

  const appendLog = useCallback((line: string): void => {
    setLog((prev) => {
      const next = [...prev, line];
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  useEffect(() => {
    if (!active || !bridge) return;
    return bridge.onDeployState((state) => {
      if (state.phase === 'log') {
        appendLog(state.line);
        return;
      }
      if (state.phase === 'started') appendLog(state.message);
      if (state.phase === 'step') appendLog(`── ${state.label}`);
      if (state.phase === 'success' || state.phase === 'error') {
        appendLog(state.message);
        setStatus(state.message, state.phase === 'error');
      }
      applyState(state, setRun);
    });
  }, [active, bridge, appendLog, setStatus]);

  const refreshPreflight = useCallback(async (): Promise<void> => {
    if (!bridge || !withPreflight) return;
    try {
      setPreflight(await bridge.deployPreflight());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Preflight failed.', true);
    }
  }, [bridge, withPreflight, setStatus]);

  useEffect(() => {
    if (!active || !bridge) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLog([]);
    setRun(IDLE_RUN);
    setStatusState({ message: '', isError: false });
    bridge
      .getDeployConfig()
      .then((result) => {
        setConfig(result.config);
        setDefaultSteps(result.defaultSteps);
        setDirty(false);
        setPasswordState(null);
        return refreshPreflight();
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'Could not load deploy settings.', true);
      })
      .finally(() => setLoading(false));
  }, [active, bridge, refreshPreflight, setStatus]);

  const patch = useCallback((changes: Partial<DeployConfigInput>): void => {
    setConfig((prev) => (prev ? { ...prev, ...changes } : prev));
    setDirty(true);
  }, []);

  const setPassword = useCallback((value: string): void => {
    setPasswordState(value);
    setDirty(true);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const current = configRef.current;
    if (!bridge || !current) return false;
    const payload = toConfigInput(current, passwordRef.current);
    try {
      const result = await bridge.saveDeployConfig(payload);
      setConfig(result.config);
      setDirty(false);
      setPasswordState(null);
      setStatus(`Saved to ${result.path}`);
      await refreshPreflight();
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save deploy settings.', true);
      return false;
    }
  }, [bridge, refreshPreflight, setStatus]);

  const testConnection = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    setStatus('Connecting…');
    try {
      const result = await bridge.testDeployConnection();
      appendLog('── Test connection');
      for (const line of result.detail.split('\n')) appendLog(line);
      if (!result.remotePathIsRepo) {
        appendLog('WARNING: the remote path is not a git checkout — the pull step will fail.');
      }
      setStatus(
        result.remotePathIsRepo
          ? 'Connected. Remote path is a git checkout.'
          : 'Connected, but the remote path is not a git checkout.',
        !result.remotePathIsRepo,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Connection failed.', true);
    }
  }, [bridge, appendLog, setStatus]);

  const deploy = useCallback(
    async (target: DeployTarget): Promise<void> => {
      if (!bridge) return;
      setLog([]);
      setStatus('');
      try {
        await (target === 'backend' ? bridge.deployBackend() : bridge.deployClient());
      } catch (error) {
        setRun((prev) => ({ ...prev, running: false }));
        setStatus(error instanceof Error ? error.message : 'Deploy failed to start.', true);
      }
    },
    [bridge, setStatus],
  );

  const cancel = useCallback((): void => {
    void bridge?.cancelDeploy();
  }, [bridge]);

  const clearLog = useCallback((): void => setLog([]), []);

  return {
    bridgeAvailable: bridge !== null,
    loading,
    config,
    defaultSteps,
    dirty,
    password,
    preflight,
    run,
    log,
    status,
    setStatus,
    patch,
    setPassword,
    save,
    refreshPreflight,
    testConnection,
    deploy,
    cancel,
    clearLog,
  };
}
