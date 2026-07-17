import { listBundledPrefabIds, loadPrefabDocument } from './loader';

export interface ItemPrefabOption {
  id: string;
  label: string;
}

let cachedItemPrefabOptions: ItemPrefabOption[] | null = null;

/** Lists bundled item prefabs for the admin item-definition picker. */
export async function listItemPrefabOptions(): Promise<ItemPrefabOption[]> {
  if (import.meta.env.DEV) {
    try {
      const response = await fetch('/__editor/prefabs');
      if (response.ok) {
        const payload = (await response.json()) as {
          prefabs?: Array<{ id?: unknown; kind?: unknown; name?: unknown }>;
        };
        return (payload.prefabs ?? [])
          .filter(
            (entry): entry is { id: string; kind: 'item'; name: string } =>
              entry.kind === 'item' &&
              typeof entry.id === 'string' &&
              typeof entry.name === 'string',
          )
          .map((entry) => ({ id: entry.id, label: entry.name.trim() || entry.id }))
          .sort((left, right) => left.label.localeCompare(right.label));
      }
    } catch {
      // Fall through to the bundled list when the dev API is unavailable.
    }
  }

  if (cachedItemPrefabOptions) return cachedItemPrefabOptions;

  const results: ItemPrefabOption[] = [];
  for (const id of listBundledPrefabIds()) {
    const doc = await loadPrefabDocument(id);
    if (doc?.kind === 'item') {
      results.push({ id, label: doc.name.trim() || id });
    }
  }
  cachedItemPrefabOptions = results.sort((left, right) => left.label.localeCompare(right.label));
  return cachedItemPrefabOptions;
}
