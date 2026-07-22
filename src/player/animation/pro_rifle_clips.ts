import type { JumpPhase } from '../../types/character';

/** 8-way move octant relative to character facing (Pro Rifle clip suffixes). */
export const MOVE_OCTANTS = [
  'forward',
  'forward_left',
  'left',
  'backward_left',
  'backward',
  'backward_right',
  'right',
  'forward_right',
] as const;

export type MoveOctant = (typeof MOVE_OCTANTS)[number];

export type ProRifleGait = 'walk' | 'run' | 'sprint';

export interface ProRifleClipParams {
  jumpPhase: JumpPhase;
  isMoving: boolean;
  gait: ProRifleGait;
  octant: MoveOctant;
  crouch: boolean;
  aiming: boolean;
}

/**
 * Map gameplay pose → Pro Rifle GLB clip stem (filename without .glb).
 * Turns and deaths are intentionally omitted — no gameplay drivers yet.
 */
export function resolveProRifleClip(params: ProRifleClipParams): string {
  const { jumpPhase, isMoving, gait, octant, crouch, aiming } = params;
  if (jumpPhase === 'jump-start') return 'jump_up';
  if (jumpPhase === 'jump-loop') return 'jump_loop';
  if (jumpPhase === 'jump-land') return 'jump_down';

  if (!isMoving) {
    if (crouch && aiming) return 'idle_crouching_aiming';
    if (crouch) return 'idle_crouching';
    if (aiming) return 'idle_aiming';
    return 'idle';
  }

  if (crouch) return `walk_crouching_${octant}`;
  if (gait === 'sprint') return `sprint_${octant}`;
  if (gait === 'walk') return `walk_${octant}`;
  return `run_${octant}`;
}

/** All Pro Rifle locomotion clips used by gameplay (excludes turns + deaths). */
export const PRO_RIFLE_LOCOMOTION_CLIPS: readonly string[] = (() => {
  const clips = new Set<string>([
    'idle',
    'idle_aiming',
    'idle_crouching',
    'idle_crouching_aiming',
    'jump_up',
    'jump_loop',
    'jump_down',
  ]);
  for (const octant of MOVE_OCTANTS) {
    clips.add(`walk_${octant}`);
    clips.add(`walk_crouching_${octant}`);
    clips.add(`run_${octant}`);
    clips.add(`sprint_${octant}`);
  }
  return [...clips].sort();
})();

/** Catalog-only Pro Rifle clips (no gameplay resolver yet). */
export const PRO_RIFLE_CATALOG_ONLY_CLIPS: readonly string[] = [
  'turn_90_left',
  'turn_90_right',
  'crouching_turn_90_left',
  'crouching_turn_90_right',
  'death_crouching_headshot_front',
  'death_from_back_headshot',
  'death_from_front_headshot',
  'death_from_right',
  'death_from_the_back',
  'death_from_the_front',
] as const;
