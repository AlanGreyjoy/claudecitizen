import { listBundledPrefabIds, loadPrefabDocument } from './loader';

export interface ShipPrefabOption {
  id: string;
  label: string;
}

let cachedShipPrefabOptions: ShipPrefabOption[] | null = null;

/** Lists bundled ship prefabs for the admin ship-definition picker. */
export async function listShipPrefabOptions(): Promise<ShipPrefabOption[]> {
  if (cachedShipPrefabOptions) return cachedShipPrefabOptions;

  const results: ShipPrefabOption[] = [];
  for (const id of listBundledPrefabIds()) {
    const doc = await loadPrefabDocument(id);
    if (doc?.kind === 'ship') {
      results.push({ id, label: doc.name.trim() || id });
    }
  }
  cachedShipPrefabOptions = results.sort((left, right) => left.label.localeCompare(right.label));
  return cachedShipPrefabOptions;
}
