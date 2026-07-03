import { eulerXYZFromQuat, quatFromEulerXYZ } from '../math/quat';
import {
  slugifyPrefabName,
  type PrefabDocument,
  type PrefabEntity,
} from '../world/prefabs/schema';
import { createEmptyEntity, type EditorDocumentState, type EditorEntity } from './document';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function round(value: number, decimals = 5): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function entityToPrefab(entity: EditorEntity): PrefabEntity {
  const rotation = quatFromEulerXYZ(
    entity.rotation.x * DEG_TO_RAD,
    entity.rotation.y * DEG_TO_RAD,
    entity.rotation.z * DEG_TO_RAD,
  );
  const prefabEntity: PrefabEntity = {
    id: entity.id,
    name: entity.name,
    transform: {
      position: {
        x: round(entity.position.x),
        y: round(entity.position.y),
        z: round(entity.position.z),
      },
      rotation: {
        x: round(rotation.x, 6),
        y: round(rotation.y, 6),
        z: round(rotation.z, 6),
        w: round(rotation.w, 6),
      },
      scale: { x: round(entity.scale.x), y: round(entity.scale.y), z: round(entity.scale.z) },
    },
  };
  if (entity.asset) prefabEntity.asset = { ...entity.asset };
  if (entity.primitive) prefabEntity.primitive = structuredClone(entity.primitive);
  if (entity.components.length > 0) prefabEntity.components = structuredClone(entity.components);
  if (entity.children.length > 0) {
    prefabEntity.children = entity.children.map(entityToPrefab);
  }
  return prefabEntity;
}

/** Serializes the editor document; station/ship prefabs get a frame marker on the root. */
export function toPrefabDocument(state: EditorDocumentState): PrefabDocument {
  const id = state.prefabId || slugifyPrefabName(state.prefabName) || 'untitled';
  const frameComponents =
    state.kind === 'station'
      ? { components: [{ type: 'station-frame' as const }] }
      : state.kind === 'ship'
        ? { components: [{ type: 'ship-frame' as const }] }
        : {};
  return {
    id,
    name: state.prefabName,
    version: 1,
    kind: state.kind,
    root: {
      id: 'root',
      name: state.prefabName,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      ...frameComponents,
      children: state.roots.map(entityToPrefab),
    },
  };
}

function entityFromPrefab(prefabEntity: PrefabEntity): EditorEntity {
  const euler = eulerXYZFromQuat(prefabEntity.transform.rotation);
  const entity = createEmptyEntity(prefabEntity.name);
  entity.id = prefabEntity.id;
  entity.position = { ...prefabEntity.transform.position };
  entity.rotation = {
    x: round(euler.x * RAD_TO_DEG, 3),
    y: round(euler.y * RAD_TO_DEG, 3),
    z: round(euler.z * RAD_TO_DEG, 3),
  };
  entity.scale = { ...prefabEntity.transform.scale };
  entity.asset = prefabEntity.asset ? { ...prefabEntity.asset } : null;
  entity.primitive = prefabEntity.primitive ? structuredClone(prefabEntity.primitive) : null;
  entity.components = prefabEntity.components ? structuredClone(prefabEntity.components) : [];
  entity.children = (prefabEntity.children ?? []).map(entityFromPrefab);
  return entity;
}

export function fromPrefabDocument(doc: PrefabDocument): EditorDocumentState {
  return {
    prefabId: doc.id,
    prefabName: doc.name,
    kind: doc.kind,
    roots: (doc.root.children ?? []).map(entityFromPrefab),
  };
}
