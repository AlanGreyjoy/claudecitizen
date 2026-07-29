import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import type { EditorStore } from '../../document';
import { collectRows, type MaterialRow } from '../../panels/material-manager';
import { useEditorStore } from '../hooks';

export type MaterialFocusTarget = {
  entityId: string;
  material: string;
  /** Bumps so re-clicking the same material re-scrolls. */
  nonce: number;
};

export function materialRowKey(entityId: string, material: string): string {
  return `${entityId}:${material}`;
}

type MaterialManagerPanelProps = {
  store: EditorStore;
  selected?: MaterialFocusTarget | null;
  checkedKeys: ReadonlySet<string>;
  onCheckedKeysChange: (next: Set<string>) => void;
  onSelectMaterial?: (target: MaterialFocusTarget) => void;
};

function MaterialRowView({
  row,
  selected,
  checked,
  rowRef,
  onSelect,
  onCheckedChange,
}: {
  row: MaterialRow;
  selected: boolean;
  checked: boolean;
  rowRef?: (node: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onCheckedChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <div
      className={`ed-material-row${selected ? ' is-focused' : ''}${
        checked ? ' is-checked' : ''
      }`}
      data-material-key={materialRowKey(row.entity.id, row.material)}
    >
      <label
        className="ed-material-check"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={checked}
          aria-label={`Select ${row.displayName}`}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onCheckedChange(event.target.checked);
          }}
        />
      </label>
      <button
        type="button"
        ref={rowRef}
        className="ed-material-row-main"
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
    </div>
  );
}

export function MaterialManagerPanel({
  store,
  selected = null,
  checkedKeys,
  onCheckedKeysChange,
  onSelectMaterial,
}: MaterialManagerPanelProps): ReactElement {
  const version = useEditorStore(store, ['document', 'structure', 'entity']);
  const [rows, setRows] = useState<MaterialRow[] | null>(null);
  const generationRef = useRef(0);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const checkedKeysRef = useRef(checkedKeys);
  checkedKeysRef.current = checkedKeys;
  const selectedKey = selected
    ? materialRowKey(selected.entityId, selected.material)
    : null;

  useEffect(() => {
    const current = ++generationRef.current;
    setRows(null);
    void collectRows(store).then((next) => {
      if (current !== generationRef.current) return;
      setRows(next);
      const valid = new Set(
        next.map((row) => materialRowKey(row.entity.id, row.material)),
      );
      const previous = checkedKeysRef.current;
      let pruned = false;
      const kept = new Set<string>();
      for (const key of previous) {
        if (valid.has(key)) kept.add(key);
        else pruned = true;
      }
      if (pruned) onCheckedKeysChange(kept);
    });
  }, [store, version, onCheckedKeysChange]);

  useEffect(() => {
    if (!selectedKey) return;
    selectedRowRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selectedKey, selected?.nonce, rows]);

  const rowKeys =
    rows?.map((row) => materialRowKey(row.entity.id, row.material)) ?? [];
  const checkedVisibleCount = rowKeys.reduce(
    (count, key) => count + (checkedKeys.has(key) ? 1 : 0),
    0,
  );
  const allChecked = rowKeys.length > 0 && checkedVisibleCount === rowKeys.length;
  const someChecked = checkedVisibleCount > 0 && !allChecked;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someChecked;
  }, [someChecked]);

  const status =
    rows === null
      ? 'Loading'
      : `${rows.length} material${rows.length === 1 ? '' : 's'}${
          checkedVisibleCount > 0 ? ` · ${checkedVisibleCount} checked` : ''
        }`;

  return (
    <>
      <div className="ed-material-toolbar">
        <div className="ed-material-toolbar-start">
          <label className="ed-material-check" title="Select all materials">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allChecked}
              disabled={rows === null || rows.length === 0}
              aria-label="Select all materials"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                if (event.target.checked) {
                  onCheckedKeysChange(new Set(rowKeys));
                } else {
                  onCheckedKeysChange(new Set());
                }
              }}
            />
          </label>
          <div className="ed-material-toolbar-title">Materials</div>
        </div>
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
                checked={checkedKeys.has(key)}
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
                onCheckedChange={(nextChecked) => {
                  const next = new Set(checkedKeys);
                  if (nextChecked) next.add(key);
                  else next.delete(key);
                  onCheckedKeysChange(next);
                }}
              />
            );
          })
        )}
      </div>
    </>
  );
}
