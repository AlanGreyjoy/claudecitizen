import { loadPrefabDocument } from '../prefabs/loader';
import type {
  PrefabComponent,
  PrefabDocument,
  PrefabEntity,
  PrefabTransform,
} from '../prefabs/schema';
import type { SceneDocument } from './schema';

/**
 * Components that make a GameObject part of a walkable station: spawn poses,
 * markers the station systems read, and the collider/frame authoring pieces.
 * `collect` in `station-runtime.ts` consumes exactly this set.
 */
const STATION_COMPONENT_TYPES = new Set<PrefabComponent['type']>([
  'spawn-point',
  'npc-spawner',
  'npc-waypoint',
  'npc-placement',
  'scene-exit',
  'hangar-open-space-exit',
  'exit-hangar',
  'enter-station',
  'hangar-pad',
  'interaction',
  'avms-terminal',
  'weapon-shop',
  'outfitters',
  'food-shop',
  'drinks-shop',
  'canteen',
  'animation',
  'door',
  'chest-storage',
  'station-frame',
  'collider',
]);

function identityTransform(): PrefabTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function prefabInstanceOf(
  entity: PrefabEntity,
): Extract<PrefabComponent, { type: 'prefab-instance' }> | null {
  for (const component of entity.components ?? []) {
    if (component.type === 'prefab-instance') return component;
  }
  return null;
}

/** Ships fly; they are not part of the station body the player walks on. */
function isShipInstance(entity: PrefabEntity): boolean {
  return prefabInstanceOf(entity)?.prefabKind === 'ship';
}

function hasOwnStationContent(entity: PrefabEntity): boolean {
  if (entity.asset || entity.primitive) return true;
  if (entity.nodeOverrides?.length) return true;
  if (prefabInstanceOf(entity)) return true;
  return (entity.components ?? []).some((component) =>
    STATION_COMPONENT_TYPES.has(component.type),
  );
}

/**
 * Whether the scene authors a station at all. A title or menu scene has no
 * geometry, no colliders and no spawn point, and must not conjure an empty
 * station document.
 */
export function sceneHasStationContent(scene: SceneDocument): boolean {
  const visit = (entities: PrefabEntity[]): boolean =>
    entities.some((entity) => {
      if (isShipInstance(entity)) return false;
      if (hasOwnStationContent(entity)) return true;
      return visit(entity.children ?? []);
    });
  return visit(scene.gameObjects ?? []);
}

/**
 * Prefab instances all embed the same nested entity ids. Remap them under the
 * host id so marker collect / door bake / NPC graphs do not collide across
 * copies of the same placeable.
 */
function remapPrefabEntityIds(entity: PrefabEntity, idPrefix: string): PrefabEntity {
  const remapped: PrefabEntity = {
    ...entity,
    id: `${idPrefix}/${entity.id}`,
  };
  if (entity.children?.length) {
    remapped.children = entity.children.map((child) =>
      remapPrefabEntityIds(child, idPrefix),
    );
  }
  return remapped;
}

/**
 * Rewrites one GameObject into a prefab entity. A `prefab-instance` keeps its
 * scene transform and gains the referenced prefab's root as a child, so a
 * placed prefab behaves exactly like the same geometry authored inline.
 */
async function compileEntity(entity: PrefabEntity): Promise<PrefabEntity | null> {
  if (isShipInstance(entity)) return null;

  const children: PrefabEntity[] = [];
  const instance = prefabInstanceOf(entity);
  if (instance) {
    const doc = await loadPrefabDocument(instance.prefabId);
    // A missing prefab must never block spawn: the rest of the scene still plays.
    if (doc) children.push(remapPrefabEntityIds(doc.root, entity.id));
    else console.warn(`Scene prefab-instance "${instance.prefabId}" not found; skipping.`);
  }

  for (const child of entity.children ?? []) {
    const compiled = await compileEntity(child);
    if (compiled) children.push(compiled);
  }

  const compiled: PrefabEntity = { ...entity };
  if (children.length) compiled.children = children;
  else delete compiled.children;
  return compiled;
}

/**
 * Compiles a scene into the same `PrefabDocument` shape a station prefab has,
 * so the scene's own GameObjects drive gameplay: `buildStationLayoutFromPrefab`
 * reads its spawn point and markers, `buildPrefabColliders` reads its colliders
 * and node overrides, and `createPrefabStationGroup` renders it.
 *
 * Returns null for scenes that author no station (title, loading, menus).
 */
export async function buildSceneStationDocument(
  scene: SceneDocument,
): Promise<PrefabDocument | null> {
  if (!sceneHasStationContent(scene)) return null;

  const children: PrefabEntity[] = [];
  for (const gameObject of scene.gameObjects ?? []) {
    const compiled = await compileEntity(gameObject);
    if (compiled) children.push(compiled);
  }

  return {
    id: scene.id,
    name: scene.name,
    version: 1,
    kind: 'station',
    root: {
      id: `scene-root:${scene.id}`,
      name: scene.name,
      transform: identityTransform(),
      children,
    },
  };
}
