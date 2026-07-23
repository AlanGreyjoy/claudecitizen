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
  onReady: (viewport: EditorViewport | null) => void;
  onDropAsset: (url: string, position: Vec3) => void;
  toolbarSlot: (host: HTMLDivElement | null) => void;
};

/**
 * Prefab scene viewport: keeps toolbar/hint as siblings; canvas is appended by
 * createEditorViewport (must stay imperative).
 */
export function ViewportHost({
  store,
  hidden,
  onReady,
  onDropAsset,
  toolbarSlot,
}: ViewportHostProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const onDropRef = useRef(onDropAsset);
  onDropRef.current = onDropAsset;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    toolbarSlot(toolbarRef.current);
    return () => toolbarSlot(null);
  }, [toolbarSlot]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const viewport = createEditorViewport(host, store, {
      onDropAsset(url, position) {
        onDropRef.current(url, position);
      },
    });
    onReadyRef.current(viewport);
    return () => {
      onReadyRef.current(null);
      viewport.dispose();
    };
  }, [store]);

  return (
    <div
      ref={containerRef}
      className={`ed-viewport${hidden ? ' is-hidden' : ''}`}
    >
      <div ref={toolbarRef} className="ed-viewport-toolbar" />
      <div className="ed-viewport-hint">
        LMB select · Ctrl+click multi · re-click drill · RMB sub-mesh: add empty/component ·
        MMB pan · wheel zoom · hold RMB + WASD fly · W/E/R gizmo · F focus · Ctrl+D duplicate ·
        Del delete
      </div>
    </div>
  );
}
