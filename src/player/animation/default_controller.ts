import defaultControllerJson from './data/default.controller.json';
import {
  cloneAnimationController,
  parseAnimationController,
  type AnimationControllerV1,
} from './schema';

let cached: AnimationControllerV1 | null = null;

function loadBundledController(): AnimationControllerV1 {
  return parseAnimationController(defaultControllerJson);
}

/** Current default controller. Read by gameplay; mutated only by the dev editor / live load. */
export function getDefaultAnimationController(): AnimationControllerV1 {
  if (!cached) {
    cached = loadBundledController();
  }
  return cached;
}

/** Dev-editor live authoring hook. Production builds never call this. */
export function setDefaultAnimationController(next: AnimationControllerV1): void {
  cached = cloneAnimationController(next);
}

/**
 * Dev editor saves are excluded from Vite HMR, so gameplay must refresh the
 * controller through the editor API instead of relying on the imported JSON.
 * Same pattern as `loadCurrentCharacterSettings`.
 */
export async function loadCurrentDefaultAnimationController(): Promise<AnimationControllerV1> {
  if (!import.meta.env.DEV) return getDefaultAnimationController();
  try {
    const response = await fetch('/__editor/animation-controllers?id=default', {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Editor animation controller request failed (${response.status}).`);
    }
    const payload = await response.json() as { document?: unknown };
    cached = parseAnimationController(payload.document);
  } catch (error) {
    console.warn('Could not load the current animation controller; using the bundled copy.', error);
  }
  return getDefaultAnimationController();
}
