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

export function locomotionFromGameplay(
  jumpPhase: JumpPhase,
  isMoving: boolean,
  isSprinting: boolean,
): AnimationLocomotionKind {
  if (jumpPhase === 'jump-start') return 'jump_start';
  if (jumpPhase === 'jump-loop') return 'jump_loop';
  if (jumpPhase === 'jump-land') return 'jump_land';
  if (isMoving && isSprinting) return 'sprint';
  if (isMoving) return 'walk';
  return 'idle';
}
