import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { EditorStore } from '../../document';
import type { EditorViewport } from '../../../render/editor/viewport';
import {
  collectMaterialRowsForEntity,
  valuesToOverride,
  type MaterialRow,
  type MaterialValues,
} from '../../panels/material-manager';
import { findEntityById } from '../../panels/inspector-logic';
import { useEditorStore } from '../hooks';
import { EmptyNote } from './InspectorForm';
import { MaterialColorRow, MaterialSliderRow } from './MaterialFields';
import { MaterialPreviewStage } from './MaterialPreviewStage';
import type { MaterialFocusTarget } from './MaterialManagerPanel';

type MaterialInspectorPanelProps = {
  store: EditorStore;
  selection: MaterialFocusTarget | null;
  viewport: EditorViewport | null;
};

function useMaterialRow(
  store: EditorStore,
  selection: MaterialFocusTarget | null,
): MaterialRow | null | undefined {
  const version = useEditorStore(store, ['document', 'structure', 'entity']);
  const [row, setRow] = useState<MaterialRow | null | undefined>(undefined);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!selection) {
      setRow(null);
      return;
    }
    const entity = findEntityById(store.getState().roots, selection.entityId);
    if (!entity) {
      setRow(null);
      return;
    }
    const generation = ++generationRef.current;
    void collectMaterialRowsForEntity(entity)
      .then((rows) => {
        if (generation !== generationRef.current) return;
        setRow(rows.find((entry) => entry.material === selection.material) ?? null);
      })
      .catch(() => {
        if (generation !== generationRef.current) return;
        setRow(null);
      });
  }, [store, selection, version]);

  return row;
}

function MaterialHeader({ row }: { row: MaterialRow }): ReactElement {
  return (
    <div className="ed-material-head">
      <div className="ed-material-head-name" title={row.displayName}>
        {row.displayName}
      </div>
      <div className="ed-material-head-meta">
        <span title={row.entity.name}>{row.entity.name}</span>
        <span className="ed-material-dot">·</span>
        <span>{row.source}</span>
        {row.overridden ? (
          <span className="ed-material-badge">Override</span>
        ) : null}
      </div>
    </div>
  );
}

export function MaterialInspectorPanel({
  store,
  selection,
  viewport,
}: MaterialInspectorPanelProps): ReactElement {
  const row = useMaterialRow(store, selection);
  const [draft, setDraft] = useState<MaterialValues | null>(null);

  const entityId = row?.entity.id ?? null;
  const materialName = row?.material ?? null;
  const committed = row?.values ?? null;

  // A fresh committed value means the document caught up with the scrub (or an
  // undo moved it) — drop the draft so the panel follows the document again.
  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  // Never leave a scrub clone behind on the live entity when the selection
  // changes or the panel unmounts.
  useEffect(() => {
    if (!viewport || !entityId || !materialName) return;
    return () => viewport.setMaterialPreview(entityId, materialName, null);
  }, [viewport, entityId, materialName]);

  const scrub = useCallback(
    (next: MaterialValues) => {
      setDraft(next);
      if (!viewport || !entityId || !materialName) return;
      viewport.setMaterialPreview(
        entityId,
        materialName,
        valuesToOverride(materialName, next),
      );
    },
    [viewport, entityId, materialName],
  );

  const commit = useCallback(
    (next: MaterialValues) => {
      if (!entityId || !materialName) return;
      setDraft(next);
      viewport?.setMaterialPreview(entityId, materialName, null);
      store.setMaterialOverride(
        entityId,
        materialName,
        valuesToOverride(materialName, next),
      );
    },
    [store, viewport, entityId, materialName],
  );

  const values = draft ?? row?.values ?? null;

  return (
    <>
      <div className="ed-scene-tabs ed-panel-tabs">
        <button type="button" className="ed-scene-tab is-active" tabIndex={-1}>
          Material
        </button>
      </div>
      {selection == null ? (
        <EmptyNote>Select a material in Material Manager.</EmptyNote>
      ) : row === undefined ? (
        <EmptyNote>Loading material…</EmptyNote>
      ) : row == null || values == null ? (
        <EmptyNote>Material not found on this entity.</EmptyNote>
      ) : (
        <div className="ed-material-inspector">
          <MaterialPreviewStage
            values={values}
            source={row.sample}
            maps={row.maps}
          />
          <MaterialHeader row={row} />
          <div className="ed-section">
            <h3 className="ed-section-title">Surface</h3>
            <MaterialColorRow
              label="Base Color"
              value={values.color}
              onScrub={(color) => scrub({ ...values, color })}
              onCommit={(color) => commit({ ...values, color })}
            />
            <MaterialSliderRow
              label="Metallic"
              value={values.metalness}
              max={1}
              onScrub={(metalness) => scrub({ ...values, metalness })}
              onCommit={(metalness) => commit({ ...values, metalness })}
            />
            <MaterialSliderRow
              label="Roughness"
              value={values.roughness}
              max={1}
              onScrub={(roughness) => scrub({ ...values, roughness })}
              onCommit={(roughness) => commit({ ...values, roughness })}
            />
            <MaterialSliderRow
              label="Opacity"
              value={values.opacity}
              max={1}
              onScrub={(opacity) => scrub({ ...values, opacity })}
              onCommit={(opacity) => commit({ ...values, opacity })}
            />
          </div>
          <div className="ed-section">
            <h3 className="ed-section-title">Emission</h3>
            <MaterialColorRow
              label="Emissive"
              value={values.emissive}
              onScrub={(emissive) => scrub({ ...values, emissive })}
              onCommit={(emissive) => commit({ ...values, emissive })}
            />
            <MaterialSliderRow
              label="Power"
              value={values.emissiveIntensity}
              max={20}
              step={0.05}
              onScrub={(emissiveIntensity) => scrub({ ...values, emissiveIntensity })}
              onCommit={(emissiveIntensity) => commit({ ...values, emissiveIntensity })}
            />
            <div className="ed-material-inspector-actions">
              <button
                type="button"
                className="ed-btn"
                disabled={!row.overridden}
                title="Drop the override and go back to the asset's authored values"
                onClick={() => {
                  if (!entityId || !materialName) return;
                  viewport?.setMaterialPreview(entityId, materialName, null);
                  setDraft(row.base);
                  store.setMaterialOverride(entityId, materialName, null);
                }}
              >
                Reset Override
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
