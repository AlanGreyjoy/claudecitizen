import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDesktopEditorBridge,
  type DesktopTranscodeState,
} from '../../../platform/editor-desktop';

const MAX_LOG_LINES = 4_000;

export type TranscodeTexturesStateHandle = {
  bridgeAvailable: boolean;
  running: boolean;
  log: string[];
  status: { message: string; isError: boolean };
  outputDir: string | null;
  start: () => Promise<void>;
  clearLog: () => void;
};

function appendLogLine(prev: string[], line: string): string[] {
  const next = [...prev, line];
  return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
}

/** Owns Tools → Transcode Project Textures… dialog state and streamed log. */
export function useTranscodeTexturesState(active: boolean): TranscodeTexturesStateHandle {
  const bridge = getDesktopEditorBridge();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState({ message: '', isError: false });
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!active || !bridge) return;
    return bridge.onTranscodeState((state: DesktopTranscodeState) => {
      if (state.phase === 'log') {
        const line = state.line.trimEnd();
        if (line) setLog((prev) => appendLogLine(prev, line));
        return;
      }
      if (state.phase === 'running') {
        setStatus({ message: state.message, isError: false });
        setLog((prev) => appendLogLine(prev, `── ${state.message}`));
        return;
      }
      if (state.phase === 'success' || state.phase === 'error') {
        setRunning(false);
        runningRef.current = false;
        setStatus({
          message: state.message,
          isError: state.phase === 'error',
        });
        if (state.phase === 'success' && state.outputDir) {
          setOutputDir(state.outputDir);
        }
        setLog((prev) => appendLogLine(prev, `── ${state.message}`));
      }
    });
  }, [active, bridge]);

  const clearLog = useCallback(() => {
    setLog([]);
  }, []);

  const start = useCallback(async () => {
    if (!bridge) {
      setStatus({
        message: 'Texture transcode needs the desktop editor.',
        isError: true,
      });
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setOutputDir(null);
    setStatus({ message: 'Starting texture transcode…', isError: false });
    setLog((prev) => appendLogLine(prev, '── Starting texture transcode…'));
    try {
      const result = await bridge.transcodeTextures();
      // Final status may already arrive via onTranscodeState; keep a fallback.
      if (!runningRef.current) return;
      setRunning(false);
      runningRef.current = false;
      setStatus({ message: result.message, isError: !result.ok });
      if (result.ok && result.outputDir) setOutputDir(result.outputDir);
      if (result.output && !result.ok) {
        for (const line of result.output.split(/\r?\n/)) {
          if (line.trim()) setLog((prev) => appendLogLine(prev, line));
        }
      }
    } catch (error) {
      setRunning(false);
      runningRef.current = false;
      setStatus({
        message: error instanceof Error ? error.message : 'Texture transcode failed.',
        isError: true,
      });
    }
  }, [bridge]);

  return {
    bridgeAvailable: Boolean(bridge),
    running,
    log,
    status,
    outputDir,
    start,
    clearLog,
  };
}
