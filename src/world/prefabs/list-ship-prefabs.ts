import { listBundledPrefabs } from './loader';
import { AUTHORING_ENABLED } from '../../build-mode';

export interface ShipPrefabOption {
  id: string;
  label: string;
}

let cachedShipPrefabOptions: ShipPrefabOption[] | null = null;

/**
 * Ship prefabs for the Server → Ships definition picker.
 * In the editor, read the open project via `/__editor/prefabs` so authored
 * hulls appear without a Vite restart (same path as items/props).
 */
export async function listShipPrefabOptions(): Promise<ShipPrefabOption[]> {
  if (AUTHORING_ENABLED) {
    try {
      const response = await fetch('/__editor/prefabs');
      if (response.ok) {
        const payload = (await response.json()) as {
          prefabs?: Array<{ id?: unknown; kind?: unknown; name?: unknown }>;
        };
        return (payload.prefabs ?? [])
          .filter(
            (entry): entry is { id: string; kind: 'ship'; name: string } =>
              entry.kind === 'ship' &&
              typeof entry.id === 'string' &&
              typeof entry.name === 'string',
          )
          .map((entry) => ({ id: entry.id, label: entry.name.trim() || entry.id }))
          .sort((left, right) => left.label.localeCompare(right.label));
      }
    } catch {
      // Fall through to the bundled list when the editor API is unavailable.
    }
  }

  if (cachedShipPrefabOptions) return cachedShipPrefabOptions;

  const results = (await listBundledPrefabs())
    .filter((doc) => doc.kind === 'ship')
    .map((doc) => ({ id: doc.id, label: doc.name.trim() || doc.id }));
  cachedShipPrefabOptions = results.sort((left, right) => left.label.localeCompare(right.label));
  return cachedShipPrefabOptions;
}
