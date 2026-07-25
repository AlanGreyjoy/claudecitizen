import { savePrefab } from './api';
import type { EditorStore } from './document';
import { showToast } from './dom';
import { entityToJson } from './serialize';
import {
  slugifyPrefabName,
  type PrefabDocument,
  type PrefabEntity,
  type PrefabKind,
} from '../world/prefabs/schema';

function frameComponentsForKind(kind: PrefabKind): PrefabEntity['components'] | undefined {
  if (kind === 'station') return [{ type: 'station-frame' }];
  if (kind === 'ship') return [{ type: 'ship-frame' }];
  if (kind === 'prop') return [{ type: 'prop-frame' }];
  if (kind === 'item') return [{ type: 'item-frame' }];
  return undefined;
}

/**
 * Unity-style "create prefab from selection": write the selected subtree to
 * `src/world/prefabs/data/<id>.prefab.json`, then replace the selection in the
 * open scene with a single `prefab-instance` GameObject pointing at it.
 *
 * The instance inherits the source entity's transform so the scene looks
 * unchanged after extraction.
 */
export async function createPrefabFromSelection(
  store: EditorStore,
  entityId: string,
  kind: PrefabKind = 'prop',
): Promise<string | null> {
  const located = store.locate(entityId);
  if (!located) {
    showToast('Select a GameObject to make a prefab from.', true);
    return null;
  }

  const source = located.entity;
  const id = slugifyPrefabName(source.name) || 'untitled-prefab';
  const frameComponents = frameComponentsForKind(kind);
  const serialized = entityToJson(source);

  const document: PrefabDocument = {
    id,
    name: source.name,
    version: 1,
    kind,
    root: {
      id: 'root',
      name: source.name,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      ...(frameComponents ? { components: frameComponents } : {}),
      // The instance carries placement, so the prefab root stays at origin.
      children: [{ ...serialized, transform: { ...serialized.transform, position: { x: 0, y: 0, z: 0 } } }],
    },
  };

  try {
    await savePrefab(document);
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : 'Could not save the prefab.',
      true,
    );
    return null;
  }

  store.replaceEntityWithPrefabInstance(entityId, id, kind);
  showToast(`Prefab "${id}" created from selection.`);
  return id;
}
