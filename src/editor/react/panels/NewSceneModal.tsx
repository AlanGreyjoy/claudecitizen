import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  SCENE_TEMPLATES,
  type SceneTemplateId,
} from '../../../world/scenes/templates';

function stopKeyPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

type NewSceneModalProps = {
  open: boolean;
  onCancel: () => void;
  onCreate: (templateId: SceneTemplateId, name: string) => void | Promise<void>;
};

/**
 * File -> New Scene. A scene no longer arrives with Game Manager, Planet and
 * Player Start forced on it; the template decides, and Empty is the default.
 */
export function NewSceneModal({
  open,
  onCancel,
  onCreate,
}: NewSceneModalProps): ReactElement | null {
  const [templateId, setTemplateId] = useState<SceneTemplateId>('empty');
  const [name, setName] = useState('Untitled Scene');

  useEffect(() => {
    if (!open) return;
    setTemplateId('empty');
    setName('Untitled Scene');
  }, [open]);

  if (!open) return null;

  const create = (): void => {
    void onCreate(templateId, name.trim() || 'Untitled Scene');
  };

  return createPortal(
    <div
      className="ed-dialog-overlay is-visible"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="ed-dialog ed-new-scene-modal" role="dialog" aria-modal="true">
        <div className="ed-scene-settings-heading">New Scene</div>
        <p className="ed-scene-settings-copy">
          Pick what the scene starts with. You can add or remove any GameObject afterwards.
        </p>
        <div className="ed-new-scene-templates">
          {SCENE_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className={`ed-new-scene-template${
                template.id === templateId ? ' is-active' : ''
              }`}
              aria-pressed={template.id === templateId}
              onClick={() => setTemplateId(template.id)}
              onDoubleClick={create}
            >
              <span className="ed-new-scene-template-body">
                <span className="ed-new-scene-template-label">{template.label}</span>
                <span className="ed-new-scene-template-detail">{template.description}</span>
              </span>
            </button>
          ))}
        </div>
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
