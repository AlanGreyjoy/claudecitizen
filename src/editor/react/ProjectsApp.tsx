import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  getDesktopEditorBridge,
  type ClaudeCitizenEditorDesktopBridge,
  type DesktopRecentProject,
} from '../../platform/editor_desktop';

function formatOpenedAt(openedAt: number): string {
  if (!openedAt) return '';
  try {
    return new Date(openedAt).toLocaleString();
  } catch {
    return '';
  }
}

function useBusyAction(): {
  busy: boolean;
  error: string | null;
  setError: (value: string | null) => void;
  runBusy: (work: () => Promise<void>) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runBusy = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, runBusy };
}

function NewProjectForm(props: {
  busy: boolean;
  projectName: string;
  parentDir: string;
  onProjectNameChange: (value: string) => void;
  onBrowse: () => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}): ReactElement {
  return (
    <form className="ae-projects-create" onSubmit={props.onSubmit}>
      <h2 className="ae-projects-section-title">New Project</h2>
      <label className="ae-projects-field">
        <span>Project name</span>
        <input
          value={props.projectName}
          onChange={(event) => props.onProjectNameChange(event.target.value)}
          disabled={props.busy}
          autoFocus
          maxLength={64}
        />
      </label>
      <label className="ae-projects-field">
        <span>Location</span>
        <div className="ae-projects-location-row">
          <input value={props.parentDir} readOnly placeholder="Choose a folder…" disabled={props.busy} />
          <button type="button" className="ae-projects-btn" disabled={props.busy} onClick={props.onBrowse}>
            Browse…
          </button>
        </div>
      </label>
      <div className="ae-projects-create-actions">
        <button type="button" className="ae-projects-btn" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </button>
        <button type="submit" className="ae-projects-btn ae-projects-btn-primary" disabled={props.busy}>
          Create
        </button>
      </div>
    </form>
  );
}

function RecentProjectsList(props: {
  busy: boolean;
  projects: DesktopRecentProject[];
  bridge: ClaudeCitizenEditorDesktopBridge | null;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}): ReactElement {
  return (
    <section className="ae-projects-recent">
      <h2 className="ae-projects-section-title">Recent</h2>
      {props.projects.length === 0 ? (
        <p className="ae-projects-empty">No recent projects yet.</p>
      ) : (
        <ul className="ae-projects-list">
          {props.projects.map((project) => (
            <li key={project.path} className="ae-projects-item">
              <button
                type="button"
                className="ae-projects-item-main"
                disabled={props.busy}
                onClick={() => props.onOpen(project.path)}
              >
                <span className="ae-projects-item-name">{project.name}</span>
                <span className="ae-projects-item-path">{project.path}</span>
                {project.openedAt ? (
                  <span className="ae-projects-item-meta">{formatOpenedAt(project.openedAt)}</span>
                ) : null}
              </button>
              <div className="ae-projects-item-side">
                <button
                  type="button"
                  className="ae-projects-link"
                  disabled={props.busy || !props.bridge}
                  onClick={() => {
                    void props.bridge?.showProjectInFolder(project.path);
                  }}
                >
                  Show
                </button>
                <button
                  type="button"
                  className="ae-projects-link"
                  disabled={props.busy}
                  onClick={() => props.onRemove(project.path)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function createNamedProject(
  bridge: ClaudeCitizenEditorDesktopBridge,
  projectName: string,
  parentDir: string,
  setParentDir: (value: string) => void,
  setError: (value: string | null) => void,
): Promise<void> {
  const name = projectName.trim();
  if (!name) {
    setError('Enter a project name.');
    return;
  }
  let location = parentDir.trim();
  if (!location) {
    const picked = await bridge.pickProjectDirectory();
    if (picked.canceled || !picked.path) return;
    location = picked.path;
    setParentDir(location);
  }
  await bridge.createProject({ name, parentDir: location });
}

export function ProjectsApp(): ReactElement {
  const bridge = getDesktopEditorBridge();
  const [projects, setProjects] = useState<DesktopRecentProject[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [projectName, setProjectName] = useState('New Project');
  const [parentDir, setParentDir] = useState('');
  const { busy, error, setError, runBusy } = useBusyAction();

  useEffect(() => {
    document.title = 'AsteronEngine — Projects';
    if (!bridge) {
      setError('AsteronEngine Projects requires the desktop editor.');
      return;
    }
    let cancelled = false;
    void bridge.listRecentProjects().then((result) => {
      if (!cancelled) setProjects(result.projects);
    }).catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Could not load recent projects.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, setError]);

  return (
    <div className="ae-projects">
      <div className="ae-projects-shell">
        <header className="ae-projects-header">
          <div>
            <p className="ae-projects-kicker">Projects</p>
            <h1 className="ae-projects-brand">AsteronEngine</h1>
            <p className="ae-projects-tag">Create or open a project to start authoring.</p>
          </div>
          <div className="ae-projects-actions">
            <button
              type="button"
              className="ae-projects-btn ae-projects-btn-primary"
              disabled={busy || !bridge}
              onClick={() => {
                setShowCreate(true);
                setError(null);
              }}
            >
              New Project
            </button>
            <button
              type="button"
              className="ae-projects-btn"
              disabled={busy || !bridge}
              onClick={() => {
                void runBusy(async () => {
                  if (!bridge) return;
                  await bridge.chooseAndOpenProject();
                });
              }}
            >
              Open
            </button>
          </div>
        </header>

        {error ? <p className="ae-projects-error" role="alert">{error}</p> : null}

        {showCreate ? (
          <NewProjectForm
            busy={busy}
            projectName={projectName}
            parentDir={parentDir}
            onProjectNameChange={setProjectName}
            onBrowse={() => {
              void runBusy(async () => {
                if (!bridge) return;
                const result = await bridge.pickProjectDirectory();
                if (result.canceled || !result.path) return;
                setParentDir(result.path);
                setShowCreate(true);
              });
            }}
            onCancel={() => setShowCreate(false)}
            onSubmit={(event) => {
              event.preventDefault();
              void runBusy(async () => {
                if (!bridge) return;
                await createNamedProject(bridge, projectName, parentDir, setParentDir, setError);
              });
            }}
          />
        ) : null}

        <RecentProjectsList
          busy={busy}
          projects={projects}
          bridge={bridge}
          onOpen={(path) => {
            void runBusy(async () => {
              if (!bridge) return;
              await bridge.openProject(path);
            });
          }}
          onRemove={(path) => {
            void runBusy(async () => {
              if (!bridge) return;
              const result = await bridge.removeRecentProject(path);
              setProjects(result.projects);
            });
          }}
        />
      </div>
    </div>
  );
}
