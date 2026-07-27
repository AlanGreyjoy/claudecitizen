export interface DesktopBuildResult {
  ok: boolean;
  message: string;
  outputDir?: string;
  output?: string;
}

export interface DesktopBuildState extends DesktopBuildResult {
  phase: 'building' | 'success' | 'error';
}

export type DesktopNativeCommandType =
  | 'play'
  | 'pause-play'
  | 'stop-play'
  | 'build-web'
  | 'new-scene'
  | 'new-prefab'
  | 'save'
  | 'open-scene'
  | 'open-prefab'
  | 'open-planet'
  | 'open-menu'
  | 'open-scene-settings'
  | 'open-project-settings'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'delete'
  | 'exit-to-title'
  | 'new-project'
  | 'sidekick-pack-changed';

export interface DesktopNativeCommand {
  type: DesktopNativeCommandType;
}

export interface DesktopAgentRequest {
  id: string;
  kind: string;
  params?: Record<string, unknown>;
}

export interface DesktopAgentResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message: string; status?: number };
}

export interface DesktopRecentProject {
  path: string;
  name: string;
  openedAt: number;
}

export interface DesktopRecentProjectsResult {
  projects: DesktopRecentProject[];
}

export type DesktopOpenProjectResult =
  | { projectRoot: string; canceled?: undefined }
  | { canceled: true; projectRoot?: undefined; error?: string };

export interface DesktopPickDirectoryResult {
  path?: string;
  canceled?: boolean;
}

export interface DesktopCreateProjectRequest {
  name: string;
  parentDir?: string;
}

export type DesktopDeleteProjectResult =
  | ({ canceled?: false } & DesktopRecentProjectsResult)
  | { canceled: true; projects?: undefined };

export interface ClaudeCitizenEditorDesktopBridge {
  readonly isDesktopEditor: true;
  readonly platform: string;
  buildWeb: () => Promise<DesktopBuildResult>;
  onBuildState: (callback: (state: DesktopBuildState) => void) => () => void;
  onNativeCommand: (callback: (command: DesktopNativeCommand) => void) => () => void;
  onAgentRequest: (callback: (request: DesktopAgentRequest) => void) => () => void;
  replyAgentRequest: (payload: DesktopAgentResponse) => void;
  listRecentProjects: () => Promise<DesktopRecentProjectsResult>;
  openProject: (projectRoot: string) => Promise<DesktopOpenProjectResult>;
  chooseAndOpenProject: () => Promise<DesktopOpenProjectResult>;
  pickProjectDirectory: () => Promise<DesktopPickDirectoryResult>;
  createProject: (payload: DesktopCreateProjectRequest) => Promise<DesktopOpenProjectResult>;
  removeRecentProject: (projectRoot: string) => Promise<DesktopRecentProjectsResult>;
  renameProject: (projectRoot: string, name: string) => Promise<DesktopRecentProjectsResult>;
  deleteProject: (projectRoot: string) => Promise<DesktopDeleteProjectResult>;
  showProjectInFolder: (projectRoot: string) => Promise<{ ok: true }>;
  returnToProjects: () => Promise<{ ok: true }>;
  /** Opens an http(s) URL in the system browser. Used for hosted Stripe Checkout. */
  openExternal: (url: string) => Promise<{ ok: true }>;
}

declare global {
  interface Window {
    claudeCitizenEditorDesktop?: ClaudeCitizenEditorDesktopBridge;
  }
}

export function getDesktopEditorBridge(): ClaudeCitizenEditorDesktopBridge | null {
  return window.claudeCitizenEditorDesktop ?? null;
}

/**
 * Opens a URL outside the app.
 *
 * In the desktop editor this hands off to the system browser through the Electron main
 * process; on the web build it falls back to a new tab. Returns false when neither path is
 * available, so callers can show the URL instead of silently doing nothing.
 */
export function openExternalUrl(url: string): boolean {
  const bridge = getDesktopEditorBridge();
  if (bridge) {
    void bridge.openExternal(url).catch(() => undefined);
    return true;
  }
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    return opened !== null;
  }
  return false;
}
