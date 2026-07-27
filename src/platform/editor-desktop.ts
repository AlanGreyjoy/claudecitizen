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
  | 'deploy-frontend'
  | 'deploy-backend'
  | 'new-scene'
  | 'new-prefab'
  | 'save'
  | 'open-scene'
  | 'open-prefab'
  | 'open-planet'
  | 'open-menu'
  | 'open-scene-settings'
  | 'delete-scene'
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

/** One remote command in the deploy pipeline. `command` may use `{{token}}` templates. */
export interface DeployStep {
  id: string;
  label: string;
  command: string;
  enabled: boolean;
}

/**
 * Deploy settings as the renderer sees them. The password is never sent back
 * out of the main process — `hasPassword` reports only whether one is stored.
 */
export interface DeployConfig {
  schemaVersion: 1;
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  remotePath: string;
  gitRemote: string;
  branch: string;
  composeFiles: string[];
  envFile: string;
  healthUrl: string;
  netlifySite: string;
  steps: DeployStep[];
  hasPassword: boolean;
}

/** Config as sent to the main process. An absent `password` leaves the stored one intact. */
export type DeployConfigInput = Omit<DeployConfig, 'hasPassword'> & { password?: string };

export interface DeployConfigResult {
  config: DeployConfig;
  defaultSteps: DeployStep[];
}

/** Local checkout versus the branch the box pulls. Populated before a backend deploy. */
export interface DeployPreflight {
  head: string;
  headSubject: string;
  remoteHead: string;
  branch: string;
  remote: string;
  dirtyFiles: number;
  warnings: string[];
}

export interface DeployConnectionResult {
  ok: boolean;
  detail: string;
  remotePathIsRepo: boolean;
}

export interface DeployResult {
  ok: boolean;
  message: string;
  failedStep?: number;
}

export type DeployTarget = 'backend' | 'client';

export type DeployState =
  | { phase: 'started'; target: DeployTarget; steps: string[]; message: string }
  | { phase: 'step'; stepIndex: number; label: string }
  | { phase: 'log'; line: string }
  | { phase: 'success' | 'error'; target: DeployTarget; ok: boolean; message: string; failedStep?: number };

export type DesktopDeleteProjectResult =
  | ({ canceled?: false } & DesktopRecentProjectsResult)
  | { canceled: true; projects?: undefined };

export interface ClaudeCitizenEditorDesktopBridge {
  readonly isDesktopEditor: true;
  readonly platform: string;
  buildWeb: () => Promise<DesktopBuildResult>;
  onBuildState: (callback: (state: DesktopBuildState) => void) => () => void;
  getDeployConfig: () => Promise<DeployConfigResult>;
  saveDeployConfig: (config: DeployConfigInput) => Promise<{ saved: true; config: DeployConfig; path: string }>;
  deployPreflight: () => Promise<DeployPreflight>;
  testDeployConnection: () => Promise<DeployConnectionResult>;
  deployBackend: () => Promise<DeployResult>;
  deployClient: () => Promise<DeployResult>;
  cancelDeploy: () => Promise<{ canceled: boolean }>;
  onDeployState: (callback: (state: DeployState) => void) => () => void;
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
