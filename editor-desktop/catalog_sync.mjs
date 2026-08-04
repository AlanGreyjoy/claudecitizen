/**
 * Deploy → Sync Catalog: export from editorBackendUrl, import to backendUrl.
 *
 * Runs in Electron main with net.fetch so each origin keeps its own cookie jar
 * (cc_admin). The renderer cceditor:// origin cannot hold those cookies or pass CORS.
 */

import { net } from 'electron';

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
 *   getRepository: () => { getProjectSettings: () => Promise<{ document: { editorBackendUrl?: string, backendUrl?: string } }> } | null,
 *   onEvent?: (event: { phase: string, line?: string, message?: string, ok?: boolean, result?: unknown }) => void,
 * }} deps
 */
export function createCatalogSyncManager({ getRepository, onEvent }) {
  let running = false;

  const emit = (event) => {
    if (typeof onEvent === 'function') onEvent(event);
  };

  const log = (line) => emit({ phase: 'log', line });

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

  return {
    async getUrls() {
      return resolveUrls();
    },

    /**
     * @param {{
     *   targetEmail: string,
     *   targetPassword: string,
     *   sourceEmail?: string,
     *   sourcePassword?: string,
     *   includeGameSettings?: boolean,
     * }} options
     */
    async sync(options) {
      if (running) throw new CatalogSyncError('A catalog sync is already running.');
      const targetEmail = String(options?.targetEmail || '').trim();
      const targetPassword = String(options?.targetPassword || '');
      if (!targetEmail || !targetPassword) {
        throw new CatalogSyncError('Target admin email and password are required.');
      }

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

        const sourceEmail = String(options?.sourceEmail || '').trim();
        const sourcePassword = String(options?.sourcePassword || '');
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

        const includeGameSettings = Boolean(options?.includeGameSettings);
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
