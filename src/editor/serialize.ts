import { eulerXYZFromQuat, quatFromEulerXYZ } from '../math/quat';
import {
  type PrefabNodeOverride,
  slugifyPrefabName,
  type PrefabDocument,
  type PrefabEntity,
  type PrefabKind,
} from '../world/prefabs/schema';
import {
  createDefaultSceneDocument,
  type SceneDocument,
  type SceneKind,
  type SceneSettings,
} from '../world/scenes/schema';
import { createEmptyEntity, type EditorDocumentState, type EditorEntity } from './document';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function round(value: number, decimals = 5): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function transformToJson(transform: {
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

function transformFromJson(transform: PrefabEntity['transform']) {
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

function nodeOverrideToJson(
  override: EditorEntity['glbNodeTransforms'][number],
): PrefabNodeOverride {
  const out: PrefabNodeOverride = {
    node: override.nodeName,
  };
  if (override.transform) {
    out.transform = transformToJson(override.transform);
  }
  if (override.components.length > 0) {
    out.components = structuredClone(override.components);
  }
  return out;
}

/** Shared GameObject → JSON entity (used by prefab and scene serialize). */
export function entityToJson(entity: EditorEntity): PrefabEntity {
  const prefabEntity: PrefabEntity = {
    id: entity.id,
    name: entity.name,
    transform: transformToJson(entity),
  };
  if (entity.asset) prefabEntity.asset = { ...entity.asset };
  if (entity.primitive) prefabEntity.primitive = structuredClone(entity.primitive);
  if (entity.glbNodeTransforms.length > 0) {
    prefabEntity.nodeOverrides = entity.glbNodeTransforms.map(nodeOverrideToJson);
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
    prefabEntity.children = entity.children.map(entityToJson);
  }
  return prefabEntity;
}

/** Shared JSON entity → GameObject (used by prefab and scene deserialize). */
export function entityFromJson(prefabEntity: PrefabEntity): EditorEntity {
  const transform = transformFromJson(prefabEntity.transform);
  const entity = createEmptyEntity(prefabEntity.name);
  entity.id = prefabEntity.id;
  entity.position = transform.position;
  entity.rotation = transform.rotation;
  entity.scale = transform.scale;
  entity.asset = prefabEntity.asset ? { ...prefabEntity.asset } : null;
  entity.primitive = prefabEntity.primitive ? structuredClone(prefabEntity.primitive) : null;
  entity.glbNodeTransforms = (prefabEntity.nodeOverrides ?? []).map((override) => ({
    nodeName: override.node,
    transform: override.transform ? transformFromJson(override.transform) : undefined,
    components: override.components ? structuredClone(override.components) : [],
  }));
  entity.glbNodeHidden = prefabEntity.hiddenNodes ? [...prefabEntity.hiddenNodes] : [];
  entity.materialOverrides = prefabEntity.materialOverrides
    ? structuredClone(prefabEntity.materialOverrides)
    : [];
  entity.components = prefabEntity.components ? structuredClone(prefabEntity.components) : [];
  entity.glbAnchor = prefabEntity.glbAnchor;
  entity.children = (prefabEntity.children ?? []).map(entityFromJson);
  return entity;
}

function frameComponentsForKind(kind: PrefabKind): PrefabEntity['components'] | undefined {
  if (kind === 'station') return [{ type: 'station-frame' }];
  if (kind === 'ship') return [{ type: 'ship-frame' }];
  if (kind === 'prop') return [{ type: 'prop-frame' }];
  if (kind === 'item') return [{ type: 'item-frame' }];
  return undefined;
}

/** Serializes the editor document; station/ship prefabs get a frame marker on the root. */
export function toPrefabDocument(state: EditorDocumentState): PrefabDocument {
  const id = state.prefabId || slugifyPrefabName(state.prefabName) || 'untitled';
  const frameComponents = frameComponentsForKind(state.kind);
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
      ...(frameComponents ? { components: frameComponents } : {}),
      children: state.roots.map(entityToJson),
    },
  };
}

export function fromPrefabDocument(doc: PrefabDocument): EditorDocumentState {
  return {
    documentType: 'prefab',
    prefabId: doc.id,
    prefabName: doc.name,
    kind: doc.kind,
    sceneKind: 'main-game',
    sceneSettings: createDefaultSceneDocument().settings,
    roots: (doc.root.children ?? []).map(entityFromJson),
  };
}

/** Serializes a scene document — no synthetic root, no prefab frame components. */
export function toSceneDocument(state: EditorDocumentState): SceneDocument {
  const id = state.prefabId || slugifyPrefabName(state.prefabName) || 'untitled';
  return {
    schemaVersion: 2,
    id,
    name: state.prefabName,
    kind: state.sceneKind,
    settings: structuredClone(state.sceneSettings),
    gameObjects: state.roots.map(entityToJson),
  };
}

export function fromSceneDocument(doc: SceneDocument): EditorDocumentState {
  return {
    documentType: 'scene',
    prefabId: doc.id,
    prefabName: doc.name,
    kind: 'site',
    sceneKind: doc.kind,
    sceneSettings: structuredClone(doc.settings),
    roots: doc.gameObjects.map(entityFromJson),
  };
}

export function createEmptySceneEditorState(
  id = '',
  name = 'Untitled Scene',
  sceneKind: SceneKind = 'main-game',
  sceneSettings?: SceneSettings,
): EditorDocumentState {
  const defaults = createDefaultSceneDocument(id || 'new-scene', name);
  return {
    documentType: 'scene',
    prefabId: id,
    prefabName: name,
    kind: 'site',
    sceneKind,
    sceneSettings: sceneSettings ? structuredClone(sceneSettings) : defaults.settings,
    roots: [],
  };
}
