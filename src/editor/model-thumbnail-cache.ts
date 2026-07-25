const DB_NAME = 'claudecitizen-editor';
const DB_VERSION = 1;
const STORE_NAME = 'model-thumbnails';
const LAST_ACCESSED_INDEX = 'last-accessed-at';
const MAX_STORED_THUMBNAILS = 512;

interface StoredModelThumbnail {
  key: string;
  dataUrl: string;
  lastAccessedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      if (!store.indexNames.contains(LAST_ACCESSED_INDEX)) {
        store.createIndex(LAST_ACCESSED_INDEX, 'lastAccessedAt');
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      console.warn('ClaudeCitizen editor thumbnail cache unavailable.', request.error);
      resolve(null);
    };
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function isStoredModelThumbnail(value: unknown): value is StoredModelThumbnail {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredModelThumbnail>;
  return (
    typeof record.key === 'string'
    && typeof record.dataUrl === 'string'
    && typeof record.lastAccessedAt === 'number'
  );
}

export async function getCachedModelThumbnail(key: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      if (!isStoredModelThumbnail(request.result)) {
        resolve(null);
        return;
      }
      const record = request.result;
      record.lastAccessedAt = Date.now();
      store.put(record);
      resolve(record.dataUrl);
    };
    request.onerror = () => resolve(null);
    transaction.onabort = () => resolve(null);
  });
}

async function pruneOldThumbnails(db: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      let remaining = countRequest.result - MAX_STORED_THUMBNAILS;
      if (remaining <= 0) return;
      const cursorRequest = store.index(LAST_ACCESSED_INDEX).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || remaining <= 0) return;
        cursor.delete();
        remaining -= 1;
        cursor.continue();
      };
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => resolve();
    transaction.onerror = () => resolve();
  });
}

export async function putCachedModelThumbnail(key: string, dataUrl: string): Promise<void> {
  const db = await openDb();
  if (!db || !dataUrl) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      key,
      dataUrl,
      lastAccessedAt: Date.now(),
    } satisfies StoredModelThumbnail);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => resolve();
    transaction.onerror = () => resolve();
  });

  await pruneOldThumbnails(db);
}
