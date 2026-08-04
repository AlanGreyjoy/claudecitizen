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
    buildWeb: () => ipcRenderer.invoke('editor:build-web'),
    onBuildState: (callback) => subscribe('editor:build-state', callback),
    installKtxPackage: () => ipcRenderer.invoke('editor:packages-install-ktx'),
    uninstallKtxPackage: () => ipcRenderer.invoke('editor:packages-uninstall-ktx'),
    onPackageState: (callback) => subscribe('editor:package-state', callback),
    transcodeTextures: () => ipcRenderer.invoke('editor:transcode-textures'),
    onTranscodeState: (callback) => subscribe('editor:transcode-state', callback),
    getDeployConfig: () => ipcRenderer.invoke('deploy:get-config'),
    saveDeployConfig: (config) => ipcRenderer.invoke('deploy:save-config', config),
    deployPreflight: () => ipcRenderer.invoke('deploy:preflight'),
    testDeployConnection: () => ipcRenderer.invoke('deploy:test-connection'),
    deployBackend: () => ipcRenderer.invoke('deploy:backend'),
    deployClient: () => ipcRenderer.invoke('deploy:client'),
    cancelDeploy: () => ipcRenderer.invoke('deploy:cancel'),
    onDeployState: (callback) => subscribe('editor:deploy-state', callback),
    getCatalogSyncUrls: () => ipcRenderer.invoke('deploy:catalog-sync-urls'),
    getCatalogSyncConfig: () => ipcRenderer.invoke('deploy:catalog-sync-config'),
    syncCatalog: (options) => ipcRenderer.invoke('deploy:catalog-sync', options),
    onCatalogSyncState: (callback) => subscribe('editor:catalog-sync-state', callback),
    onNativeCommand: (callback) => subscribe('editor:native-command', callback),
    onAgentRequest: (callback) => subscribe('agent:request', callback),
    replyAgentRequest: (payload) => {
      ipcRenderer.send('agent:response', payload);
    },
    listRecentProjects: () => ipcRenderer.invoke('projects:listRecent'),
    openProject: (projectRoot) => ipcRenderer.invoke('projects:open', projectRoot),
    chooseAndOpenProject: () => ipcRenderer.invoke('projects:chooseAndOpen'),
    pickProjectDirectory: () => ipcRenderer.invoke('projects:pickDirectory'),
    createProject: (payload) => ipcRenderer.invoke('projects:create', payload),
    removeRecentProject: (projectRoot) =>
      ipcRenderer.invoke('projects:removeRecent', projectRoot),
    renameProject: (projectRoot, name) =>
      ipcRenderer.invoke('projects:rename', { projectRoot, name }),
    deleteProject: (projectRoot) =>
      ipcRenderer.invoke('projects:delete', projectRoot),
    showProjectInFolder: (projectRoot) =>
      ipcRenderer.invoke('projects:showInFolder', projectRoot),
    returnToProjects: () => ipcRenderer.invoke('projects:returnToHub'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    multiplayerDebugHealth: () => ipcRenderer.invoke('mp-debug:health'),
    launchMultiplayerDebug: (options) => ipcRenderer.invoke('mp-debug:launch', options),
    stopMultiplayerDebug: () => ipcRenderer.invoke('mp-debug:stop'),
    multiplayerDebugStatus: () => ipcRenderer.invoke('mp-debug:status'),
    onMultiplayerDebugState: (callback) => subscribe('editor:mp-debug-state', callback),
  }),
);
