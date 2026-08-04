/**
 * Deploy → Sync Catalog: export from editorBackendUrl, import to backendUrl.
 *
 * Runs in Electron main with net.fetch so each origin keeps its own cookie jar
 * (cc_admin). Admin emails/passwords are stored per project in
 * ~/.asteron/catalog-sync.json at mode 0600 (same pattern as deploy.json).
 * Passwords never leave the main process — the renderer only sees has*Password.
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { net } from 'electron';

const CONFIG_DIR = join(homedir(), '.asteron');
const CONFIG_PATH = join(CONFIG_DIR, 'catalog-sync.json');

export class CatalogSyncError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CatalogSyncError';
    this.status = status;
  }
}

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function joinUrl(base, path) {
  return `${trimSlash(base)}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeStored(value) {
  const source = typeof value === 'object' && value !== null ? value : {};
  return {
    targetEmail: typeof source.targetEmail === 'string' ? source.targetEmail.trim() : '',
    targetPassword: typeof source.targetPassword === 'string' ? source.targetPassword : '',
    sourceEmail: typeof source.sourceEmail === 'string' ? source.sourceEmail.trim() : '',
    sourcePassword: typeof source.sourcePassword === 'string' ? source.sourcePassword : '',
    includeGameSettings: source.includeGameSettings === true,
  };
}

function toPublicConfig(stored) {
  return {
    targetEmail: stored.targetEmail,
    sourceEmail: stored.sourceEmail,
    includeGameSettings: stored.includeGameSettings,
    hasTargetPassword: stored.targetPassword.length > 0,
    hasSourcePassword: stored.sourcePassword.length > 0,
  };
}

async function readStore() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStore(store) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function errorMessage(body, fallback) {
  if (body && typeof body.message === 'string') return body.message;
  return fallback;
}

/**
 * @param {{
 *   getRepository: () => {
 *     projectRoot: string,
 *     getProjectSettings: () => Promise<{ document: { editorBackendUrl?: string, backendUrl?: string } }>
 *   } | null,
 *   onEvent?: (event: { phase: string, line?: string, message?: string, ok?: boolean, result?: unknown }) => void,
 * }} deps
 */
export function createCatalogSyncManager({ getRepository, onEvent }) {
  let running = false;

  const emit = (event) => {
    if (typeof onEvent === 'function') onEvent(event);
  };

  const log = (line) => emit({ phase: 'log', line });

  function projectKey() {
    const repository = getRepository();
    if (!repository) throw new CatalogSyncError('No AsteronEngine project is open.');
    return repository.projectRoot;
  }

  async function loadStored() {
    const store = await readStore();
    return normalizeStored(store[projectKey()]);
  }

  async function resolveUrls() {
    const repository = getRepository();
    if (!repository) throw new CatalogSyncError('No AsteronEngine project is open.');
    const { document: settings } = await repository.getProjectSettings();
    const sourceUrl = trimSlash(settings.editorBackendUrl || settings.backendUrl || '');
    const targetUrl = trimSlash(settings.backendUrl || '');
    if (!sourceUrl) throw new CatalogSyncError('editorBackendUrl is not set in Project Settings.');
    if (!targetUrl) throw new CatalogSyncError('backendUrl is not set in Project Settings.');
    return { sourceUrl, targetUrl };
  }

  async function adminLogin(baseUrl, email, password) {
    const response = await net.fetch(joinUrl(baseUrl, '/admin/session'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new CatalogSyncError(
        errorMessage(body, `Admin login failed for ${baseUrl} (${response.status}).`),
        response.status,
      );
    }
  }

  async function exportCatalog(baseUrl) {
    const response = await net.fetch(joinUrl(baseUrl, '/admin/catalog/export'), {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'include',
    });
    const body = await readJson(response);
    if (response.status === 401) {
      throw new CatalogSyncError(
        'Source admin session missing. Sign in on the Server tab, or provide source admin credentials.',
        401,
      );
    }
    if (!response.ok) {
      throw new CatalogSyncError(
        errorMessage(body, `Catalog export failed (${response.status}).`),
        response.status,
      );
    }
    return body;
  }

  async function importCatalog(baseUrl, catalog, includeGameSettings) {
    const payload = {
      version: catalog.version,
      includeGameSettings: Boolean(includeGameSettings),
      ships: catalog.ships ?? [],
      props: catalog.props ?? [],
      items: catalog.items ?? [],
      weapons: catalog.weapons ?? [],
      backpacks: catalog.backpacks ?? [],
      wearables: catalog.wearables ?? [],
      creditPacks: catalog.creditPacks ?? [],
      mallListings: catalog.mallListings ?? [],
      settings: catalog.settings ?? null,
    };
    const response = await net.fetch(joinUrl(baseUrl, '/admin/catalog/import'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new CatalogSyncError(
        errorMessage(body, `Catalog import failed (${response.status}).`),
        response.status,
      );
    }
    return body;
  }

  function summarize(result) {
    const parts = [];
    for (const key of [
      'items',
      'weapons',
      'backpacks',
      'wearables',
      'ships',
      'props',
      'creditPacks',
      'mallListings',
      'settings',
    ]) {
      const section = result?.[key];
      if (!section) continue;
      const inserted = Number(section.inserted) || 0;
      const updated = Number(section.updated) || 0;
      if (inserted + updated === 0) continue;
      parts.push(`${key}: +${inserted} ~${updated}`);
    }
    return parts.length > 0 ? parts.join(', ') : 'no row changes';
  }

  async function saveConfig(value) {
    const key = projectKey();
    const store = await readStore();
    const existing = normalizeStored(store[key]);
    const incoming = typeof value === 'object' && value !== null ? value : {};
    const targetPassword =
      typeof incoming.targetPassword === 'string' && incoming.targetPassword.length > 0
        ? incoming.targetPassword
        : existing.targetPassword;
    const sourcePassword =
      typeof incoming.sourcePassword === 'string' && incoming.sourcePassword.length > 0
        ? incoming.sourcePassword
        : existing.sourcePassword;
    const next = normalizeStored({
      targetEmail:
        typeof incoming.targetEmail === 'string' ? incoming.targetEmail : existing.targetEmail,
      sourceEmail:
        typeof incoming.sourceEmail === 'string' ? incoming.sourceEmail : existing.sourceEmail,
      includeGameSettings:
        typeof incoming.includeGameSettings === 'boolean'
          ? incoming.includeGameSettings
          : existing.includeGameSettings,
      targetPassword,
      sourcePassword,
    });
    store[key] = next;
    await writeStore(store);
    return { saved: true, ...toPublicConfig(next), path: CONFIG_PATH };
  }

  return {
    async getUrls() {
      return resolveUrls();
    },

    /** Public form state — passwords never included. */
    async getConfig() {
      const [urls, stored] = await Promise.all([resolveUrls(), loadStored()]);
      return { urls, ...toPublicConfig(stored), path: CONFIG_PATH };
    },

    saveConfig,

    /**
     * @param {{
     *   targetEmail: string,
     *   targetPassword?: string,
     *   sourceEmail?: string,
     *   sourcePassword?: string,
     *   includeGameSettings?: boolean,
     * }} options
     */
    async sync(options) {
      if (running) throw new CatalogSyncError('A catalog sync is already running.');

      const stored = await loadStored();
      const targetEmail = String(options?.targetEmail || stored.targetEmail || '').trim();
      const typedTargetPassword = String(options?.targetPassword || '');
      const targetPassword = typedTargetPassword || stored.targetPassword;
      if (!targetEmail || !targetPassword) {
        throw new CatalogSyncError('Target admin email and password are required.');
      }

      const sourceEmail = String(options?.sourceEmail ?? stored.sourceEmail ?? '').trim();
      const typedSourcePassword = String(options?.sourcePassword || '');
      const sourcePassword = typedSourcePassword || stored.sourcePassword;
      const includeGameSettings =
        typeof options?.includeGameSettings === 'boolean'
          ? options.includeGameSettings
          : stored.includeGameSettings;

      // Persist before the network work so a successful fill survives a mid-sync fail.
      await saveConfig({
        targetEmail,
        targetPassword: typedTargetPassword || undefined,
        sourceEmail,
        sourcePassword: typedSourcePassword || undefined,
        includeGameSettings,
      });

      running = true;
      emit({ phase: 'started', message: 'Syncing catalog…' });
      try {
        const { sourceUrl, targetUrl } = await resolveUrls();
        if (sourceUrl === targetUrl) {
          throw new CatalogSyncError(
            'editorBackendUrl and backendUrl are the same — nothing to sync. Set a distinct release backendUrl in Project Settings.',
          );
        }

        log(`Source (editor): ${sourceUrl}`);
        log(`Target (release): ${targetUrl}`);

        if (sourceEmail && sourcePassword) {
          log('Signing in to source admin…');
          await adminLogin(sourceUrl, sourceEmail, sourcePassword);
        }

        log('Exporting catalog from source…');
        let catalog;
        try {
          catalog = await exportCatalog(sourceUrl);
        } catch (error) {
          if (
            error instanceof CatalogSyncError &&
            error.status === 401 &&
            sourceEmail &&
            sourcePassword
          ) {
            log('Source session expired; retrying login…');
            await adminLogin(sourceUrl, sourceEmail, sourcePassword);
            catalog = await exportCatalog(sourceUrl);
          } else {
            throw error;
          }
        }

        const counts = {
          ships: catalog.ships?.length ?? 0,
          props: catalog.props?.length ?? 0,
          items: catalog.items?.length ?? 0,
          weapons: catalog.weapons?.length ?? 0,
          backpacks: catalog.backpacks?.length ?? 0,
          wearables: catalog.wearables?.length ?? 0,
          creditPacks: catalog.creditPacks?.length ?? 0,
          mallListings: catalog.mallListings?.length ?? 0,
        };
        log(
          `Exported ${counts.items} items, ${counts.weapons} weapons, ${counts.ships} ships, ${counts.props} props.`,
        );

        log('Signing in to target admin…');
        await adminLogin(targetUrl, targetEmail, targetPassword);

        log(
          includeGameSettings
            ? 'Importing catalog (including game settings)…'
            : 'Importing catalog (game settings skipped)…',
        );
        const result = await importCatalog(targetUrl, catalog, includeGameSettings);
        const summary = summarize(result);
        log(`Done: ${summary}`);
        emit({ phase: 'success', ok: true, message: `Catalog synced — ${summary}`, result });
        return { ok: true, message: `Catalog synced — ${summary}`, result };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Catalog sync failed.';
        log(`Error: ${message}`);
        emit({ phase: 'error', ok: false, message });
        return { ok: false, message };
      } finally {
        running = false;
      }
    },
  };
}
