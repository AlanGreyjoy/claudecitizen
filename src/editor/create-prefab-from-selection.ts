import { savePrefab } from './api';
import type { EditorEntity, EditorStore } from './document';
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
  if (kind === 'placeable') return [{ type: 'prop-frame' }];
  if (kind === 'item') return [{ type: 'item-frame' }];
  return undefined;
}

/** Component types that already declare what a subtree is. */
const KIND_BY_COMPONENT_TYPE: Readonly<Record<string, PrefabKind>> = {
  'ship-controller': 'ship',
  'ship-frame': 'ship',
  'station-frame': 'station',
  'item-frame': 'item',
  'prop-frame': 'placeable',
  'scene-exit': 'station',
  'hangar-open-space-exit': 'station',
  'hangar-pad': 'station',
  'ship-door': 'ship',
  door: 'station',
  'equipment-socket': 'item',
  'weapon-combat': 'item',
};

/**
 * Reads the prefab kind out of the subtree instead of asking. Dragging a
 * GameObject into a folder should just work; the Inspector can correct the kind
 * afterwards, and `placeable` is the safe default for plain meshes.
 */
function inferPrefabKind(entity: EditorEntity): PrefabKind {
  const stack: EditorEntity[] = [entity];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const component of current.components) {
      const kind = KIND_BY_COMPONENT_TYPE[component.type];
      if (kind) return kind;
    }
    stack.push(...current.children);
  }
  return 'placeable';
}

/**
 * Unity-style "create prefab from selection": write the selected subtree to
 * `<target folder>/<id>.prefab.json`, then replace the selection in the open
 * scene with a single `prefab-instance` GameObject pointing at it.
 *
 * The instance inherits the source entity's transform so the scene looks
 * unchanged after extraction.
 */
export async function createPrefabFromSelection(
  store: EditorStore,
  entityId: string,
  kind?: PrefabKind,
  folder?: string,
): Promise<string | null> {
  const located = store.locate(entityId);
  if (!located) {
    showToast('Select a GameObject to make a prefab from.', true);
    return null;
  }

  const source = located.entity;
  const resolvedKind = kind ?? inferPrefabKind(source);
  const id = slugifyPrefabName(source.name) || 'untitled-prefab';
  const frameComponents = frameComponentsForKind(resolvedKind);
  const serialized = entityToJson(source);

  const document: PrefabDocument = {
    id,
    name: source.name,
    version: 1,
    kind: resolvedKind,
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

  let savedPath: string;
  try {
    savedPath = await savePrefab(document, folder);
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : 'Could not save the prefab.',
      true,
    );
    return null;
  }

  store.replaceEntityWithPrefabInstance(entityId, id, resolvedKind);
  showToast(`Created ${savedPath}`);
  return id;
}
