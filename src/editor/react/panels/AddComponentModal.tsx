import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import {
  addComponentFromPalette,
  collectExistingComponentTypes,
  shouldHideShipHullCollider,
} from '../../component-actions';
import type { EditorEntity, EditorStore } from '../../document';
import { showToast } from '../../dom';
import type { InspectorPanelOptions } from '../../panels/inspector-logic';
import {
  COMPONENT_CATEGORIES,
  COMPONENT_FAVORITES,
  searchComponents,
  type ComponentCategory,
  type ComponentDef,
} from '../../../world/prefabs/component-registry';

type TabId = 'all' | 'favorites' | ComponentCategory;

function stopKeyPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

type FavoriteRow = {
  def: ComponentDef;
  label: string;
};

type AddComponentModalProps = {
  open: boolean;
  store: EditorStore;
  entity: EditorEntity;
  options: InspectorPanelOptions;
  onClose: () => void;
};

export function AddComponentModal({
  open,
  store,
  entity,
  options,
  onClose,
}: AddComponentModalProps): ReactElement | null {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabId>('favorites');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTab('favorites');
    setHighlighted(0);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.querySelector<HTMLElement>(
      '.ed-add-component-item.is-highlighted',
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted, query, tab]);

  if (!open) return null;

  let palette = searchComponents(
    query,
    store.getState().kind,
    collectExistingComponentTypes(store),
    { documentType: store.getState().documentType },
  );
  // Favorites keep Collider even on ship hulls (where All/Structure hide it until
  // a GLB node is sub-selected). Click still requires a node — see addComponent.
  const favoriteRows: FavoriteRow[] = COMPONENT_FAVORITES.flatMap((favorite) => {
    const def = palette.find((entry) => entry.type === favorite.type);
    if (!def) return [];
    return [{ def, label: favorite.label }];
  });
  if (shouldHideShipHullCollider(store, entity)) {
    palette = palette.filter((def) => def.type !== 'collider');
  }

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'favorites', label: 'Favorites' },
    { id: 'all', label: 'All' },
    ...COMPONENT_CATEGORIES.filter((category) =>
      palette.some((def) => def.category === category.id),
    ),
  ];
  const activeTab = tabs.some((entry) => entry.id === tab) ? tab : 'favorites';
  // Typing searches the whole palette. The dialog opens on Favorites, which is
  // a fixed three-entry shortlist, so scoping the query to it made every search
  // for anything else come back empty.
  const searching = query.trim().length > 0;
  const results: FavoriteRow[] =
    searching || activeTab === 'all'
      ? palette.map((def) => ({ def, label: def.label }))
      : activeTab === 'favorites'
        ? favoriteRows
        : palette
            .filter((def) => def.category === activeTab)
            .map((def) => ({ def, label: def.label }));
  const safeHighlight = Math.min(highlighted, Math.max(0, results.length - 1));

  const addComponent = (def: ComponentDef): void => {
    if (def.type === 'collider' && shouldHideShipHullCollider(store, entity)) {
      showToast(
        'Select a GLB node (RampParent, floors, doors…) to add a walk collider.',
        true,
      );
      return;
    }
    const sub = store.getSubSelection();
    const nodeBounds =
      sub && sub.entityId === entity.id && options.getGlbNodeBounds
        ? () => options.getGlbNodeBounds!(entity.id, sub.nodeUuid)
        : undefined;
    addComponentFromPalette(
      store,
      entity.id,
      def,
      nodeBounds ? { getNodeBounds: nodeBounds } : undefined,
    );
    onClose();
  };

  const selectTab = (next: TabId): void => {
    setTab(next);
    setHighlighted(0);
  };

  return createPortal(
    <div
      className="ed-dialog-overlay is-visible"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="ed-dialog ed-add-component-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add Component"
      >
        <div className="ed-dialog-title">Add Component</div>
        <input
          ref={inputRef}
          className="ed-input ed-add-component-search"
          type="text"
          placeholder="Search components…"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setHighlighted(0);
          }}
          onKeyDown={(event) => {
            stopKeyPropagation(event);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (results.length > 0) {
                setHighlighted((prev) => (prev + 1) % results.length);
              }
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (results.length > 0) {
                setHighlighted(
                  (prev) => (prev - 1 + results.length) % results.length,
                );
              }
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const row = results[safeHighlight];
              if (row) addComponent(row.def);
            }
          }}
        />
        <div className="ed-add-component-tabs" role="tablist">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === activeTab}
              className={`ed-add-component-tab${
                entry.id === activeTab ? ' is-active' : ''
              }`}
              onClick={() => selectTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="ed-add-component-list" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <div className="ed-add-component-empty">No matching components</div>
          ) : (
            results.map((row, index) => (
              <button
                key={row.def.registryKey ?? row.def.type}
                type="button"
                role="option"
                aria-selected={index === safeHighlight}
                className={`ed-add-component-item${
                  index === safeHighlight ? ' is-highlighted' : ''
                }`}
                onClick={() => addComponent(row.def)}
                onMouseEnter={() => setHighlighted(index)}
              >
                <span className="ed-add-component-item-head">
                  <span className="ed-add-component-item-label">{row.label}</span>
                  <span className="ed-add-component-item-type">{row.def.type}</span>
                </span>
                {row.def.hint ? (
                  <span className="ed-add-component-item-hint">{row.def.hint}</span>
                ) : null}
              </button>
            ))
          )}
        </div>        <div className="ed-dialog-actions">
          <button type="button" className="ed-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
