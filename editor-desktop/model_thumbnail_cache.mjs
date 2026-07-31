/**
 * Machine-local model thumbnail cache under Electron userData.
 *
 * IndexedDB in the renderer never reliably persisted across editor restarts
 * (origin split between editor:dev and cceditor://, silent open failures).
 * Main-process files survive both.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const INDEX_VERSION = 1;
const MAX_STORED_THUMBNAILS = 512;
const DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/**
 * @param {string} rootDir Electron `app.getPath('userData')`
 */
export function createModelThumbnailCache(rootDir) {
  const cacheDir = join(rootDir, 'model-thumbnails');
  const indexPath = join(cacheDir, 'index.json');
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  /**
   * Serialize all index + file mutations so concurrent GET/PUT cannot clobber
   * the index mid-write.
   * @template T
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  function enqueue(work) {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * @returns {Promise<{ version: number, entries: Record<string, { key: string, mime: string, lastAccessedAt: number }> }>}
   */
  async function readIndex() {
    try {
      const raw = await readFile(indexPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        !parsed
        || typeof parsed !== 'object'
        || parsed.version !== INDEX_VERSION
        || !parsed.entries
        || typeof parsed.entries !== 'object'
      ) {
        return { version: INDEX_VERSION, entries: {} };
      }
      return { version: INDEX_VERSION, entries: parsed.entries };
    } catch {
      return { version: INDEX_VERSION, entries: {} };
    }
  }

  /**
   * @param {{ version: number, entries: Record<string, { key: string, mime: string, lastAccessedAt: number }> }} index
   */
  async function writeIndex(index) {
    await mkdir(cacheDir, { recursive: true });
    const tempPath = `${indexPath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(index)}\n`, 'utf8');
    await rename(tempPath, indexPath);
  }

  /**
   * @param {string} key
   */
  function entryIdForKey(key) {
    return createHash('sha256').update(key, 'utf8').digest('hex');
  }

  /**
   * @param {string} entryId
   */
  function blobPathFor(entryId) {
    return join(cacheDir, `${entryId}.bin`);
  }

  /**
   * @param {string} dataUrl
   * @returns {{ mime: string, bytes: Buffer } | null}
   */
  function decodeDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl) return null;
    const match = DATA_URL_PATTERN.exec(dataUrl.trim());
    if (!match) return null;
    const mime = match[1].trim().toLowerCase();
    try {
      return { mime, bytes: Buffer.from(match[2].replace(/\s+/g, ''), 'base64') };
    } catch {
      return null;
    }
  }

  /**
   * @param {string} mime
   * @param {Buffer} bytes
   */
  function encodeDataUrl(mime, bytes) {
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  /**
   * @param {Record<string, { key: string, mime: string, lastAccessedAt: number }>} entries
   */
  async function pruneEntries(entries) {
    const ids = Object.keys(entries);
    const overflow = ids.length - MAX_STORED_THUMBNAILS;
    if (overflow <= 0) return;
    ids.sort(
      (left, right) => (entries[left]?.lastAccessedAt ?? 0) - (entries[right]?.lastAccessedAt ?? 0),
    );
    for (let i = 0; i < overflow; i += 1) {
      const id = ids[i];
      if (!id) continue;
      delete entries[id];
      await rm(blobPathFor(id), { force: true });
    }
  }

  return {
    /**
     * @param {string} key
     * @returns {Promise<string | null>} data URL, or null on miss
     */
    get(key) {
      if (typeof key !== 'string' || !key) return Promise.resolve(null);
      return enqueue(async () => {
        const index = await readIndex();
        const entryId = entryIdForKey(key);
        const meta = index.entries[entryId];
        if (!meta || meta.key !== key || typeof meta.mime !== 'string') return null;
        try {
          const bytes = await readFile(blobPathFor(entryId));
          meta.lastAccessedAt = Date.now();
          await writeIndex(index);
          return encodeDataUrl(meta.mime, bytes);
        } catch {
          delete index.entries[entryId];
          await writeIndex(index);
          return null;
        }
      });
    },

    /**
     * @param {string} key
     * @param {string} dataUrl
     * @returns {Promise<void>}
     */
    put(key, dataUrl) {
      if (typeof key !== 'string' || !key) return Promise.resolve();
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded || decoded.bytes.length === 0) return Promise.resolve();
      return enqueue(async () => {
        const index = await readIndex();
        const entryId = entryIdForKey(key);
        await mkdir(cacheDir, { recursive: true });
        const tempPath = `${blobPathFor(entryId)}.${process.pid}.tmp`;
        await writeFile(tempPath, decoded.bytes);
        await rename(tempPath, blobPathFor(entryId));
        index.entries[entryId] = {
          key,
          mime: decoded.mime,
          lastAccessedAt: Date.now(),
        };
        await pruneEntries(index.entries);
        await writeIndex(index);
      });
    },
  };
}
