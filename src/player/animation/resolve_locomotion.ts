import type { WeaponAnimStanceId } from '../inventory/weapon_select';
import { PISTOL_IDLE_CLIP } from './pistol_clips';
import type { JumpPhase } from '../../types';

const UNARMED_IDLE_CLIP = 'Idle_Loop';
const UNARMED_WALK_CLIP = 'Walk_Loop';
const UNARMED_SPRINT_CLIP = 'Sprint_Loop';
const UNARMED_JUMP_START_CLIP = 'Jump_Start';
const UNARMED_JUMP_LOOP_CLIP = 'Jump_Loop';
const UNARMED_JUMP_LAND_CLIP = 'Jump_Land';

const RIFLE_IDLE_CLIP = 'idle';
const RIFLE_AIM_IDLE_CLIP = 'idle_aiming';
const RIFLE_WALK_CLIP = 'walk_forward';
const RIFLE_RUN_CLIP = 'run_forward';
const RIFLE_SPRINT_CLIP = 'sprint_forward';
const RIFLE_JUMP_START_CLIP = 'jump_up';
const RIFLE_JUMP_LOOP_CLIP = 'jump_loop';
const RIFLE_JUMP_LAND_CLIP = 'jump_down';

const PISTOL_WALK_CLIP = 'pistol_walk';
const PISTOL_RUN_CLIP = 'pistol_run';
const PISTOL_JUMP_CLIP = 'pistol_jump';
const PISTOL_JUMP_LOOP_CLIP = 'pistol_jump_2';

export type LocomotionGait = 'walk' | 'run' | 'sprint';

export interface ResolveLocomotionClipParams {
  stanceId: WeaponAnimStanceId;
  /** Hard aim (RMB). Sprint locomotion takes precedence and suppresses ADS. */
  aiming?: boolean;
  isMoving?: boolean;
  gait?: LocomotionGait;
  jumpPhase?: JumpPhase;
}

export interface LocomotionLayers {
  /** Full-body or lower-body base clip name. */
  baseClip: string;
  /** Upper-body overlay (rifle ADS while moving); null when unused. */
  upperClip: string | null;
}

function rifleGaitClip(gait: LocomotionGait): string {
  if (gait === 'sprint') return RIFLE_SPRINT_CLIP;
  if (gait === 'walk') return RIFLE_WALK_CLIP;
  return RIFLE_RUN_CLIP;
}

/** Sprinting is a full-body locomotion state and cannot be combined with ADS. */
export function resolveLocomotionAiming(
  params: Pick<ResolveLocomotionClipParams, 'aiming' | 'isMoving' | 'gait'>,
): boolean {
  const isMoving = Boolean(params.isMoving);
  const gait = params.gait ?? 'run';
  return Boolean(params.aiming) && !(isMoving && gait === 'sprint');
}

function normalizeParams(
  params: ResolveLocomotionClipParams | WeaponAnimStanceId,
): Required<ResolveLocomotionClipParams> {
  if (typeof params === 'string') {
    return {
      stanceId: params,
      aiming: false,
      isMoving: false,
      gait: 'run',
      jumpPhase: 'grounded',
    };
  }
  const isMoving = Boolean(params.isMoving);
  const gait = params.gait ?? 'run';
  return {
    stanceId: params.stanceId,
    aiming: resolveLocomotionAiming({
      aiming: params.aiming,
      isMoving,
      gait,
    }),
    isMoving,
    gait,
    jumpPhase: params.jumpPhase ?? 'grounded',
  };
}

function jumpClip(stanceId: WeaponAnimStanceId, jumpPhase: JumpPhase): string | null {
  if (jumpPhase === 'grounded') return null;
  if (stanceId === 'rifle') {
    if (jumpPhase === 'jump-start') return RIFLE_JUMP_START_CLIP;
    if (jumpPhase === 'jump-loop') return RIFLE_JUMP_LOOP_CLIP;
    return RIFLE_JUMP_LAND_CLIP;
  }
  if (stanceId === 'pistol') {
    return jumpPhase === 'jump-loop' ? PISTOL_JUMP_LOOP_CLIP : PISTOL_JUMP_CLIP;
  }
  if (jumpPhase === 'jump-start') return UNARMED_JUMP_START_CLIP;
  if (jumpPhase === 'jump-loop') return UNARMED_JUMP_LOOP_CLIP;
  return UNARMED_JUMP_LAND_CLIP;
}

/**
 * Stance + gait + optional upper ADS layer.
 * Rifle ADS while walking/running: loco base + masked idle_aiming upper.
 * Rifle ADS idle: full-body idle_aiming (no upper layer).
 * Rifle sprint: full-body sprint with ADS suppressed.
 */
export function resolveLocomotionLayers(
  params: ResolveLocomotionClipParams | WeaponAnimStanceId,
): LocomotionLayers {
  const { stanceId, aiming, isMoving, gait, jumpPhase } = normalizeParams(params);
  const airborneClip = jumpClip(stanceId, jumpPhase);
  if (airborneClip) return { baseClip: airborneClip, upperClip: null };

  if (stanceId === 'rifle') {
    if (aiming && !isMoving) {
      return { baseClip: RIFLE_AIM_IDLE_CLIP, upperClip: null };
    }
    if (aiming && isMoving) {
      return { baseClip: rifleGaitClip(gait), upperClip: RIFLE_AIM_IDLE_CLIP };
    }
    if (!isMoving) return { baseClip: RIFLE_IDLE_CLIP, upperClip: null };
    return { baseClip: rifleGaitClip(gait), upperClip: null };
  }

  if (stanceId === 'pistol') {
    if (!isMoving) return { baseClip: PISTOL_IDLE_CLIP, upperClip: null };
    if (gait === 'walk') return { baseClip: PISTOL_WALK_CLIP, upperClip: null };
    return { baseClip: PISTOL_RUN_CLIP, upperClip: null };
  }

  if (!isMoving) return { baseClip: UNARMED_IDLE_CLIP, upperClip: null };
  if (gait === 'sprint') return { baseClip: UNARMED_SPRINT_CLIP, upperClip: null };
  return { baseClip: UNARMED_WALK_CLIP, upperClip: null };
}

/** Base clip only (CharacterState.animation). */
export function resolveLocomotionClip(
  params: ResolveLocomotionClipParams | WeaponAnimStanceId,
): string {
  return resolveLocomotionLayers(params).baseClip;
}
