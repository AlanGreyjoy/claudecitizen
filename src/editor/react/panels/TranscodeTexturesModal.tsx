import { useEffect, useRef, type ReactElement } from 'react';
import { DeployDialogShell, DeployLog, stopKeyPropagation } from './deploy/DeployDialogParts';
import { useTranscodeTexturesState } from './use-transcode-textures-state';

const COPY =
  'Encodes Basis/KTX2 twins under <project>/.asteron/derived/. '
  + 'Source GLBs stay untouched — run bake scripts first when re-exporting from Unity. '
  + 'Needs KTX-Software from Tools → Packages….';

function UnavailableDialog({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <DeployDialogShell
      title="Transcode Textures"
      copy="Texture transcode needs the desktop editor and is unavailable in the browser build."
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

/** Tools → Transcode Project Textures…. Status + streamed log. */
export function TranscodeTexturesModal({
  open,
  autoStart = false,
  onClose,
  onAutoStartConsumed,
}: {
  open: boolean;
  /** When true (menu command), start the run as soon as the dialog opens. */
  autoStart?: boolean;
  onClose: () => void;
  onAutoStartConsumed?: () => void;
}): ReactElement | null {
  const state = useTranscodeTexturesState(open);
  const startedForOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      startedForOpen.current = false;
      return;
    }
    if (!autoStart || startedForOpen.current || !state.bridgeAvailable) return;
    startedForOpen.current = true;
    onAutoStartConsumed?.();
    void state.start();
  }, [open, autoStart, state.bridgeAvailable, state.start, onAutoStartConsumed]);

  if (!open) return null;
  if (!state.bridgeAvailable) return <UnavailableDialog onClose={onClose} />;

  const { running, status, log, outputDir } = state;

  return (
    <DeployDialogShell
      title="Transcode Textures"
      copy={COPY}
      status={status}
      onClose={onClose}
      busy={running}
      actions={
        <>
          <button
            type="button"
            className="ed-btn ed-btn-accent"
            disabled={running}
            onClick={() => void state.start()}
          >
            {running ? 'Transcoding…' : log.length > 0 ? 'Run Again' : 'Start'}
          </button>
          <button
            type="button"
            className="ed-btn"
            disabled={running || log.length === 0}
            onClick={state.clearLog}
          >
            Clear Log
          </button>
          <button type="button" className="ed-btn" disabled={running} onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="ed-transcode-dialog" onKeyDown={stopKeyPropagation}>
        {outputDir ? (
          <div className="ed-deploy-field-detail">Output: {outputDir}</div>
        ) : null}
        <DeployLog lines={log} />
      </div>
    </DeployDialogShell>
  );
}
