import { listBundledPrefabs } from './loader';

export interface PropPrefabOption {
  id: string;
  label: string;
}

let cachedPropPrefabOptions: PropPrefabOption[] | null = null;

/** Lists bundled prop prefabs for the admin prop-definition picker. */
export async function listPropPrefabOptions(): Promise<PropPrefabOption[]> {
  if (cachedPropPrefabOptions) return cachedPropPrefabOptions;

  const results = (await listBundledPrefabs())
    .filter((doc) => doc.kind === 'prop')
    .map((doc) => ({ id: doc.id, label: doc.name.trim() || doc.id }));
  cachedPropPrefabOptions = results.sort((left, right) => left.label.localeCompare(right.label));
  return cachedPropPrefabOptions;
}
