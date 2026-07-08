import { eulerXYZFromQuat, quatFromEulerXYZ } from '../math/quat';
import {
  type PrefabNodeOverride,
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

function transformToPrefab(transform: {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}) {
  const rotation = quatFromEulerXYZ(
    transform.rotation.x * DEG_TO_RAD,
    transform.rotation.y * DEG_TO_RAD,
    transform.rotation.z * DEG_TO_RAD,
  );
  return {
    position: {
      x: round(transform.position.x),
      y: round(transform.position.y),
      z: round(transform.position.z),
    },
    rotation: {
      x: round(rotation.x, 6),
      y: round(rotation.y, 6),
      z: round(rotation.z, 6),
      w: round(rotation.w, 6),
    },
    scale: {
      x: round(transform.scale.x),
      y: round(transform.scale.y),
      z: round(transform.scale.z),
    },
  };
}

function transformFromPrefab(transform: PrefabEntity["transform"]) {
  const euler = eulerXYZFromQuat(transform.rotation);
  return {
    position: { ...transform.position },
    rotation: {
      x: round(euler.x * RAD_TO_DEG, 3),
      y: round(euler.y * RAD_TO_DEG, 3),
      z: round(euler.z * RAD_TO_DEG, 3),
    },
    scale: { ...transform.scale },
  };
}

function nodeOverrideToPrefab(
  override: EditorEntity["glbNodeTransforms"][number],
): PrefabNodeOverride {
  const out: PrefabNodeOverride = {
    node: override.nodeName,
  };
  if (override.transform) {
    out.transform = transformToPrefab(override.transform);
  }
  if (override.components.length > 0) {
    out.components = structuredClone(override.components);
  }
  return out;
}

function entityToPrefab(entity: EditorEntity): PrefabEntity {
  const prefabEntity: PrefabEntity = {
    id: entity.id,
    name: entity.name,
    transform: transformToPrefab(entity),
  };
  if (entity.asset) prefabEntity.asset = { ...entity.asset };
  if (entity.primitive) prefabEntity.primitive = structuredClone(entity.primitive);
  if (entity.glbNodeTransforms.length > 0) {
    prefabEntity.nodeOverrides = entity.glbNodeTransforms.map(nodeOverrideToPrefab);
  }
  if (entity.glbNodeHidden.length > 0) {
    prefabEntity.hiddenNodes = [...entity.glbNodeHidden];
  }
  if (entity.materialOverrides.length > 0) {
    prefabEntity.materialOverrides = structuredClone(entity.materialOverrides);
  }
  if (entity.components.length > 0) prefabEntity.components = structuredClone(entity.components);
  if (entity.glbAnchor) prefabEntity.glbAnchor = entity.glbAnchor;
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
        : state.kind === 'prop'
          ? { components: [{ type: 'prop-frame' as const }] }
          : state.kind === 'item'
            ? { components: [{ type: 'item-frame' as const }] }
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
  const transform = transformFromPrefab(prefabEntity.transform);
  const entity = createEmptyEntity(prefabEntity.name);
  entity.id = prefabEntity.id;
  entity.position = transform.position;
  entity.rotation = transform.rotation;
  entity.scale = transform.scale;
  entity.asset = prefabEntity.asset ? { ...prefabEntity.asset } : null;
  entity.primitive = prefabEntity.primitive ? structuredClone(prefabEntity.primitive) : null;
  entity.glbNodeTransforms = (prefabEntity.nodeOverrides ?? []).map((override) => ({
    nodeName: override.node,
    transform: override.transform ? transformFromPrefab(override.transform) : undefined,
    components: override.components ? structuredClone(override.components) : [],
  }));
  entity.glbNodeHidden = prefabEntity.hiddenNodes ? [...prefabEntity.hiddenNodes] : [];
  entity.materialOverrides = prefabEntity.materialOverrides
    ? structuredClone(prefabEntity.materialOverrides)
    : [];
  entity.components = prefabEntity.components ? structuredClone(prefabEntity.components) : [];
  entity.glbAnchor = prefabEntity.glbAnchor;
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
