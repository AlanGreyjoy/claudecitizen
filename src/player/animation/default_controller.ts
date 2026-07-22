import defaultControllerJson from './data/default.controller.json';
import {
  parseAnimationController,
  type AnimationControllerV1,
  type AnimationLocomotionKind,
} from './schema';
import type { JumpPhase } from '../../types/character';

let cached: AnimationControllerV1 | null = null;

export function getDefaultAnimationController(): AnimationControllerV1 {
  if (!cached) {
    cached = parseAnimationController(defaultControllerJson);
  }
  return cached;
}

/**
 * Dev editor saves are excluded from Vite HMR, so gameplay must refresh the
 * controller through the editor API instead of relying on the imported JSON.
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

export function locomotionFromGameplay(
  jumpPhase: JumpPhase,
  isMoving: boolean,
  isSprinting: boolean,
  aiming = false,
): AnimationLocomotionKind {
  if (jumpPhase === 'jump-start') return 'jump_start';
  if (jumpPhase === 'jump-loop') return 'jump_loop';
  if (jumpPhase === 'jump-land') return 'jump_land';
  if (isMoving && isSprinting) return 'sprint';
  if (isMoving) return 'walk';
  return aiming ? 'idle_aiming' : 'idle';
}
