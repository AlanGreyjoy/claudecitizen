import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { renamePrefab } from '../../api';
import { showToast } from '../../dom';
import type { EditorStore } from '../../document';
import {
  PREFAB_KIND_LABELS,
  PREFAB_KINDS,
  slugifyPrefabName,
  type PrefabKind,
} from '../../../world/prefabs/schema';
import { useEditorStore } from '../hooks';

export type PrefabBarProps = {
  store: EditorStore;
  hidden: boolean;
  onOpenSettings: () => void;
  onSave: () => void;
  onOpenShipTab?: () => void;
  onRenamed?: () => void;
  /** Item prefabs: spawn preview weapons on equipment-socket empties. */
  onSocketWeaponPreviewChange?: (enabled: boolean) => void;
};

/**
 * Thin Scene-tab chrome while a prefab document is open. Same role as the Ship
 * bar (identity + save), without ship-only validate/test controls.
 */
function documentHasEquipmentSockets(store: EditorStore): boolean {
  const visit = (entities: ReturnType<EditorStore['getState']>['roots']): boolean => {
    for (const entity of entities) {
      if (entity.components.some((component) => component.type === 'equipment-socket')) {
        return true;
      }
      if (visit(entity.children)) return true;
    }
    return false;
  };
  return visit(store.getState().roots);
}

export function PrefabBar({
  store,
  hidden,
  onOpenSettings,
  onSave,
  onOpenShipTab,
  onRenamed,
  onSocketWeaponPreviewChange,
}: PrefabBarProps): ReactElement | null {
  useEditorStore(store, ['document', 'structure']);
  const docState = store.getState();
  const isPrefab = docState.documentType === 'prefab';
  const openId = isPrefab ? docState.prefabId : '';

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [socketPreview, setSocketPreview] = useState(false);

  useEffect(() => {
    setNameDraft(null);
    setSocketPreview(false);
    onSocketWeaponPreviewChange?.(false);
  }, [openId]);

  const commitName = useCallback(async () => {
    const draft = nameDraft;
    setNameDraft(null);
    if (draft === null) return;
    const state = store.getState();
    if (state.documentType !== 'prefab') return;
    const name = draft.trim();
    if (!name || name === state.prefabName) return;

    if (!state.prefabId) {
      const id = slugifyPrefabName(name);
      store.setPrefabMeta(id ? { prefabName: name, prefabId: id } : { prefabName: name });
      return;
    }
    const toId = slugifyPrefabName(name);
    if (!toId) {
      showToast('That name slugs to nothing — pick another.', true);
      return;
    }
    if (toId === state.prefabId) {
      store.setPrefabMeta({ prefabName: name });
      return;
    }

    setRenaming(true);
    try {
      const result = await renamePrefab(state.prefabId, toId, name);
      store.setPrefabMeta({ prefabId: result.id, prefabName: name });
      const renamedPath = result.absolutePath ?? result.path;
      showToast(
        result.rewritten.length > 0
          ? `Renamed to ${renamedPath} — repointed ${result.rewritten.length} document(s).`
          : `Renamed to ${renamedPath}.`,
      );
      onRenamed?.();
    } catch (error) {
      showToast(
        `Rename failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        true,
      );
    } finally {
      setRenaming(false);
    }
  }, [nameDraft, store, onRenamed]);

  if (hidden || !isPrefab) return null;

  const slugPreview =
    slugifyPrefabName(nameDraft ?? docState.prefabName) || docState.prefabId || 'untitled';

  return (
    <div className="ed-prefab-bar" role="toolbar" aria-label="Prefab">
      <div className="ed-ship-group">
        <label className="ed-prefab-bar-field">
          <span className="ed-prefab-bar-label">Kind</span>
          <select
            className="ed-select ed-prefab-kind"
            value={docState.kind}
            aria-label="Prefab kind"
            disabled={renaming}
            onChange={(event) => {
              const kind = event.target.value as PrefabKind;
              store.setPrefabMeta({ kind });
              if (kind === 'ship') {
                showToast('Ship kind set — use Ship tab for validate and playtest.');
              }
            }}
          >
            {PREFAB_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {PREFAB_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="ed-prefab-bar-field">
          <span className="ed-prefab-bar-label">Name</span>
          <input
            type="text"
            className="ed-input ed-ship-name"
            value={nameDraft ?? docState.prefabName}
            placeholder="Prefab name"
            disabled={renaming}
            aria-label="Prefab name"
            title={
              openId
                ? `Renames the file to "${slugPreview}.prefab.json" and repoints project references.`
                : `Saved as "${slugPreview}.prefab.json".`
            }
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              else if (event.key === 'Escape') setNameDraft(null);
            }}
          />
        </label>
        <button type="button" className="ed-btn" onClick={onOpenSettings} disabled={renaming}>
          Settings…
        </button>
        <button type="button" className="ed-btn" onClick={onSave} disabled={renaming}>
          Save
        </button>
      </div>

      <span className="ed-ship-hint" title="Prefab id / filename stem">
        {slugPreview}.prefab.json
      </span>

      {docState.kind === 'ship' && onOpenShipTab ? (
        <div className="ed-ship-group ed-ship-test">
          <button
            type="button"
            className="ed-btn ed-btn-accent"
            onClick={onOpenShipTab}
            title="Ship tab has validate + pad/planet playtest"
          >
            Ship tab →
          </button>
        </div>
      ) : null}

      {docState.kind === 'item' &&
      onSocketWeaponPreviewChange &&
      documentHasEquipmentSockets(store) ? (
        <div className="ed-ship-group ed-ship-test">
          <button
            type="button"
            className={`ed-btn${socketPreview ? ' is-active' : ''}`}
            title="Spawn catalog/fallback weapons on each equipment-socket. Select a socket and rotate/move it."
            onClick={() => {
              const next = !socketPreview;
              setSocketPreview(next);
              onSocketWeaponPreviewChange(next);
            }}
          >
            {socketPreview ? 'Hide socket weapons' : 'Preview weapons on sockets'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
