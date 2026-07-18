/* eslint-disable @typescript-eslint/no-require-imports -- Electron sandbox preloads use CommonJS. */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld(
  'claudeCitizenDesktop',
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
  }),
);
