import { listBundledPrefabs } from './loader';
import { AUTHORING_ENABLED } from '../../build-mode';

export interface PropPrefabOption {
  id: string;
  label: string;
}

let cachedPropPrefabOptions: PropPrefabOption[] | null = null;

function isPlaceableKind(kind: unknown): boolean {
  // Legacy `prop` survives until documents are re-saved as `placeable`.
  return kind === 'placeable' || kind === 'prop';
}

/**
 * Placeable prefabs for the Server → Props definition picker.
 * In the editor, read the open project via `/__editor/prefabs` so freshly
 * authored hangar pieces appear without a Vite restart.
 */
export async function listPropPrefabOptions(): Promise<PropPrefabOption[]> {
  if (AUTHORING_ENABLED) {
    try {
      const response = await fetch('/__editor/prefabs');
      if (response.ok) {
        const payload = (await response.json()) as {
          prefabs?: Array<{ id?: unknown; kind?: unknown; name?: unknown }>;
        };
        return (payload.prefabs ?? [])
          .filter(
            (entry): entry is { id: string; kind: string; name: string } =>
              isPlaceableKind(entry.kind) &&
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

  if (cachedPropPrefabOptions) return cachedPropPrefabOptions;

  const results = (await listBundledPrefabs())
    .filter((doc) => isPlaceableKind(doc.kind))
    .map((doc) => ({ id: doc.id, label: doc.name.trim() || doc.id }));
  cachedPropPrefabOptions = results.sort((left, right) => left.label.localeCompare(right.label));
  return cachedPropPrefabOptions;
}
