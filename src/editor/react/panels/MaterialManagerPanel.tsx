import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { EditorStore } from '../../document';
import { collectRows, type MaterialRow } from '../../panels/material-manager';
import { useEditorStore } from '../hooks';

export type MaterialFocusTarget = {
  entityId: string;
  material: string;
  /** Bumps so re-clicking the same material re-scrolls. */
  nonce: number;
};

type MaterialManagerPanelProps = {
  store: EditorStore;
  selected?: MaterialFocusTarget | null;
  onSelectMaterial?: (target: MaterialFocusTarget) => void;
};

function materialRowKey(entityId: string, material: string): string {
  return `${entityId}:${material}`;
}

function MaterialRowView({
  row,
  selected,
  rowRef,
  onSelect,
}: {
  row: MaterialRow;
  selected: boolean;
  rowRef?: (node: HTMLButtonElement | null) => void;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      ref={rowRef}
      className={`ed-material-row${selected ? ' is-focused' : ''}`}
      data-material-key={materialRowKey(row.entity.id, row.material)}
      onClick={onSelect}
    >
      <span
        className="ed-material-swatch"
        title={`${row.values.color} · metal ${row.values.metalness} · rough ${row.values.roughness}`}
        style={{ background: row.values.color }}
      >
        {row.maps.length > 0 ? (
          <span className="ed-material-swatch-tex" title="Has texture maps" />
        ) : null}
      </span>
      <div className="ed-material-name">
        <span className="ed-material-title">{row.displayName}</span>
        <span className="ed-material-subtitle">
          {row.entity.name} · {row.source}
          {row.overridden ? ' · override' : ''}
        </span>
      </div>
    </button>
  );
}

export function MaterialManagerPanel({
  store,
  selected = null,
  onSelectMaterial,
}: MaterialManagerPanelProps): ReactElement {
  const version = useEditorStore(store, ['document', 'structure', 'entity']);
  const [rows, setRows] = useState<MaterialRow[] | null>(null);
  const generationRef = useRef(0);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const selectedKey = selected
    ? materialRowKey(selected.entityId, selected.material)
    : null;

  useEffect(() => {
    const current = ++generationRef.current;
    setRows(null);
    void collectRows(store).then((next) => {
      if (current !== generationRef.current) return;
      setRows(next);
    });
  }, [store, version]);

  useEffect(() => {
    if (!selectedKey) return;
    selectedRowRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selectedKey, selected?.nonce, rows]);

  const status =
    rows === null
      ? 'Loading'
      : `${rows.length} material${rows.length === 1 ? '' : 's'}`;

  return (
    <>
      <div className="ed-material-toolbar">
        <div className="ed-material-toolbar-title">Materials</div>
        <div className="ed-material-toolbar-status">{status}</div>
      </div>
      <div className="ed-material-list">
        {rows === null ? null : rows.length === 0 ? (
          <div className="ed-material-empty">No materials</div>
        ) : (
          rows.map((row) => {
            const key = materialRowKey(row.entity.id, row.material);
            const isSelected = selectedKey === key;
            return (
              <MaterialRowView
                key={`${key}:${row.source}`}
                row={row}
                selected={isSelected}
                rowRef={
                  isSelected
                    ? (node) => {
                        selectedRowRef.current = node;
                      }
                    : undefined
                }
                onSelect={() =>
                  onSelectMaterial?.({
                    entityId: row.entity.id,
                    material: row.material,
                    nonce: Date.now(),
                  })
                }
              />
            );
          })
        )}
      </div>
    </>
  );
}
