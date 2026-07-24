/* eslint-disable @typescript-eslint/no-require-imports -- Electron sandbox preloads use CommonJS. */
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld(
  'claudeCitizenEditorDesktop',
  Object.freeze({
    isDesktopEditor: true,
    platform: process.platform,
    play: (route) => ipcRenderer.invoke('editor:play', route),
    stopPlay: () => ipcRenderer.invoke('editor:stop-play'),
    getPlayState: () => ipcRenderer.invoke('editor:get-play-state'),
    buildWeb: () => ipcRenderer.invoke('editor:build-web'),
    onPlayState: (callback) => subscribe('editor:play-state', callback),
    onBuildState: (callback) => subscribe('editor:build-state', callback),
    onNativeCommand: (callback) => subscribe('editor:native-command', callback),
    listRecentProjects: () => ipcRenderer.invoke('projects:listRecent'),
    openProject: (projectRoot) => ipcRenderer.invoke('projects:open', projectRoot),
    chooseAndOpenProject: () => ipcRenderer.invoke('projects:chooseAndOpen'),
    pickProjectDirectory: () => ipcRenderer.invoke('projects:pickDirectory'),
    createProject: (payload) => ipcRenderer.invoke('projects:create', payload),
    removeRecentProject: (projectRoot) =>
      ipcRenderer.invoke('projects:removeRecent', projectRoot),
    showProjectInFolder: (projectRoot) =>
      ipcRenderer.invoke('projects:showInFolder', projectRoot),
    returnToProjects: () => ipcRenderer.invoke('projects:returnToHub'),
  }),
);
