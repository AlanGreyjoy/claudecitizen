import type { AnimationLocomotionKind } from '../../../../player/animation/schema';

export const EQUIPMENT_DND_TYPE = 'application/x-claudecitizen-equipment-definition';

export const LOCOMOTION_LABELS: Record<AnimationLocomotionKind, string> = {
  idle: 'Idle',
  idle_aiming: 'Idle Aiming',
  idle_crouching: 'Idle Crouching',
  idle_crouching_aiming: 'Idle Crouching Aiming',
  walk_crouching: 'Walk Crouching',
  walk: 'Walk',
  run: 'Run',
  sprint: 'Sprint',
  jump_start: 'Jump Start',
  jump_loop: 'Jump Loop',
  jump_land: 'Jump Land',
};

export const ATTACHMENT_BONES = [
  'backAttach',
  'hipAttach_l',
  'hipAttach_r',
  'hipAttachFront',
  'hipAttachBack',
  'hand_l',
  'hand_r',
  'prop_l',
  'prop_r',
] as const;
