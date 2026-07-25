import { listBundledPrefabIds, loadPrefabDocument } from './loader';

export interface PropPrefabOption {
  id: string;
  label: string;
}

let cachedPropPrefabOptions: PropPrefabOption[] | null = null;

/** Lists bundled prop prefabs for the admin prop-definition picker. */
export async function listPropPrefabOptions(): Promise<PropPrefabOption[]> {
  if (cachedPropPrefabOptions) return cachedPropPrefabOptions;

  const results: PropPrefabOption[] = [];
  for (const id of listBundledPrefabIds()) {
    const doc = await loadPrefabDocument(id);
    if (doc?.kind === 'prop') {
      results.push({ id, label: doc.name.trim() || id });
    }
  }
  cachedPropPrefabOptions = results.sort((left, right) => left.label.localeCompare(right.label));
  return cachedPropPrefabOptions;
}
