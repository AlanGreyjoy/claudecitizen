import { useEffect, useState, type ReactElement } from 'react';
import { fetchSceneList, type SceneListEntry } from '../../../api';

/**
 * Scene reference picker.
 *
 * Every component that points at another scene — Game Manager hops, scene-link,
 * scene-exit — used to hand-roll this dropdown (or, worse, take a free-text id).
 * One widget means one set of rules: a dangling reference stays visible instead
 * of silently resetting to the first scene in the list, and the document being
 * edited never offers itself as a destination.
 */
export function SceneRefField({
  value,
  onCommit,
  emptyLabel = '(none)',
  excludeSceneId,
  extraOptions = [],
}: {
  value: string;
  onCommit: (sceneId: string) => void;
  emptyLabel?: string;
  excludeSceneId?: string;
  /** Non-scene tokens offered above the list, e.g. `@space`. */
  extraOptions?: Array<{ id: string; name: string }>;
}): ReactElement {
  const [scenes, setScenes] = useState<SceneListEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchSceneList()
      .then((list) => {
        if (!cancelled) setScenes(list);
      })
      .catch(() => {
        if (!cancelled) setScenes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = scenes.filter((entry) => entry.id !== excludeSceneId);
  // A saved id the list does not know about (renamed, deleted, or authored
  // before the scene existed) is still the authored value: show it rather than
  // rendering someone else's scene as if it were the selection.
  const known = [...extraOptions, ...options];
  if (value && !known.some((entry) => entry.id === value)) {
    known.unshift({ id: value, name: `${value} (missing)` });
  }

  return (
    <select
      className="ed-select"
      value={value}
      onChange={(event) => onCommit(event.currentTarget.value.trim())}
    >
      <option value="">{emptyLabel}</option>
      {known.map(({ id, name }) => (
        <option key={id} value={id}>
          {name === id ? id : `${name} (${id})`}
        </option>
      ))}
    </select>
  );
}
