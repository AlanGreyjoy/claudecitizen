import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  PREFAB_KIND_LABELS,
  PREFAB_KINDS,
  type PrefabKind,
} from '../../../world/prefabs/schema';

function stopKeyPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

type NewPrefabModalProps = {
  open: boolean;
  onCancel: () => void;
  onCreate: (name: string, kind: PrefabKind) => void | Promise<void>;
};

/**
 * File → New Prefab. Name + kind up front so Save does not land as
 * `untitled-prefab.prefab.json`.
 */
export function NewPrefabModal({
  open,
  onCancel,
  onCreate,
}: NewPrefabModalProps): ReactElement | null {
  const [name, setName] = useState('Untitled Prefab');
  const [kind, setKind] = useState<PrefabKind>('placeable');

  useEffect(() => {
    if (!open) return;
    setName('Untitled Prefab');
    setKind('placeable');
  }, [open]);

  if (!open) return null;

  const create = (): void => {
    void onCreate(name.trim() || 'Untitled Prefab', kind);
  };

  return createPortal(
    <div
      className="ed-dialog-overlay is-visible"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="ed-dialog ed-new-scene-modal" role="dialog" aria-modal="true">
        <div className="ed-scene-settings-heading">New Prefab</div>
        <p className="ed-scene-settings-copy">
          Name the prefab and pick its kind. Kind filters which components you can add.
          Use Placeable for hangar/apartment Build Mode pieces.
        </p>
        <div className="ed-scene-settings-form">
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Name</span>
            <input
              className="ed-input"
              type="text"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                stopKeyPropagation(event);
                if (event.key === 'Enter') create();
              }}
            />
          </label>
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Kind</span>
            <select
              className="ed-input"
              value={kind}
              onChange={(event) => setKind(event.target.value as PrefabKind)}
              onKeyDown={stopKeyPropagation}
            >
              {PREFAB_KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {PREFAB_KIND_LABELS[entry]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ed-base-actions">
          <button type="button" className="ed-btn ed-btn-accent" onClick={create}>
            Create
          </button>
          <button type="button" className="ed-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
