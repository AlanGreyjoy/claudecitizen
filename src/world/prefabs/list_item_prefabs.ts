import { listBundledPrefabIds, loadPrefabDocument } from './loader';

export interface ItemPrefabOption {
  id: string;
  label: string;
}

let cachedItemPrefabOptions: ItemPrefabOption[] | null = null;

/** Lists bundled item prefabs for the admin item-definition picker. */
export async function listItemPrefabOptions(): Promise<ItemPrefabOption[]> {
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
