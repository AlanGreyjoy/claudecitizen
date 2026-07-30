import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import asteronEngineBannerUrl from '../../assets/generated/asteron-engine-projects-banner.png';
import {
  getDesktopEditorBridge,
  type ClaudeCitizenEditorDesktopBridge,
  type DesktopRecentProject,
} from '../../platform/editor-desktop';

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

function ProjectRowMenu(props: {
  busy: boolean;
  renaming: boolean;
  canShowInFolder: boolean;
  onRename: () => void;
  onShow: () => void;
  onRemove: () => void;
  onDelete: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action: () => void): void => {
    setOpen(false);
    action();
  };

  return (
    <div
      ref={rootRef}
      className={`ae-projects-menu${open ? ' is-open' : ''}`}
    >
      <button
        type="button"
        className="ae-projects-menu-trigger"
        disabled={props.busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Project actions"
        title="Project actions"
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>
      {open ? (
        <div className="ae-projects-menu-dropdown" role="menu">
          <button
            type="button"
            className="ae-projects-menu-item"
            role="menuitem"
            disabled={props.busy || props.renaming}
            onClick={() => run(props.onRename)}
          >
            Rename
          </button>
          <button
            type="button"
            className="ae-projects-menu-item"
            role="menuitem"
            disabled={props.busy || !props.canShowInFolder}
            onClick={() => run(props.onShow)}
          >
            Show in Folder
          </button>
          <button
            type="button"
            className="ae-projects-menu-item"
            role="menuitem"
            disabled={props.busy}
            title="Forget this project in Recent without deleting files"
            onClick={() => run(props.onRemove)}
          >
            Remove from Recent
          </button>
          <div className="ae-projects-menu-sep" />
          <button
            type="button"
            className="ae-projects-menu-item ae-projects-menu-item-danger"
            role="menuitem"
            disabled={props.busy}
            title="Permanently delete the project folder from disk"
            onClick={() => run(props.onDelete)}
          >
            Delete…
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RecentProjectsList(props: {
  busy: boolean;
  projects: DesktopRecentProject[];
  bridge: ClaudeCitizenEditorDesktopBridge | null;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, name: string) => Promise<boolean>;
}): ReactElement {
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  return (
    <section className="ae-projects-recent">
      <h2 className="ae-projects-section-title">Recent</h2>
      {props.projects.length === 0 ? (
        <p className="ae-projects-empty">No recent projects yet.</p>
      ) : (
        <ul className="ae-projects-list">
          {props.projects.map((project) => (
            <li key={project.path} className="ae-projects-item">
              {renamingPath === project.path ? (
                <form
                  className="ae-projects-item-main ae-projects-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void props.onRename(project.path, renameValue).then((renamed) => {
                      if (renamed) setRenamingPath(null);
                    });
                  }}
                >
                  <input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    disabled={props.busy}
                    autoFocus
                    maxLength={64}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRenamingPath(null);
                    }}
                  />
                  <span className="ae-projects-item-path">{project.path}</span>
                  <div className="ae-projects-create-actions">
                    <button
                      type="button"
                      className="ae-projects-btn"
                      disabled={props.busy}
                      onClick={() => setRenamingPath(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="ae-projects-btn ae-projects-btn-primary"
                      disabled={props.busy}
                    >
                      Rename
                    </button>
                  </div>
                </form>
              ) : (
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
              )}
              <div className="ae-projects-item-side">
                <ProjectRowMenu
                  busy={props.busy}
                  renaming={renamingPath === project.path}
                  canShowInFolder={Boolean(props.bridge)}
                  onRename={() => {
                    setRenamingPath(project.path);
                    setRenameValue(project.name);
                  }}
                  onShow={() => {
                    void props.bridge?.showProjectInFolder(project.path);
                  }}
                  onRemove={() => props.onRemove(project.path)}
                  onDelete={() => props.onDelete(project.path)}
                />
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
    const unsubscribe = bridge.onNativeCommand((command) => {
      if (command.type === 'new-project') {
        setShowCreate(true);
        setError(null);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge, setError]);

  return (
    <div className="ae-projects">
      <header className="ae-projects-banner" aria-label="AsteronEngine">
        <img
          className="ae-projects-banner-img"
          src={asteronEngineBannerUrl}
          alt=""
          draggable={false}
        />
        <div className="ae-projects-banner-copy">
          <h1 className="ae-projects-banner-title">AsteronEngine</h1>
          <p className="ae-projects-banner-tagline">Build worlds. Play in-engine.</p>
          <p className="ae-projects-banner-punchline">
            Zero billion dollars crowdfunded. Still ships this decade.
          </p>
        </div>
      </header>
      <div className="ae-projects-shell">
        <div className="ae-projects-header">
          <div>
            <p className="ae-projects-kicker">Projects</p>
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
        </div>

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
          onDelete={(path) => {
            void runBusy(async () => {
              if (!bridge) return;
              const result = await bridge.deleteProject(path);
              if (result.canceled || !result.projects) return;
              setProjects(result.projects);
            });
          }}
          onRename={async (path, name) => {
            let renamed = false;
            await runBusy(async () => {
              if (!bridge) return;
              const result = await bridge.renameProject(path, name);
              setProjects(result.projects);
              renamed = true;
            });
            return renamed;
          }}
        />
      </div>
    </div>
  );
}
