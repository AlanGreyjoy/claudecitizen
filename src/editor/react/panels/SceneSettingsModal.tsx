import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { EditorStore } from '../../document';
import { showToast } from '../../dom';
import { SCENE_ID_PATTERN, SCENE_KINDS, type SceneKind } from '../../../world/scenes/schema';

function titleForKind(kind: SceneKind): string {
  return kind
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function stopKeyPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

type SceneSettingsModalProps = {
  open: boolean;
  store: EditorStore;
  onClose: () => void;
};

/**
 * Modal editor for File → Scene → Settings.
 *
 * Only scene identity lives here — id, name, and runtime kind. World config
 * (system, planet, spawn, placed prefabs) belongs to GameObjects in the
 * hierarchy via the Game Manager, Planet, Player Start, and Prefab Instance
 * components.
 */
export function SceneSettingsModal({
  open,
  store,
  onClose,
}: SceneSettingsModalProps): ReactElement | null {
  const [draftKind, setDraftKind] = useState<SceneKind>('main-game');
  const [draftName, setDraftName] = useState('');
  const [draftId, setDraftId] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [status, setStatus] = useState('Scene Settings');
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    if (!open) return;
    const state = store.getState();
    setDraftKind(state.sceneKind);
    setDraftName(state.prefabName);
    setDraftId(state.prefabId);
    setOriginalName(state.prefabName);
    setStatus('Scene Settings');
    setStatusError(false);
  }, [open, store]);

  if (!open) return null;

  const handleNameChange = (value: string): void => {
    setDraftName(value);
    if (!draftId || draftId === slugify(originalName)) {
      setDraftId(slugify(value));
    }
  };

  const handleApply = (): void => {
    if (!SCENE_ID_PATTERN.test(draftId) && draftId !== '') {
      setStatus('Scene id must be a lowercase slug.');
      setStatusError(true);
      return;
    }
    store.setDocumentMeta({
      prefabId: draftId,
      prefabName: draftName.trim() || 'Untitled Scene',
      sceneKind: draftKind,
    });
    showToast('Scene settings updated.');
    onClose();
  };

  return createPortal(
    <div
      className="ed-dialog-overlay is-visible"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ed-dialog ed-scene-settings-modal" role="dialog" aria-modal="true">
        <div className="ed-scene-settings-heading">Scene Settings</div>
        <p className="ed-scene-settings-copy">
          Scene identity and runtime kind. World config lives on GameObjects — add Game Manager,
          Planet, Player Start, or Prefab Instance components in the hierarchy.
        </p>
        <div className={`ed-system-status${statusError ? ' is-error' : ''}`}>{status}</div>
        <div className="ed-scene-settings-form">
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Scene ID</span>
            <input
              className="ed-input"
              type="text"
              value={draftId}
              onChange={(event) => setDraftId(slugify(event.target.value))}
              onKeyDown={stopKeyPropagation}
            />
            <span className="ed-scene-settings-detail">Stable filename and runtime identifier.</span>
          </label>
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Name</span>
            <input
              className="ed-input"
              type="text"
              value={draftName}
              onChange={(event) => handleNameChange(event.target.value)}
              onKeyDown={stopKeyPropagation}
            />
          </label>
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Runtime</span>
            <select
              className="ed-input"
              value={draftKind}
              onChange={(event) => setDraftKind(event.target.value as SceneKind)}
              onKeyDown={stopKeyPropagation}
            >
              {SCENE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {titleForKind(kind)}
                </option>
              ))}
            </select>
            <span className="ed-scene-settings-detail">
              Selects how the scene host launches this scene.
            </span>
          </label>
        </div>
        <div className="ed-base-actions">
          <button type="button" className="ed-btn ed-btn-accent" onClick={handleApply}>
            Apply
          </button>
          <button type="button" className="ed-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
