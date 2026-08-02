import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { renamePrefab } from '../../api';
import type { EditorStore } from '../../document';
import { showToast } from '../../dom';
import {
  PREFAB_ID_PATTERN,
  PREFAB_KIND_LABELS,
  PREFAB_KINDS,
  slugifyPrefabName,
  type PrefabKind,
} from '../../../world/prefabs/schema';

function stopKeyPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

type PrefabSettingsModalProps = {
  open: boolean;
  store: EditorStore;
  onClose: () => void;
  onRenamed?: () => void;
};

/**
 * Modal editor for File → Prefab Settings.
 *
 * Prefab identity lives here — id, display name, and kind. Changing the id of
 * a saved prefab renames the file and repoints project `prefabId` references.
 */
export function PrefabSettingsModal({
  open,
  store,
  onClose,
  onRenamed,
}: PrefabSettingsModalProps): ReactElement | null {
  const [draftKind, setDraftKind] = useState<PrefabKind>('station');
  const [draftName, setDraftName] = useState('');
  const [draftId, setDraftId] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [savedId, setSavedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Prefab Settings');
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    if (!open) return;
    const state = store.getState();
    setDraftKind(state.kind);
    setDraftName(state.prefabName);
    setDraftId(state.prefabId || slugifyPrefabName(state.prefabName));
    setOriginalName(state.prefabName);
    setSavedId(state.prefabId);
    setBusy(false);
    setStatus('Prefab Settings');
    setStatusError(false);
  }, [open, store]);

  if (!open) return null;

  const handleNameChange = (value: string): void => {
    setDraftName(value);
    if (!draftId || draftId === slugifyPrefabName(originalName)) {
      setDraftId(slugifyPrefabName(value));
    }
  };

  const handleApply = (): void => {
    void (async () => {
      const name = draftName.trim() || 'Untitled Prefab';
      const id = draftId.trim() || slugifyPrefabName(name);
      if (!PREFAB_ID_PATTERN.test(id)) {
        setStatus('Prefab id must be a lowercase slug (letters, digits, hyphens).');
        setStatusError(true);
        return;
      }

      // Never saved: no file to move — id is stamped at first Save.
      if (!savedId) {
        store.setDocumentMeta({
          prefabId: id,
          prefabName: name,
          kind: draftKind,
        });
        showToast('Prefab settings updated.');
        onClose();
        return;
      }

      if (id === savedId) {
        store.setDocumentMeta({ prefabName: name, kind: draftKind });
        showToast('Prefab settings updated.');
        onClose();
        return;
      }

      setBusy(true);
      try {
        const result = await renamePrefab(savedId, id, name);
        store.setDocumentMeta({
          prefabId: result.id,
          prefabName: name,
          kind: draftKind,
        });
        const renamedPath = result.absolutePath ?? result.path;
        showToast(
          result.rewritten.length > 0
            ? `Renamed to ${renamedPath} — repointed ${result.rewritten.length} document(s).`
            : `Renamed to ${renamedPath}.`,
        );
        onRenamed?.();
        onClose();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Rename failed.');
        setStatusError(true);
      } finally {
        setBusy(false);
      }
    })();
  };

  return createPortal(
    <div
      className="ed-dialog-overlay is-visible"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="ed-dialog ed-scene-settings-modal" role="dialog" aria-modal="true">
        <div className="ed-scene-settings-heading">Prefab Settings</div>
        <p className="ed-scene-settings-copy">
          Prefab identity and kind. The id is the filename stem and the id other
          documents reference.
        </p>
        <div className={`ed-system-status${statusError ? ' is-error' : ''}`}>{status}</div>
        <div className="ed-scene-settings-form">
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Prefab ID</span>
            <input
              className="ed-input"
              type="text"
              value={draftId}
              disabled={busy}
              onChange={(event) => setDraftId(slugifyPrefabName(event.target.value))}
              onKeyDown={stopKeyPropagation}
            />
            <span className="ed-scene-settings-detail">
              Stable filename and runtime identifier
              {savedId && draftId && draftId !== savedId
                ? ` — save renames "${savedId}.prefab.json".`
                : '.'}
            </span>
          </label>
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Name</span>
            <input
              className="ed-input"
              type="text"
              autoFocus
              value={draftName}
              disabled={busy}
              onChange={(event) => handleNameChange(event.target.value)}
              onKeyDown={(event) => {
                stopKeyPropagation(event);
                if (event.key === 'Enter' && !busy) handleApply();
              }}
            />
          </label>
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Kind</span>
            <select
              className="ed-input"
              value={draftKind}
              disabled={busy}
              onChange={(event) => setDraftKind(event.target.value as PrefabKind)}
              onKeyDown={stopKeyPropagation}
            >
              {PREFAB_KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {PREFAB_KIND_LABELS[entry]}
                </option>
              ))}
            </select>
            <span className="ed-scene-settings-detail">
              Filters the Add Component palette for this prefab.
            </span>
          </label>
        </div>
        <div className="ed-base-actions">
          <button
            type="button"
            className="ed-btn ed-btn-accent"
            disabled={busy}
            onClick={handleApply}
          >
            {busy ? 'Renaming…' : 'Apply'}
          </button>
          <button type="button" className="ed-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
