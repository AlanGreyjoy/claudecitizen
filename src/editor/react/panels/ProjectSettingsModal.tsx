import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchProjectSettings,
  fetchSceneList,
  saveProjectSettings,
  type ProjectSettingsDocument,
  type SceneListEntry,
} from '../../api';
import { showToast } from '../../dom';
import { setRuntimeBackendUrl } from '../../../net/runtime-config';

function stopKeyPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

type ProjectSettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * File → Project Settings. Owns `asteron.project.json`: the deployed backend
 * this project talks to, the scene the game boots into, and the Build Web
 * output directory.
 */
export function ProjectSettingsModal({
  open,
  onClose,
}: ProjectSettingsModalProps): ReactElement | null {
  const [draft, setDraft] = useState<ProjectSettingsDocument | null>(null);
  const [scenes, setScenes] = useState<SceneListEntry[]>([]);
  const [status, setStatus] = useState('Project Settings');
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setScenes([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const settings = await fetchProjectSettings();
        if (cancelled) return;
        setDraft(settings);
        setStatus('Project Settings');
        setStatusError(false);

        try {
          const list = await fetchSceneList();
          if (!cancelled) setScenes(list);
        } catch {
          // Scene list is a convenience; the field falls back to the saved value.
        }
      } catch (error) {
        if (cancelled) return;
        showToast(
          error instanceof Error ? error.message : 'Could not read project settings.',
          true,
        );
        onClose();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, onClose]);

  if (!open || !draft) return null;

  const sceneEntries =
    scenes.length > 0 ? scenes : [{ id: draft.defaultScene, name: draft.defaultScene }];

  const handleSave = async (): Promise<void> => {
    try {
      const saved = await saveProjectSettings(draft);
      setRuntimeBackendUrl(saved.backendUrl);
      showToast('Project settings saved.');
      onClose();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Could not save project settings.',
      );
      setStatusError(true);
    }
  };

  return createPortal(
    <div
      className="ed-dialog-overlay is-visible"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ed-dialog ed-scene-settings-modal" role="dialog" aria-modal="true">
        <div className="ed-scene-settings-heading">Project Settings</div>
        <p className="ed-scene-settings-copy">
          Applies to this project and to the release that File → Build Web produces. Players sign
          in with their own accounts, so no key is stored here.
        </p>
        <div className={`ed-system-status${statusError ? ' is-error' : ''}`}>{status}</div>
        <div className="ed-scene-settings-form">
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Project Name</span>
            <input
              className="ed-input"
              type="text"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              onKeyDown={stopKeyPropagation}
            />
          </label>
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Backend URL</span>
            <input
              className="ed-input"
              type="text"
              value={draft.backendUrl}
              placeholder="https://api.example.com"
              onChange={(event) => setDraft({ ...draft, backendUrl: event.target.value })}
              onKeyDown={stopKeyPropagation}
            />
            <span className="ed-scene-settings-detail">
              Deployed Rust API. Stamped into the web release so one build can target any
              deployment.
            </span>
          </label>
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Boot Scene</span>
            <select
              className="ed-input"
              value={draft.defaultScene}
              onChange={(event) => setDraft({ ...draft, defaultScene: event.target.value })}
              onKeyDown={stopKeyPropagation}
            >
              {sceneEntries.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name} ({id})
                </option>
              ))}
            </select>
            <span className="ed-scene-settings-detail">Scene the game loads on start.</span>
          </label>
          <label className="ed-scene-settings-field">
            <span className="ed-scene-settings-label">Build Output</span>
            <input
              className="ed-input"
              type="text"
              value={draft.build.outDir}
              onChange={(event) =>
                setDraft({ ...draft, build: { outDir: event.target.value } })
              }
              onKeyDown={stopKeyPropagation}
            />
            <span className="ed-scene-settings-detail">Directory File → Build Web writes into.</span>
          </label>
        </div>
        <div className="ed-base-actions">
          <button type="button" className="ed-btn ed-btn-accent" onClick={() => void handleSave()}>
            Save
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
