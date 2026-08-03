/**
 * Scene-scoped residency tracking for the module-level asset caches
 * (prefab models, prepared collider scenes, character templates, spawn assets).
 *
 * Policy is mark-and-sweep by scene generation, not reference counting: the
 * loaders are fire-and-forget (`void loadPrefabModel(...)`, collider preloads,
 * catalog resolution) with no owner handle to release, so a correct refcount
 * would need an exactly-once release at call sites spread across three layers.
 * A missed decrement would pin gigabytes forever; a double decrement would blank
 * live materials. A missed `touchAsset` only costs one reload.
 *
 * The sweep runs AFTER the incoming scene has finished loading, so an asset the
 * new scene also uses carries the current generation and survives untouched —
 * reuse *within* one play renderer is free. Across a scene switch the play
 * renderer is disposed and prod may have nulled ImageBitmap sources, so
 * `beginAssetGeneration` drops every unpinned entry and the next scene reloads.
 *
 * String keys and callbacks only — this module must stay free of `three` so it
 * can sit in the shared cache layer.
 */

export type EvictFn = (key: string) => void;

export interface SweepResult {
  swept: number;
  byCache: Record<string, number>;
}

export interface AssetResidencySnapshot {
  generation: number;
  entries: Record<string, number>;
}

interface CacheRecord {
  /** Null until the owning module registers. Touches may arrive first. */
  evict: EvictFn | null;
  /** key -> generation last touched. */
  generations: Map<string, number>;
  /** Keys exempt from sweeping (held by something outside the play session). */
  pinned: Set<string>;
}

const caches = new Map<string, CacheRecord>();
let currentGeneration = 0;

function recordFor(cacheName: string): CacheRecord {
  let record = caches.get(cacheName);
  if (!record) {
    // Touches can arrive before the owning module registers its evict callback
    // (module init order). Keep the stamp; the callback is filled in on register.
    record = { evict: null, generations: new Map(), pinned: new Set() };
    caches.set(cacheName, record);
  }
  return record;
}

/** Registers a cache so `sweepUnusedAssets` can evict its stale entries. */
export function registerAssetCache(cacheName: string, evict: EvictFn): void {
  recordFor(cacheName).evict = evict;
}

/** Stamp the current generation on a key. Call on every cache insert AND hit. */
export function touchAsset(cacheName: string, key: string): void {
  recordFor(cacheName).generations.set(key, currentGeneration);
}

/** Marks a key as never-evictable — used for app-lifetime assets and editor-held clones. */
export function pinAsset(cacheName: string, key: string): void {
  const record = recordFor(cacheName);
  record.pinned.add(key);
  record.generations.set(key, currentGeneration);
}

export function unpinAsset(cacheName: string, key: string): void {
  caches.get(cacheName)?.pinned.delete(key);
}

/**
 * Evicts unpinned keys. When `onlyStale` is true (post-publish sweep), keeps
 * keys touched in the current generation. When false (session start), drops
 * every unpinned entry — required after a renderer dispose, because prod
 * `drainSourceReleases` nulls ImageBitmap sources that cannot re-upload into
 * a new WebGPU backend.
 */
function evictUnpinnedAssets(onlyStale: boolean): SweepResult {
  const byCache: Record<string, number> = {};
  let swept = 0;

  for (const [cacheName, record] of caches) {
    const stale: string[] = [];
    for (const [key, generation] of record.generations) {
      if (record.pinned.has(key)) continue;
      if (onlyStale && generation === currentGeneration) continue;
      stale.push(key);
    }
    if (!record.evict) continue;
    for (const key of stale) {
      record.generations.delete(key);
      try {
        record.evict(key);
      } catch (error) {
        console.warn(`[asset-residency] evict failed for ${cacheName}:${key}`, error);
      }
    }
    if (stale.length > 0) byCache[cacheName] = stale.length;
    swept += stale.length;
  }

  if (swept > 0) {
    const label = onlyStale ? 'swept' : 'session-reset';
    console.info(
      `[asset-residency] ${label} ${swept} entries at generation ${currentGeneration}`,
      byCache,
    );
  }
  return { byCache, swept };
}

/** Opens a new generation. Call at the start of a play session. */
export function beginAssetGeneration(): number {
  currentGeneration += 1;
  // Previous play session disposed its WebGPURenderer. Cached templates may
  // still hold textures whose CPU sources were released after upload — those
  // cannot re-init on the new renderer (`image.complete` on null). Drop them
  // before this scene loads so every hit re-decodes a fresh ImageBitmap.
  evictUnpinnedAssets(false);
  return currentGeneration;
}

/**
 * Evicts every unpinned key not touched during the current generation.
 * Call after the new scene is fully published, never during teardown.
 */
export function sweepUnusedAssets(): SweepResult {
  return evictUnpinnedAssets(true);
}

export function getAssetResidencySnapshot(): AssetResidencySnapshot {
  const entries: Record<string, number> = {};
  for (const [cacheName, record] of caches) entries[cacheName] = record.generations.size;
  return { entries, generation: currentGeneration };
}
