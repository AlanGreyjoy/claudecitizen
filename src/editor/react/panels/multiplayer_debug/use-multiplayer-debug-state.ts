import { useCallback, useEffect, useState } from 'react';
import {
  getDesktopEditorBridge,
  type MultiplayerDebugHealth,
  type MultiplayerDebugOptions,
  type MultiplayerDebugState,
} from '../../../../platform/editor-desktop';

/**
 * N windows chattering at 30 Hz produce far more output than a deploy, so the
 * ceiling matters more here than it does in `use-deploy-state`.
 */
const MAX_LOG_LINES = 4_000;

export const DEFAULT_MULTIPLAYER_DEBUG_OPTIONS: MultiplayerDebugOptions = {
  instances: 2,
  accountPrefix: 'mpdebug',
  password: 'mp-debug-password-1',
  sceneId: 'mp-debug-arena',
  layout: 'grid',
  windowWidth: 960,
  windowHeight: 600,
  openDevTools: false,
  cubeAvatars: true,
  logPositionDelta: true,
};

/** One captured line, kept structured so the dialog can filter by instance. */
export interface MultiplayerDebugLogLine {
  key: number;
  /** 0 for harness-level messages that belong to no single window. */
  instance: number;
  text: string;
}

export interface MultiplayerDebugStateHandle {
  bridgeAvailable: boolean;
  options: MultiplayerDebugOptions;
  patch: (changes: Partial<MultiplayerDebugOptions>) => void;
  health: MultiplayerDebugHealth | null;
  checkingHealth: boolean;
  checkHealth: () => Promise<void>;
  running: boolean;
  busy: boolean;
  log: MultiplayerDebugLogLine[];
  clearLog: () => void;
  status: { message: string; isError: boolean };
  launch: () => Promise<void>;
  stop: () => Promise<void>;
}

const LEVEL_MARK: Record<string, string> = {
  warning: '! ',
  error: '× ',
};

/** `[mpdebug2] ! presence drift …` — the shape the log pane renders. */
function formatState(state: MultiplayerDebugState): { instance: number; text: string } | null {
  if (state.kind === 'console') {
    return {
      instance: state.instance,
      text: `[${state.label}] ${LEVEL_MARK[state.level] ?? ''}${state.line}`,
    };
  }
  if (state.kind === 'lifecycle') {
    return { instance: state.instance, text: `[${state.label}] ${state.phase}: ${state.message}` };
  }
  return { instance: 0, text: `── ${state.message}` };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useMultiplayerDebugState(active: boolean): MultiplayerDebugStateHandle {
  const bridge = getDesktopEditorBridge();
  const [options, setOptions] = useState<MultiplayerDebugOptions>(
    DEFAULT_MULTIPLAYER_DEBUG_OPTIONS,
  );
  const [health, setHealth] = useState<MultiplayerDebugHealth | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<MultiplayerDebugLogLine[]>([]);
  const [status, setStatusState] = useState({ message: '', isError: false });

  const setStatus = useCallback((message: string, isError = false): void => {
    setStatusState({ message, isError });
  }, []);

  const appendLine = useCallback((instance: number, text: string): void => {
    setLog((prev) => {
      const next = [...prev, { key: prev.length, instance, text }];
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  const patch = useCallback((changes: Partial<MultiplayerDebugOptions>): void => {
    setOptions((prev) => ({ ...prev, ...changes }));
  }, []);

  const clearLog = useCallback((): void => setLog([]), []);

  const checkHealth = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    setCheckingHealth(true);
    try {
      setHealth(await bridge.multiplayerDebugHealth());
    } catch (error) {
      setStatus(errorMessage(error), true);
    } finally {
      setCheckingHealth(false);
    }
  }, [bridge, setStatus]);

  // Probe and read back any run still live from a previous open of the dialog.
  useEffect(() => {
    if (!active || !bridge) return;
    setStatus('');
    void checkHealth();
    void bridge
      .multiplayerDebugStatus()
      .then((run) => setRunning(run.running))
      .catch(() => undefined);
  }, [active, bridge, checkHealth, setStatus]);

  useEffect(() => {
    if (!active || !bridge) return;
    return bridge.onMultiplayerDebugState((state) => {
      const line = formatState(state);
      if (line) appendLine(line.instance, line.text);
      if (state.kind !== 'run') return;
      setRunning(state.phase === 'starting' || state.phase === 'ready');
      if (state.phase === 'error') setStatus(state.message, true);
      if (state.phase === 'ready') setStatus(state.message);
      if (state.phase === 'stopped') setStatus(state.message);
    });
  }, [active, bridge, appendLine, setStatus]);

  const launch = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    setBusy(true);
    setStatus('');
    try {
      const run = await bridge.launchMultiplayerDebug(options);
      setRunning(run.running);
    } catch (error) {
      setStatus(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  }, [bridge, options, setStatus]);

  const stop = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    setBusy(true);
    try {
      const run = await bridge.stopMultiplayerDebug();
      setRunning(run.running);
    } catch (error) {
      setStatus(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  }, [bridge, setStatus]);

  return {
    bridgeAvailable: bridge !== null,
    options,
    patch,
    health,
    checkingHealth,
    checkHealth,
    running,
    busy,
    log,
    clearLog,
    status,
    launch,
    stop,
  };
}
