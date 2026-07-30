import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react';
import {
  fetchPlanetList,
  fetchPrefabList,
  fetchSceneList,
  rememberLastOpenedScene,
  savePrefab,
  saveScene,
} from '../api';
import type { EditorStore } from '../document';
import { showToast } from '../dom';
import { collectGlbNodeNames, findGlbNodeRef } from '../document-glb-tree';
import { entityBoundToAnyGlbNode } from '../glb-binding';
import { toPrefabDocument, toSceneDocument } from '../serialize';
import { parsePrefabDocument, slugifyPrefabName } from '../../world/prefabs/schema';
import { parseSceneDocument, SCENE_ID_PATTERN } from '../../world/scenes/schema';
import type { EditorViewport } from '../../render/editor/viewport';
import type { ProjectPanelHandle } from './panels/ProjectPanel';
import type { ToolbarHandle } from './panels/Toolbar';

export type EditorAppSaveArgs = {
  store: EditorStore;
  viewportRef: MutableRefObject<EditorViewport | null>;
  toolbarRef: RefObject<ToolbarHandle | null>;
  projectRef: RefObject<ProjectPanelHandle | null>;
};

export function useEditorAppSave(args: EditorAppSaveArgs) {
  const { store, viewportRef, toolbarRef, projectRef } = args;

const duplicateGlbNode = useCallback(
  (entityId: string, nodeUuid: string) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const nodeName = store.getGlbNodeName(entityId, nodeUuid);
    const transform = vp.getGlbNodePrefabTransform(entityId, nodeUuid);
    if (!nodeName || !transform) {
      showToast('Could not duplicate the model node — its transform is unavailable.', true);
      return;
    }
    if (!store.duplicateGlbNode(entityId, nodeName, transform)) {
      showToast('Could not duplicate the model node.', true);
    }
  },
  [store],
);

const duplicateSelection = useCallback(() => {
  const sub = store.getSubSelection();
  if (sub) {
    duplicateGlbNode(sub.entityId, sub.nodeUuid);
    return;
  }
  const selectedIds = store.getSelectedIds();
  if (selectedIds.length > 0) store.duplicateEntities(selectedIds);
}, [store, duplicateGlbNode]);

const extractGlbNode = useCallback(
  (entityId: string, nodeUuid: string, targetParentId: string | null): boolean => {
    const vp = viewportRef.current;
    if (!vp) return false;
    const transform = vp.getGlbNodePrefabTransform(entityId, nodeUuid, targetParentId);
    if (!transform) {
      showToast('Could not move the model node — its target transform is unavailable.', true);
      return false;
    }

    const tree = store.getGlbTree(entityId);
    const node = tree ? findGlbNodeRef(tree, nodeUuid) : null;
    const host = store.locate(entityId)?.entity;
    const adoptedChildren =
      node && host
        ? host.children.flatMap((child) => {
            if (!entityBoundToAnyGlbNode(child, collectGlbNodeNames(node))) return [];
            const relative = vp.getEntityTransformRelativeToGlbNode(
              entityId,
              nodeUuid,
              child.id,
            );
            if (!relative) return [];
            return [{ id: child.id, transform: relative }];
          })
        : [];

    if (!store.extractGlbNode(entityId, nodeUuid, targetParentId, transform, adoptedChildren)) {
      showToast('Could not move the model node out of its prefab.', true);
      return false;
    }
    return true;
  },
  [store],
);

const deleteSelection = useCallback(() => {
  const sub = store.getSubSelection();
  if (sub) {
    store.hideGlbNode(sub.entityId, sub.nodeUuid);
    return;
  }
  const selectedIds = store.getSelectedIds();
  if (selectedIds.length > 0) store.deleteEntities(selectedIds);
}, [store]);

const prefabListCacheRef = useRef<Awaited<ReturnType<typeof fetchPrefabList>> | null>(null);
const sceneListCacheRef = useRef<Awaited<ReturnType<typeof fetchSceneList>> | null>(null);
const planetListCacheRef = useRef<Awaited<ReturnType<typeof fetchPlanetList>> | null>(null);

const refreshPrefabList = useCallback(async () => {
  try {
    const prefabs = await fetchPrefabList();
    prefabListCacheRef.current = prefabs;
    toolbarRef.current?.setPrefabOptions(prefabs);
  } catch {
    // Dev API unavailable.
  }
}, []);

const refreshPrefabLibrary = useCallback(() => {
  void refreshPrefabList();
  void projectRef.current?.refresh();
}, [refreshPrefabList]);

const refreshSceneList = useCallback(async () => {
  try {
    const scenes = await fetchSceneList();
    sceneListCacheRef.current = scenes;
    toolbarRef.current?.setSceneOptions(scenes);
  } catch {
    // Dev API unavailable.
  }
}, []);

const refreshPlanetList = useCallback(async () => {
  try {
    const planets = await fetchPlanetList();
    planetListCacheRef.current = planets;
    toolbarRef.current?.setPlanetOptions(planets);
  } catch {
    const fallback = [{ id: 'asteron', name: 'Asteron' }];
    planetListCacheRef.current = fallback;
    toolbarRef.current?.setPlanetOptions(fallback);
  }
}, []);

const saveCurrent = useCallback(async (): Promise<string | null> => {
  const state = store.getState();
  const id = state.prefabId || slugifyPrefabName(state.prefabName);
  const isScene = state.documentType === 'scene';
  if (!id) {
    showToast(`Give the ${isScene ? 'scene' : 'prefab'} a name before saving.`, true);
    return null;
  }
  if (isScene && !SCENE_ID_PATTERN.test(id)) {
    showToast('Scene id must be a lowercase slug.', true);
    return null;
  }
  store.setDocumentMeta({ prefabId: id });
  try {
    if (isScene) {
      const doc = parseSceneDocument(toSceneDocument(store.getState()));
      if (!doc) {
        showToast('Scene document is invalid.', true);
        return null;
      }
      const path = await saveScene(doc);
      store.markSaved();
      rememberLastOpenedScene(id);
      showToast(`Saved ${path}`);
      void refreshSceneList();
      return id;
    }
    if (state.roots.length === 0) {
      showToast('Nothing to save — the prefab is empty.', true);
      return null;
    }
    const doc = parsePrefabDocument(toPrefabDocument(store.getState()));
    const path = await savePrefab(doc);
    store.markSaved();
    showToast(`Saved ${path}`);
    refreshPrefabLibrary();
    return id;
  } catch (error) {
    showToast(`Save failed: ${(error as Error).message}`, true);
    return null;
  }
}, [store, refreshPrefabLibrary, refreshSceneList]);

  return {
    duplicateGlbNode,
    duplicateSelection,
    extractGlbNode,
    deleteSelection,
    refreshPrefabList,
    refreshPrefabLibrary,
    refreshSceneList,
    refreshPlanetList,
    saveCurrent,
  };
}
