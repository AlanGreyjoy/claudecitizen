import { useEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react';
import type { EditorEvent, EditorStore } from '../document';

/** Subscribe to EditorStore events and force a re-render when matching. */
export function useEditorEvent(
  store: EditorStore,
  match: (event: EditorEvent) => boolean = () => true,
): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const matchRef = useRef(match);
  matchRef.current = match;

  useEffect(() => {
    return store.subscribe((event) => {
      if (matchRef.current(event)) bump();
    });
  }, [store]);

  return version;
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
