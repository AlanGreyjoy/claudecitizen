import { listBundledPrefabs } from './loader';

export interface ShipPrefabOption {
  id: string;
  label: string;
}

let cachedShipPrefabOptions: ShipPrefabOption[] | null = null;

/** Lists bundled ship prefabs for the admin ship-definition picker. */
export async function listShipPrefabOptions(): Promise<ShipPrefabOption[]> {
  if (cachedShipPrefabOptions) return cachedShipPrefabOptions;

  const results = (await listBundledPrefabs())
    .filter((doc) => doc.kind === 'ship')
    .map((doc) => ({ id: doc.id, label: doc.name.trim() || doc.id }));
  cachedShipPrefabOptions = results.sort((left, right) => left.label.localeCompare(right.label));
  return cachedShipPrefabOptions;
}
