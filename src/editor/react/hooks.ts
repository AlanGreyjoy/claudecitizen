import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import type { EditorEvent, EditorStore } from '../document';

/**
 * Subscribe to EditorStore events and re-render when one matches.
 *
 * Uses `useSyncExternalStore` so a store mutation emitted mid concurrent
 * render forces a consistent synchronous re-render instead of tearing
 * (panels read `store.getState()` directly during render). The snapshot is a
 * per-hook version counter bumped only on matching events, so unrelated
 * events never invalidate it.
 */
export function useEditorEvent(
  store: EditorStore,
  match: (event: EditorEvent) => boolean = () => true,
): number {
  const matchRef = useRef(match);
  matchRef.current = match;
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      store.subscribe((event) => {
        if (matchRef.current(event)) {
          versionRef.current += 1;
          onStoreChange();
        }
      }),
    [store],
  );
  const getSnapshot = useCallback(() => versionRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Re-render on any store event (or a filtered subset). */
export function useEditorStore(
  store: EditorStore,
  events?: ReadonlyArray<EditorEvent['type']>,
): number {
  const allow = useMemo(() => (events ? new Set(events) : null), [events]);
  return useEditorEvent(store, (event) => (allow ? allow.has(event.type) : true));
}

/** Stable store instance for the editor session lifetime. */
export function useEditorStoreInstance(create: () => EditorStore): EditorStore {
  const ref = useRef<EditorStore | null>(null);
  if (!ref.current) ref.current = create();
  return ref.current;
}

export function useHostRef<T extends HTMLElement = HTMLDivElement>(): [
  RefObject<T | null>,
  boolean,
] {
  const ref = useRef<T | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(Boolean(ref.current));
  }, []);
  return [ref, ready];
}
