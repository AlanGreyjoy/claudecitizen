import type { ReactElement, ReactNode, RefObject } from 'react';
import type { EditorStore } from '../../../document';
import { showContextMenu } from '../../../dom';
import { entitySubtreeHasMatch } from '../../../panels/hierarchy-logic';
import { getComponentDef } from '../../../../world/prefabs/component-registry';
import type { PrefabComponentType } from '../../../../world/prefabs/schema';
import { EntityRow } from './HierarchyTreeRows';
import { hasActiveFilters, type TreeCtx } from './types';

export type HierarchyPanelViewProps = {
  store: EditorStore;
  ctx: TreeCtx;
  searchText: string;
  searchQuery: string;
  activeFilter: string;
  usedTypes: string[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  bodyRef: RefObject<HTMLDivElement | null>;
  setSearchText: (value: string) => void;
  setComponentFilter: (value: string) => void;
  autoExpandForFilters: (query: string, filter: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  addEmptyTo: (parentId: string | null) => void;
  addBoxTo: (parentId: string | null) => void;
};

export function HierarchyPanelView(props: HierarchyPanelViewProps): ReactElement {
  const {
    store,
    ctx,
    searchText,
    searchQuery,
    activeFilter,
    usedTypes,
    searchInputRef,
    bodyRef,
    setSearchText,
    setComponentFilter,
    autoExpandForFilters,
    expandAll,
    collapseAll,
    addEmptyTo,
    addBoxTo,
  } = props;

  const roots = store.getState().roots;
  const filtering = hasActiveFilters(searchQuery, activeFilter);
  const visibleRoots = filtering
    ? roots.filter((entity) =>
        entitySubtreeHasMatch(store, entity, searchQuery, activeFilter),
      )
    : roots;

  let bodyContent: ReactNode;
  if (roots.length === 0) {
    bodyContent = (
      <div className="ed-empty-note">
        Empty scene. Right-click or use the toolbar to add a Box / Empty, or drop assets
        from the Project panel.
      </div>
    );
  } else if (filtering && visibleRoots.length === 0) {
    const filterParts: string[] = [];
    if (searchQuery) filterParts.push(`search "${searchQuery}"`);
    if (activeFilter) {
      const label =
        getComponentDef(activeFilter as PrefabComponentType)?.label ?? activeFilter;
      filterParts.push(`component "${label}"`);
    }
    bodyContent = (
      <div className="ed-empty-note">
        No entities match {filterParts.join(' and ')}
      </div>
    );
  } else {
    bodyContent = (
      <div
        className="ed-tree"
        onDragOver={ctx.onTreeDragOver}
        onDrop={ctx.onTreeDrop}
      >
        {visibleRoots.map((entity) => (
          <EntityRow key={entity.id} ctx={ctx} entity={entity} depth={0} />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="ed-scene-tabs ed-panel-tabs">
        <button type="button" className="ed-scene-tab is-active" tabIndex={-1}>
          Hierarchy
        </button>
        <div className="ed-panel-title-actions">
          <button
            type="button"
            className="ed-btn"
            title="Expand all"
            aria-label="Expand all"
            onClick={expandAll}
          >
            ⊞
          </button>
          <button
            type="button"
            className="ed-btn"
            title="Collapse all"
            aria-label="Collapse all"
            onClick={collapseAll}
          >
            ⊟
          </button>
          <select
            className="ed-select ed-hierarchy-filter-select"
            title="Filter by component"
            aria-label="Filter by component"
            value={activeFilter}
            disabled={usedTypes.length === 0}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setComponentFilter(next);
              autoExpandForFilters(searchQuery, next);
            }}
          >
            <option value="">All components</option>
            {usedTypes.map((type) => (
              <option key={type} value={type}>
                {getComponentDef(type as PrefabComponentType)?.label ?? type}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="ed-hierarchy-search">
        <input
          ref={searchInputRef}
          className="ed-input ed-hierarchy-search-input"
          type="text"
          placeholder="Search..."
          spellCheck={false}
          autoComplete="off"
          value={searchText}
          onChange={(event) => {
            const nextText = event.currentTarget.value;
            setSearchText(nextText);
            autoExpandForFilters(nextText.toLowerCase().trim(), activeFilter);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setSearchText('');
              event.currentTarget.blur();
              autoExpandForFilters('', activeFilter);
            }
            event.stopPropagation();
          }}
        />
        <button
          type="button"
          className={`ed-hierarchy-search-clear${searchQuery ? ' is-visible' : ''}`}
          title="Clear search"
          onClick={() => {
            setSearchText('');
            autoExpandForFilters('', activeFilter);
            searchInputRef.current?.focus();
          }}
        >
          ×
        </button>
      </div>
      <div
        ref={bodyRef}
        className="ed-panel-body"
        onContextMenu={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('.ed-tree-row')) return;
          event.preventDefault();
          showContextMenu(event.clientX, event.clientY, [
            { label: 'Add Empty', action: () => addEmptyTo(null) },
            { label: 'Add Box', action: () => addBoxTo(null) },
          ]);
        }}
      >
        {bodyContent}
      </div>
    </>
  );
}
