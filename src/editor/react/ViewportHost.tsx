import { useEffect, useRef, type ReactElement } from 'react';
import type { EditorStore } from '../document';
import {
  createEditorViewport,
  type EditorViewport,
} from '../../render/editor/viewport';
import type { Vec3 } from '../../types';

type ViewportHostProps = {
  store: EditorStore;
  hidden: boolean;
  playing?: boolean;
  onReady: (viewport: EditorViewport | null) => void;
  onDropAsset: (url: string, position: Vec3) => void;
};

/**
 * Scene / prefab viewport: hint stays a sibling; canvas is appended by
 * createEditorViewport (must stay imperative). When `playing`, the Scene view
 * becomes Play view in place (Unity-style).
 */
export function ViewportHost({
  store,
  hidden,
  playing = false,
  onReady,
  onDropAsset,
}: ViewportHostProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<EditorViewport | null>(null);
  const onDropRef = useRef(onDropAsset);
  onDropRef.current = onDropAsset;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const viewport = createEditorViewport(host, store, {
      onDropAsset(url, position) {
        onDropRef.current(url, position);
      },
    });
    viewportRef.current = viewport;
    onReadyRef.current(viewport);
    return () => {
      viewportRef.current = null;
      onReadyRef.current(null);
      viewport.dispose();
    };
  }, [store]);

  useEffect(() => {
    viewportRef.current?.setPlayMode(playing);
  }, [playing]);

  return (
    <div
      ref={containerRef}
      className={`ed-viewport${hidden ? ' is-hidden' : ''}${playing ? ' is-playing' : ''}`}
    >
      <div className="ed-viewport-hint">
        {playing
          ? 'Play Mode — this is the open scene · hold RMB + WASD fly · F6 or Stop to return to edit'
          : 'LMB select mesh · Ctrl+click multi · re-click walk up · RMB sub-mesh: add empty/component · MMB pan · wheel zoom · hold RMB + WASD fly · W/E/R gizmo · F focus · Ctrl+D duplicate · Del delete'}
      </div>
      {playing ? (
        <div className="ed-play-mode-banner" aria-live="polite">
          Play Mode
        </div>
      ) : null}
    </div>
  );
}
