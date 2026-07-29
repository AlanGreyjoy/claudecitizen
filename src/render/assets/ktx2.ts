import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader';

/**
 * Shared KTX2 / Basis Universal decoding for every GLTFLoader in the app.
 *
 * Textures transcoded by `scripts/transcode_project_textures.mjs` arrive as
 * `KHR_texture_basisu` payloads. That extension is written as *required*, so a
 * GLTFLoader without a KTX2 loader attached throws on parse — every loader site
 * must call `attachKtx2Loader`, including geometry-only ones like collider
 * baking. With no derived assets present this module is inert: nothing in the
 * GLB references the extension and the transcoder is never fetched.
 *
 * One loader instance app-wide. `KTX2Loader` owns a `WorkerPool`, and each
 * worker holds its own `basis_transcoder.wasm` instance — ten loaders with ten
 * pools would mean up to forty workers and forty wasm heaps.
 */

/** Served from `public/basis/`, which the web build stages verbatim. */
const TRANSCODER_PATH = '/basis/';

let sharedLoader: KTX2Loader | null = null;
let supportRenderer: THREE.WebGLRenderer | null = null;
let supportDetected = false;
let supportLogged = false;

function getKtx2Loader(): KTX2Loader {
  if (!sharedLoader) {
    sharedLoader = new KTX2Loader();
    sharedLoader.setTranscoderPath(TRANSCODER_PATH);
    const cores = typeof navigator === 'undefined' ? 4 : (navigator.hardwareConcurrency ?? 4);
    sharedLoader.setWorkerLimit(Math.max(1, Math.min(4, cores)));
  }
  return sharedLoader;
}

/**
 * Registers the app's main renderer as the source of truth for compressed
 * format support. Called from `createWebGlRenderer`, which runs before any
 * scene content loads.
 */
export function setKtx2SupportRenderer(renderer: THREE.WebGLRenderer): void {
  supportRenderer = renderer;
  if (supportDetected) return;
  getKtx2Loader().detectSupport(renderer);
  supportDetected = true;
  logSupportOnce();
}

/**
 * Creates a throwaway 1x1 context purely to read the extension list.
 * `detectSupport` only inspects `renderer.extensions`, so a probe on the same
 * GPU reports the same formats the real renderer would.
 */
function detectSupportWithProbeRenderer(): void {
  if (typeof document === 'undefined') return;
  let probe: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    probe = new THREE.WebGLRenderer({ canvas });
    getKtx2Loader().detectSupport(probe);
    supportDetected = true;
  } catch (error) {
    console.warn('[ktx2] could not detect compressed texture support', error);
  } finally {
    probe?.dispose();
  }
}

/**
 * Guarantees `detectSupport` has run before a KTX2 payload is parsed —
 * `KTX2Loader.parse` throws without it. Call from load paths that can run
 * before the main renderer exists (collider baking, editor thumbnails).
 * Cheap no-op once detection has happened.
 */
export function ensureKtx2Support(): void {
  if (supportDetected) return;
  if (supportRenderer) {
    getKtx2Loader().detectSupport(supportRenderer);
    supportDetected = true;
  } else {
    detectSupportWithProbeRenderer();
  }
  logSupportOnce();
}

function logSupportOnce(): void {
  if (supportLogged || !supportDetected) return;
  supportLogged = true;
  const config = (sharedLoader as unknown as { workerConfig?: Record<string, boolean> })
    .workerConfig;
  console.info('[ktx2] compressed texture support', config ?? '(unknown)');
}

/**
 * Attaches the shared KTX2 loader to a GLTFLoader.
 *
 * Deliberately does NOT detect support: most loader sites construct at module
 * scope, and probing there would create a throwaway WebGL context on import.
 * Detection is driven by `setKtx2SupportRenderer` (every real renderer calls it)
 * with `ensureKtx2Support` as the backstop on load paths that can run first.
 * Constructing the KTX2Loader is cheap — its worker pool stays cold until a
 * KTX2 payload actually arrives.
 */
export function attachKtx2Loader(loader: GLTFLoader): GLTFLoader {
  loader.setKTX2Loader(getKtx2Loader());
  return loader;
}

/** Which compressed formats this machine resolved to, for diagnostics. */
export function getKtx2SupportSummary(): Record<string, boolean> | null {
  if (!sharedLoader || !supportDetected) return null;
  const config = (sharedLoader as unknown as { workerConfig?: Record<string, boolean> })
    .workerConfig;
  return config ?? null;
}

/**
 * Tears down the worker pool. App-lifetime resource — must NOT be called on a
 * scene switch, or every scene re-instantiates the transcoder wasm.
 */
export function disposeKtx2Loader(): void {
  sharedLoader?.dispose();
  sharedLoader = null;
  supportDetected = false;
  supportLogged = false;
}
