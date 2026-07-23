import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { EditorStore } from '../../document';
import {
  clampMaterialNumber,
  collectRows,
  formatMaterialNumber,
  valuesToOverride,
  type MaterialRow,
  type MaterialValues,
} from '../../panels/material_manager';
import { useEditorStore } from '../hooks';

type MaterialManagerPanelProps = {
  store: EditorStore;
};

type NumberKey = 'metalness' | 'roughness' | 'opacity' | 'emissiveIntensity';
type ColorKey = 'color' | 'emissive';

function commitRow(store: EditorStore, row: MaterialRow, values: MaterialValues): void {
  store.setMaterialOverride(
    row.entity.id,
    row.material,
    valuesToOverride(row.material, values),
  );
}

function MaterialColorField({
  store,
  row,
  fieldKey,
}: {
  store: EditorStore;
  row: MaterialRow;
  fieldKey: ColorKey;
}): ReactElement {
  return (
    <input
      className="ed-material-color"
      type="color"
      value={row.values[fieldKey]}
      onChange={(event) => {
        commitRow(store, row, { ...row.values, [fieldKey]: event.currentTarget.value });
      }}
    />
  );
}

function MaterialNumberField({
  store,
  row,
  fieldKey,
  max,
}: {
  store: EditorStore;
  row: MaterialRow;
  fieldKey: NumberKey;
  max: number;
}): ReactElement {
  const commit = (raw: string): void => {
    commitRow(store, row, {
      ...row.values,
      [fieldKey]: clampMaterialNumber(Number(raw), 0, max),
    });
  };

  return (
    <input
      className="ed-input ed-material-number"
      type="number"
      min={0}
      max={max}
      step={0.01}
      defaultValue={formatMaterialNumber(row.values[fieldKey])}
      key={`${row.entity.id}:${row.material}:${fieldKey}:${formatMaterialNumber(row.values[fieldKey])}`}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function MaterialRowView({
  store,
  row,
}: {
  store: EditorStore;
  row: MaterialRow;
}): ReactElement {
  return (
    <div className="ed-material-row">
      <div className="ed-material-name">
        <span className="ed-material-title">{row.displayName}</span>
        <span className="ed-material-subtitle">
          {row.entity.name} · {row.source}
        </span>
      </div>
      <label className="ed-material-field">
        <span>Color</span>
        <MaterialColorField store={store} row={row} fieldKey="color" />
      </label>
      <label className="ed-material-field">
        <span>Metal</span>
        <MaterialNumberField store={store} row={row} fieldKey="metalness" max={1} />
      </label>
      <label className="ed-material-field">
        <span>Rough</span>
        <MaterialNumberField store={store} row={row} fieldKey="roughness" max={1} />
      </label>
      <label className="ed-material-field">
        <span>Alpha</span>
        <MaterialNumberField store={store} row={row} fieldKey="opacity" max={1} />
      </label>
      <label className="ed-material-field">
        <span>Glow</span>
        <MaterialColorField store={store} row={row} fieldKey="emissive" />
      </label>
      <label className="ed-material-field">
        <span>Power</span>
        <MaterialNumberField store={store} row={row} fieldKey="emissiveIntensity" max={20} />
      </label>
      <div className="ed-material-actions">
        <button
          type="button"
          className="ed-btn ed-material-reset"
          disabled={!row.overridden}
          onClick={() => store.setMaterialOverride(row.entity.id, row.material, null)}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

export function MaterialManagerPanel({
  store,
}: MaterialManagerPanelProps): ReactElement {
  const version = useEditorStore(store, ['document', 'structure', 'entity']);
  const [rows, setRows] = useState<MaterialRow[] | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const current = ++generationRef.current;
    setRows(null);
    void collectRows(store).then((next) => {
      if (current !== generationRef.current) return;
      setRows(next);
    });
  }, [store, version]);

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
          rows.map((row) => (
            <MaterialRowView
              key={`${row.entity.id}:${row.material}:${row.source}`}
              store={store}
              row={row}
            />
          ))
        )}
      </div>
    </>
  );
}
