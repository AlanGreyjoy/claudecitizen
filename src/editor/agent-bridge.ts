import type { EditorEntity, EditorStore, GlbNodeRef } from './document';
import type { IsolationBreadcrumb } from './document-session';
import { findEntityById } from './panels/inspector-logic';
import {
  getDesktopEditorBridge,
  type DesktopAgentRequest,
} from '../platform/editor-desktop';
import type { SceneEditorTab } from './react/types';

const DEFAULT_HIERARCHY_DEPTH = 8;
const DEFAULT_HIERARCHY_LIMIT = 400;
const MAX_HIERARCHY_DEPTH = 32;
const MAX_HIERARCHY_LIMIT = 2000;

export type AgentBridgeHandlers = {
  store: EditorStore;
  getTab: () => SceneEditorTab;
  getPlaying: () => boolean;
  getPaused: () => boolean;
  getIsolation: () => IsolationBreadcrumb | null;
  play: () => void;
  stopPlay: () => void;
  save: () => void | Promise<void>;
  loadSceneById: (id: string) => Promise<void>;
  loadPrefabById: (id: string) => Promise<void>;
};

type HierarchyNode = {
  id: string;
  name: string;
  components: string[];
  children?: HierarchyNode[];
};

type AgentError = Error & { code?: string; status?: number };

function agentError(message: string, code: string, status = 400): AgentError {
  const error = new Error(message) as AgentError;
  error.code = code;
  error.status = status;
  return error;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function findGlbNodeUuidByName(tree: GlbNodeRef, name: string): string | null {
  if (tree.name === name) return tree.uuid;
  for (const child of tree.children) {
    const found = findGlbNodeUuidByName(child, name);
    if (found) return found;
  }
  return null;
}

function summarizeEntity(
  entity: EditorEntity,
  depthLeft: number,
  budget: { remaining: number },
): HierarchyNode | null {
  if (budget.remaining <= 0) return null;
  budget.remaining -= 1;
  const node: HierarchyNode = {
    id: entity.id,
    name: entity.name,
    components: entity.components.map((c) => c.type),
  };
  if (depthLeft <= 0 || entity.children.length === 0) return node;
  const children: HierarchyNode[] = [];
  for (const child of entity.children) {
    if (budget.remaining <= 0) break;
    const summarized = summarizeEntity(child, depthLeft - 1, budget);
    if (summarized) children.push(summarized);
  }
  if (children.length > 0) node.children = children;
  return node;
}

function entityDetail(store: EditorStore, entity: EditorEntity) {
  return {
    id: entity.id,
    name: entity.name,
    visible: entity.visible,
    position: entity.position,
    rotation: entity.rotation,
    scale: entity.scale,
    asset: entity.asset,
    primitive: entity.primitive,
    glbAnchor: entity.glbAnchor ?? null,
    components: entity.components,
    glbNodeTransforms: entity.glbNodeTransforms,
    glbNodeHidden: entity.glbNodeHidden,
    materialOverrides: entity.materialOverrides,
    liveGlbOverrides: store.getGlbOverridesForEntity(entity.id),
  };
}

let activeHandlers: AgentBridgeHandlers | null = null;

export function registerAgentBridge(handlers: AgentBridgeHandlers): () => void {
  activeHandlers = handlers;
  return () => {
    if (activeHandlers === handlers) activeHandlers = null;
  };
}

function requireHandlers(): AgentBridgeHandlers {
  if (!activeHandlers) {
    throw agentError(
      'Editor agent bridge is not registered.',
      'editor_unavailable',
      503,
    );
  }
  return activeHandlers;
}

async function handleSnapshot(
  kind: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const handlers = requireHandlers();
  const { store } = handlers;
  const state = store.getState();

  switch (kind) {
    case 'session':
      return {
        dirty: store.isDirty(),
        tab: handlers.getTab(),
        playing: handlers.getPlaying(),
        paused: handlers.getPaused(),
        documentType: state.documentType,
        documentId: state.prefabId,
        documentName: state.prefabName,
        isolation: handlers.getIsolation(),
      };
    case 'open_document':
      return {
        documentType: state.documentType,
        id: state.prefabId,
        name: state.prefabName,
        kind: state.kind,
        sceneKind: state.sceneKind,
        dirty: store.isDirty(),
        isolation: handlers.getIsolation(),
      };
    case 'hierarchy': {
      const depth = clampInt(params.depth, DEFAULT_HIERARCHY_DEPTH, 0, MAX_HIERARCHY_DEPTH);
      const limit = clampInt(params.limit, DEFAULT_HIERARCHY_LIMIT, 1, MAX_HIERARCHY_LIMIT);
      const budget = { remaining: limit };
      const roots: HierarchyNode[] = [];
      for (const root of state.roots) {
        if (budget.remaining <= 0) break;
        const node = summarizeEntity(root, depth, budget);
        if (node) roots.push(node);
      }
      return {
        documentId: state.prefabId,
        truncated: budget.remaining <= 0,
        depth,
        limit,
        roots,
      };
    }
    case 'selection': {
      const selectedIds = store.getSelectedIds();
      const entities = selectedIds.map((id) => {
        const entity = findEntityById(state.roots, id);
        return entity
          ? { id: entity.id, name: entity.name, components: entity.components.map((c) => c.type) }
          : { id, name: null, components: [] as string[] };
      });
      const sub = store.getSubSelection();
      let subSelection: {
        entityId: string;
        nodeUuid: string;
        nodeName: string | null;
      } | null = null;
      if (sub) {
        subSelection = {
          entityId: sub.entityId,
          nodeUuid: sub.nodeUuid,
          nodeName: store.getGlbNodeName(sub.entityId, sub.nodeUuid),
        };
      }
      return { selectedIds, entities, subSelection };
    }
    case 'entity': {
      const id = typeof params.id === 'string' ? params.id : '';
      if (!id) throw agentError('Entity id is required.', 'bad_request');
      const entity = findEntityById(state.roots, id);
      if (!entity) throw agentError(`Entity "${id}" not found.`, 'not_found', 404);
      return entityDetail(store, entity);
    }
    case 'play_state':
      return {
        playing: handlers.getPlaying(),
        paused: handlers.getPaused(),
        tab: handlers.getTab(),
        documentType: state.documentType,
        documentId: state.prefabId,
        documentName: state.prefabName,
      };
    case 'command':
      return runCommand(handlers, params);
    default:
      throw agentError(`Unknown agent kind "${kind}".`, 'not_found', 404);
  }
}

async function commandSelectEntity(
  handlers: AgentBridgeHandlers,
  params: Record<string, unknown>,
): Promise<unknown> {
  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) throw agentError('Entity id is required.', 'bad_request');
  const entity = findEntityById(handlers.store.getState().roots, id);
  if (!entity) throw agentError(`Entity "${id}" not found.`, 'not_found', 404);
  handlers.store.setSelection(id);
  const nodeName = typeof params.nodeName === 'string' ? params.nodeName.trim() : '';
  if (!nodeName) return { ok: true, type: 'select_entity', id, nodeName: null };

  const tree = handlers.store.getGlbTree(id);
  if (!tree) {
    throw agentError(`Entity "${id}" has no loaded GLB tree.`, 'glb_tree_unavailable', 409);
  }
  const nodeUuid = findGlbNodeUuidByName(tree, nodeName);
  if (!nodeUuid) {
    throw agentError(`GLB node "${nodeName}" not found on entity "${id}".`, 'not_found', 404);
  }
  handlers.store.setSubSelection(id, nodeUuid);
  return { ok: true, type: 'select_entity', id, nodeName };
}

async function commandOpenDocumentById(
  handlers: AgentBridgeHandlers,
  params: Record<string, unknown>,
): Promise<unknown> {
  const id = typeof params.id === 'string' ? params.id.trim() : '';
  const documentType = params.documentType === 'prefab' ? 'prefab' : 'scene';
  if (!id) throw agentError('Document id is required.', 'bad_request');
  if (documentType === 'prefab') await handlers.loadPrefabById(id);
  else await handlers.loadSceneById(id);
  return { ok: true, type: 'open_document_by_id', documentType, id };
}

async function runCommand(
  handlers: AgentBridgeHandlers,
  params: Record<string, unknown>,
): Promise<unknown> {
  const type = typeof params.type === 'string' ? params.type : '';
  switch (type) {
    case 'play':
      handlers.play();
      return { ok: true, type };
    case 'stop_play':
      handlers.stopPlay();
      return { ok: true, type };
    case 'save':
      await handlers.save();
      return { ok: true, type };
    case 'select_entity':
      return commandSelectEntity(handlers, params);
    case 'open_document_by_id':
      return commandOpenDocumentById(handlers, params);
    default:
      throw agentError(`Unknown command "${type}".`, 'bad_request');
  }
}

function noop(): void {
  // Desktop bridge absent (browser / tests).
}

/**
 * Subscribe to main-process agent requests when running inside Electron.
 * No-op outside the desktop bridge.
 */
export function installAgentBridgeListener(): () => void {
  const bridge = getDesktopEditorBridge();
  if (!bridge?.onAgentRequest || !bridge.replyAgentRequest) return noop;

  return bridge.onAgentRequest((request: DesktopAgentRequest) => {
    void (async () => {
      try {
        const result = await handleSnapshot(request.kind, request.params ?? {});
        bridge.replyAgentRequest({ id: request.id, ok: true, result });
      } catch (error) {
        const err = error as AgentError;
        bridge.replyAgentRequest({
          id: request.id,
          ok: false,
          error: {
            code: err.code ?? 'agent_error',
            message: err.message || 'Agent request failed.',
            status: err.status,
          },
        });
      }
    })();
  });
}
