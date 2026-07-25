import type { DragEvent, MouseEvent } from 'react';
import type { GlbNodeColliderTarget } from '../../../component-actions';
import type { EditorEntity, EditorStore, GlbNodeRef } from '../../../document';
import type { ContextMenuEntry } from '../../../dom';

export const STORE_EVENTS = [
  'structure',
  'document',
  'selection',
  'sub-selection',
  'glb-tree',
  'glb-visibility',
  'glb-components',
  'entity',
] as const;

export type ExpandState = {
  collapsedEntities: Set<string>;
  expandedGlbNodes: Set<string>;
};

export type TreeCtx = {
  store: EditorStore;
  searchQuery: string;
  componentFilter: string;
  renaming: string | null;
  expand: ExpandState;
  selectedGlbNodes: Map<string, GlbNodeColliderTarget>;
  visibleEntityIds: string[];
  visibleGlbNodes: GlbNodeColliderTarget[];
  dropTargetId: string | null;
  beginRename: (entityId: string) => void;
  setRenaming: (entityId: string | null) => void;
  toggleEntityCollapsed: (entityId: string) => void;
  toggleGlbNodeExpanded: (entityId: string, nodeName: string, nodeUuid: string) => void;
  handleEntityClick: (event: MouseEvent, entityId: string) => void;
  handleGlbNodeClick: (event: MouseEvent, target: GlbNodeColliderTarget) => void;
  prepareGlbContextSelection: (target: GlbNodeColliderTarget) => GlbNodeColliderTarget[];
  entityMenuEntries: (entity: EditorEntity) => ContextMenuEntry[];
  glbMenuEntries: (
    entityId: string,
    node: GlbNodeRef,
    targets: GlbNodeColliderTarget[],
  ) => ContextMenuEntry[];
  onEntityDrop: (event: DragEvent, parentId: string) => void;
  onTreeDrop: (event: DragEvent) => void;
  onTreeDragOver: (event: DragEvent) => void;
  setDropTargetId: (id: string | null) => void;
  canAcceptGlbDrop: boolean;
  setRangeAnchorId: (entityId: string) => void;
};

export function hasActiveFilters(searchQuery: string, componentFilter: string): boolean {
  return Boolean(searchQuery || componentFilter);
}
