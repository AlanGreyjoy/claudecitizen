#!/usr/bin/env node
/**
 * Rebrand unpackaged Electron.app so macOS menu bar / Cmd+Tab / Activity
 * Monitor show "AsteronEngine" instead of "Electron".
 *
 * Those labels come from CFBundleName at launch — `app.setName()` cannot
 * override them. Patch this worktree's node_modules Electron.app Info.plist
 * before every `npm run editor` / `editor:dev`. Idempotent; unlinks before
 * rewrite so a hardlinked store inode is never mutated in place.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const DESIRED_NAME = 'AsteronEngine';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const require = createRequire(import.meta.url);
/** @type {string} path to …/Electron.app/Contents/MacOS/Electron */
const electronBin = require('electron');
const plistPath = resolve(electronBin, '../../Info.plist');

function plistGet(key) {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function plistSet(key, value) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath]);
}

if (
  plistGet('CFBundleName') === DESIRED_NAME
  && plistGet('CFBundleDisplayName') === DESIRED_NAME
) {
  process.exit(0);
}

// Break hardlinks to a shared store (pnpm / some npm layouts) before writing.
const original = readFileSync(plistPath);
unlinkSync(plistPath);
writeFileSync(plistPath, original);

plistSet('CFBundleName', DESIRED_NAME);
plistSet('CFBundleDisplayName', DESIRED_NAME);

console.log(`[brand-dev-electron] ${plistPath} → "${DESIRED_NAME}"`);
