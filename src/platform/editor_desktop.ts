export interface DesktopPlayState {
  playing: boolean;
}

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
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'delete'
  | 'exit-to-title';

export interface DesktopNativeCommand {
  type: DesktopNativeCommandType;
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

export interface ClaudeCitizenEditorDesktopBridge {
  readonly isDesktopEditor: true;
  readonly platform: string;
  play: (route: string) => Promise<DesktopPlayState>;
  stopPlay: () => Promise<DesktopPlayState>;
  getPlayState: () => Promise<DesktopPlayState>;
  buildWeb: () => Promise<DesktopBuildResult>;
  onPlayState: (callback: (state: DesktopPlayState) => void) => () => void;
  onBuildState: (callback: (state: DesktopBuildState) => void) => () => void;
  onNativeCommand: (callback: (command: DesktopNativeCommand) => void) => () => void;
  listRecentProjects: () => Promise<DesktopRecentProjectsResult>;
  openProject: (projectRoot: string) => Promise<DesktopOpenProjectResult>;
  chooseAndOpenProject: () => Promise<DesktopOpenProjectResult>;
  pickProjectDirectory: () => Promise<DesktopPickDirectoryResult>;
  createProject: (payload: DesktopCreateProjectRequest) => Promise<DesktopOpenProjectResult>;
  removeRecentProject: (projectRoot: string) => Promise<DesktopRecentProjectsResult>;
  showProjectInFolder: (projectRoot: string) => Promise<{ ok: true }>;
  returnToProjects: () => Promise<{ ok: true }>;
}

declare global {
  interface Window {
    claudeCitizenEditorDesktop?: ClaudeCitizenEditorDesktopBridge;
  }
}

export function getDesktopEditorBridge(): ClaudeCitizenEditorDesktopBridge | null {
  return window.claudeCitizenEditorDesktop ?? null;
}
