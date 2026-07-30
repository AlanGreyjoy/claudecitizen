import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { ENTITY_DND_TYPE, PREFAB_DND_TYPE } from '../../../api';
import type { EditorEntity, EditorStore, GlbNodeRef } from '../../../document';
import { showContextMenu } from '../../../dom';
import {
  entitySubtreeHasMatch,
  getAllGlbNodeNames,
  getBoundEntitiesForNode,
  GLB_NODE_DND_TYPE,
  glbExpandKey,
  glbSelectionKey,
  glbSubtreeHasMatch,
  glbTarget,
  isEntityBoundToGlb,
} from '../../../panels/hierarchy-logic';
import { UiIcons } from '../../../../ui/icons';
import { UiIcon } from '../../UiIcon';
import { hasActiveFilters, type TreeCtx } from './types';

function Chevron({ expanded, muted = false }: { expanded: boolean; muted?: boolean }): ReactElement {
  return (
    <UiIcon
      icon={expanded ? UiIcons.chevronDown : UiIcons.chevronRight}
      className={muted ? 'ed-ui-icon ed-ui-icon-muted' : 'ed-ui-icon'}
      size={muted ? 12 : 14}
      strokeWidth={2}
    />
  );
}


function GlbNodeRow({
  ctx,
  entityId,
  node,
  depth,
  parentHidden = false,
}: {
  ctx: TreeCtx;
  entityId: string;
  node: GlbNodeRef;
  depth: number;
  parentHidden?: boolean;
}): ReactElement | null {
  const { store } = ctx;
  const isHidden = parentHidden || store.isGlbNodeHidden(entityId, node.name);
  if (isHidden) return null;

  const bound = getBoundEntitiesForNode(store, entityId, node.name);
  const filtering = hasActiveFilters(ctx.searchQuery, ctx.componentFilter);

  // Hide identity single-child export/loader wrappers; keep live graph intact.
  if (node.passthrough) {
    return (
      <>
        {node.children
          .filter(
            (child) =>
              !filtering ||
              glbSubtreeHasMatch(
                store,
                entityId,
                child,
                ctx.searchQuery,
                ctx.componentFilter,
              ),
          )
          .map((child) => (
            <GlbNodeRow
              key={child.uuid}
              ctx={ctx}
              entityId={entityId}
              node={child}
              depth={depth}
              parentHidden={isHidden}
            />
          ))}
        {bound
          .filter(
            (boundEntity) =>
              !filtering ||
              entitySubtreeHasMatch(
                store,
                boundEntity,
                ctx.searchQuery,
                ctx.componentFilter,
              ),
          )
          .map((boundEntity) => (
            <EntityRow
              key={boundEntity.id}
              ctx={ctx}
              entity={boundEntity}
              depth={depth}
            />
          ))}
      </>
    );
  }

  const sub = store.getSubSelection();
  const selected = sub?.entityId === entityId && sub.nodeUuid === node.uuid;
  const target = glbTarget(entityId, node);
  const inSelection = ctx.selectedGlbNodes.has(glbSelectionKey(entityId, node.uuid));
  ctx.visibleGlbNodes.push(target);

  const hasChildren = node.children.length > 0 || bound.length > 0;
  const expanded = ctx.expand.expandedGlbNodes.has(glbExpandKey(entityId, node.name));
  const rowClass = `ed-tree-row ed-tree-row-glb${selected ? ' is-selected' : ''}${inSelection && !selected ? ' is-in-selection' : ''}`;

  return (
    <>
      <div
        className={rowClass}
        draggable
        data-glb-uuid={node.uuid}
        data-entity-id={entityId}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={(event) => ctx.handleGlbNodeClick(event, target)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showContextMenu(
            event.clientX,
            event.clientY,
            ctx.glbMenuEntries(entityId, node, ctx.prepareGlbContextSelection(target)),
          );
        }}
        onDragStart={(event) => {
          event.dataTransfer?.setData(
            GLB_NODE_DND_TYPE,
            JSON.stringify({ entityId, nodeUuid: node.uuid }),
          );
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={`ed-tree-chevron${expanded ? ' is-expanded' : ''}`}
            title={expanded ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation();
              ctx.toggleGlbNodeExpanded(entityId, node.name, node.uuid);
            }}
          >
            <Chevron expanded={expanded} />
          </button>
        ) : (
          <span className="ed-tree-chevron-spacer" />
        )}
        <span className="ed-tree-name ed-tree-name-glb" title={node.name}>
          {node.name}
        </span>
      </div>
      {hasChildren && expanded
        ? [
            ...node.children
              .filter(
                (child) =>
                  !filtering ||
                  glbSubtreeHasMatch(
                    store,
                    entityId,
                    child,
                    ctx.searchQuery,
                    ctx.componentFilter,
                  ),
              )
              .map((child) => (
                <GlbNodeRow
                  key={child.uuid}
                  ctx={ctx}
                  entityId={entityId}
                  node={child}
                  depth={depth + 1}
                  parentHidden={isHidden}
                />
              )),
            ...bound
              .filter(
                (boundEntity) =>
                  !filtering ||
                  entitySubtreeHasMatch(
                    store,
                    boundEntity,
                    ctx.searchQuery,
                    ctx.componentFilter,
                  ),
              )
              .map((boundEntity) => (
                <EntityRow
                  key={boundEntity.id}
                  ctx={ctx}
                  entity={boundEntity}
                  depth={depth + 1}
                />
              )),
          ]
        : null}
    </>
  );
}

function entityRowClassName(
  selected: boolean,
  inSelection: boolean,
  parentSelected: boolean,
  isDropTarget: boolean,
  isPrefabInstance: boolean,
): string {
  return `ed-tree-row${selected ? ' is-selected' : ''}${inSelection && !selected ? ' is-in-selection' : ''}${parentSelected ? ' is-parent-selected' : ''}${isDropTarget ? ' is-drop-target' : ''}${isPrefabInstance ? ' is-prefab-instance' : ''}`;
}

function isPrefabInstanceEntity(entity: EditorEntity): boolean {
  return entity.components.some((component) => component.type === 'prefab-instance');
}

function EntityRowName({
  ctx,
  entity,
}: {
  ctx: TreeCtx;
  entity: EditorEntity;
}): ReactNode {
  if (ctx.renaming === entity.id) {
    return (
      <input
        className="ed-input ed-tree-rename"
        type="text"
        defaultValue={entity.name}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          ctx.setRenaming(null);
          ctx.store.renameEntity(
            entity.id,
            event.currentTarget.value.trim() || entity.name,
          );
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') ctx.setRenaming(null);
          event.stopPropagation();
        }}
      />
    );
  }
  const prefab = isPrefabInstanceEntity(entity);
  return (
    <span
      className={`ed-tree-name${entity.visible ? '' : ' is-hidden-entity'}${prefab ? ' is-prefab-instance' : ''}`}
      title={prefab ? 'Prefab instance' : undefined}
    >
      {entity.name}
    </span>
  );
}

function shouldShowEntityGlbSubtree(
  entity: EditorEntity,
  glbTree: GlbNodeRef | null,
  ctx: TreeCtx,
  store: EditorStore,
): boolean {
  if (!entity.asset || !glbTree) return false;
  const filtering = hasActiveFilters(ctx.searchQuery, ctx.componentFilter);
  if (!filtering) return true;
  return glbSubtreeHasMatch(store, entity.id, glbTree, ctx.searchQuery, ctx.componentFilter);
}

function filterEntityRowChildren(
  children: EditorEntity[],
  glbNodeNames: Set<string>,
  ctx: TreeCtx,
  store: EditorStore,
): EditorEntity[] {
  const filtering = hasActiveFilters(ctx.searchQuery, ctx.componentFilter);
  return children.filter((child) => {
    if (isEntityBoundToGlb(child, glbNodeNames)) return false;
    if (filtering && !entitySubtreeHasMatch(store, child, ctx.searchQuery, ctx.componentFilter)) {
      return false;
    }
    return true;
  });
}

function EntityRow({
  ctx,
  entity,
  depth,
}: {
  ctx: TreeCtx;
  entity: EditorEntity;
  depth: number;
}): ReactElement {
  const { store } = ctx;
  ctx.visibleEntityIds.push(entity.id);

  const glbTree = store.getGlbTree(entity.id);
  const glbNodeNames = getAllGlbNodeNames(glbTree);
  const hasChildren = entity.children.length > 0 || Boolean(entity.asset && glbTree);
  const expanded = !ctx.expand.collapsedEntities.has(entity.id);
  const selection = store.getSelection();
  const sub = store.getSubSelection();
  const inSelection = store.isEntitySelected(entity.id);
  const selected = selection === entity.id && !sub;
  const parentSelected =
    selection === entity.id && Boolean(sub) && sub?.entityId === entity.id;
  const isDropTarget = ctx.dropTargetId === entity.id;
  const isPrefabInstance = isPrefabInstanceEntity(entity);

  return (
    <>
      <div
        className={entityRowClassName(
          selected,
          inSelection,
          parentSelected,
          isDropTarget,
          isPrefabInstance,
        )}
        draggable
        data-entity-id={entity.id}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={(event) => ctx.handleEntityClick(event, entity.id)}
        onDoubleClick={() => ctx.beginRename(entity.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!store.isEntitySelected(entity.id)) {
            store.setSelection(entity.id);
            ctx.setRangeAnchorId(entity.id);
          }
          showContextMenu(event.clientX, event.clientY, ctx.entityMenuEntries(entity));
        }}
        onDragStart={(event) => {
          const ids = store.isEntitySelected(entity.id)
            ? store.getSelectedIds()
            : [entity.id];
          event.dataTransfer?.setData(ENTITY_DND_TYPE, JSON.stringify(ids));
        }}
        onDragOver={(event) => {
          const supportsEntity = event.dataTransfer?.types.includes(ENTITY_DND_TYPE);
          const supportsPrefab = event.dataTransfer?.types.includes(PREFAB_DND_TYPE);
          const supportsGlbNode =
            event.dataTransfer?.types.includes(GLB_NODE_DND_TYPE) && ctx.canAcceptGlbDrop;
          if (!supportsEntity && !supportsPrefab && !supportsGlbNode) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          ctx.setDropTargetId(entity.id);
        }}
        onDragLeave={() => {
          if (ctx.dropTargetId === entity.id) ctx.setDropTargetId(null);
        }}
        onDrop={(event) => ctx.onEntityDrop(event, entity.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            className={`ed-tree-chevron${expanded ? ' is-expanded' : ''}`}
            title={expanded ? 'Collapse' : 'Expand'}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation();
              ctx.toggleEntityCollapsed(entity.id);
            }}
          >
            <Chevron expanded={expanded} />
          </button>
        ) : (
          <span className="ed-tree-chevron-spacer" />
        )}
        <EntityRowName ctx={ctx} entity={entity} />
      </div>
      {expanded ? (
        <>
          {shouldShowEntityGlbSubtree(entity, glbTree, ctx, store) && glbTree ? (
            <GlbNodeRow ctx={ctx} entityId={entity.id} node={glbTree} depth={depth + 1} />
          ) : null}
          {filterEntityRowChildren(entity.children, glbNodeNames, ctx, store).map((child) => (
            <EntityRow key={child.id} ctx={ctx} entity={child} depth={depth + 1} />
          ))}
        </>
      ) : null}
    </>
  );
}

export { EntityRow };
