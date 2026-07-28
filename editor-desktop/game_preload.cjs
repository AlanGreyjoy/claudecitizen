/* eslint-disable @typescript-eslint/no-require-imports -- Electron sandbox preloads use CommonJS. */
const { contextBridge } = require('electron');

/**
 * Preload for a multiplayer debug game window.
 *
 * Exposes the instance descriptor and nothing else — the editor preload hands
 * out `deleteProject` and `deployBackend`, which have no business in a window
 * running the game. The descriptor carries no password: the main process signs
 * each instance in to its own cookie jar before the window loads.
 *
 * It arrives on `process.argv` rather than over IPC because `game-main.ts`
 * resolves runtime config at module evaluation, and the very first backend call
 * needs the routing index already in hand. An async handshake would race it.
 */
const PREFIX = '--cc-mp-debug=';
const raw = process.argv.find((value) => value.startsWith(PREFIX));

if (raw) {
  try {
    contextBridge.exposeInMainWorld(
      'claudeCitizenMultiplayerDebug',
      Object.freeze(JSON.parse(raw.slice(PREFIX.length))),
    );
  } catch (error) {
    console.error('[mp-debug] Malformed instance descriptor:', error);
  }
}
