import { PISTOL_IDLE_CLIP } from './pistol_clips';

export const ANIMATION_CONTROLLER_SCHEMA_VERSION = 1 as const;

/** Coarse stance locomotion, jump phases, and rifle aim-idle. */
export const ANIMATION_LOCOMOTION_KINDS = [
  'idle',
  'idle_aiming',
  'idle_crouching',
  'idle_crouching_aiming',
  'walk_crouching',
  'walk',
  'run',
  'sprint',
  'jump_start',
  'jump_loop',
  'jump_land',
] as const;

export type AnimationLocomotionKind = (typeof ANIMATION_LOCOMOTION_KINDS)[number];

/** Built-in UAL source id — always available via SidekickAnimationRuntime. */
export const UAL_ANIMATION_SOURCE_ID = 'ual';

export interface AnimationControllerSourceV1 {
  id: string;
  url: string;
  label: string;
  /** Clip-specific authored-forward correction around the character up axis. */
  yawOffsetDegrees: number;
}

export interface AnimationControllerStanceV1 {
  id: string;
  label: string;
}

export interface AnimationControllerStateV1 {
  id: string;
  label: string;
  locomotion: AnimationLocomotionKind;
  stanceId: string;
  clipName: string;
  sourceId: string;
}

export interface AnimationControllerV1 {
  schemaVersion: typeof ANIMATION_CONTROLLER_SCHEMA_VERSION;
  id: string;
  label: string;
  sources: AnimationControllerSourceV1[];
  stances: AnimationControllerStanceV1[];
  states: AnimationControllerStateV1[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim().slice(0, max);
}

function slug(value: unknown, label: string): string {
  const id = stringValue(value, label, 64);
  if (!ID_PATTERN.test(id)) throw new Error(`${label} must be a lowercase slug.`);
  return id;
}

function isLocomotion(value: unknown): value is AnimationLocomotionKind {
  return typeof value === 'string' && (ANIMATION_LOCOMOTION_KINDS as readonly string[]).includes(value);
}

function parseSource(value: unknown, label: string): AnimationControllerSourceV1 {
  const source = record(value, label);
  const yawOffsetDegrees = source.yawOffsetDegrees ?? 0;
  if (typeof yawOffsetDegrees !== 'number' || !Number.isFinite(yawOffsetDegrees)) {
    throw new Error(`${label}.yawOffsetDegrees must be a finite number.`);
  }
  return {
    id: slug(source.id, `${label}.id`),
    url: stringValue(source.url, `${label}.url`, 512),
    label: stringValue(source.label, `${label}.label`, 80),
    yawOffsetDegrees: Math.max(-180, Math.min(180, yawOffsetDegrees)),
  };
}

function parseStance(value: unknown, label: string): AnimationControllerStanceV1 {
  const source = record(value, label);
  return {
    id: slug(source.id, `${label}.id`),
    label: stringValue(source.label, `${label}.label`, 80),
  };
}

function parseState(value: unknown, label: string): AnimationControllerStateV1 {
  const source = record(value, label);
  if (!isLocomotion(source.locomotion)) {
    throw new Error(`${label}.locomotion is invalid.`);
  }
  if (typeof source.clipName !== 'string') {
    throw new Error(`${label}.clipName must be a string.`);
  }
  return {
    id: slug(source.id, `${label}.id`),
    label: stringValue(source.label, `${label}.label`, 80),
    locomotion: source.locomotion,
    stanceId: slug(source.stanceId, `${label}.stanceId`),
    clipName: source.clipName.trim().slice(0, 128),
    sourceId: slug(source.sourceId, `${label}.sourceId`),
  };
}

export function parseAnimationController(value: unknown): AnimationControllerV1 {
  const source = record(value, 'animationController');
  if (source.schemaVersion !== ANIMATION_CONTROLLER_SCHEMA_VERSION) {
    throw new Error('animationController.schemaVersion must be 1.');
  }
  if (!Array.isArray(source.sources)) throw new Error('animationController.sources must be an array.');
  if (!Array.isArray(source.stances)) throw new Error('animationController.stances must be an array.');
  if (!Array.isArray(source.states)) throw new Error('animationController.states must be an array.');

  const sources = source.sources.map((entry, index) => parseSource(entry, `sources[${index}]`));
  const stances = source.stances.map((entry, index) => parseStance(entry, `stances[${index}]`));
  const states = source.states
    .map((entry, index) => {
      try {
        return parseState(entry, `states[${index}]`);
      } catch {
        return null;
      }
    })
    .filter((state): state is AnimationControllerStateV1 => state !== null);

  if (stances.length === 0) throw new Error('animationController.stances must not be empty.');

  const stanceIds = new Set(stances.map((stance) => stance.id));
  const sourceIds = new Set(sources.map((entry) => entry.id));
  sourceIds.add(UAL_ANIMATION_SOURCE_ID);

  for (const state of states) {
    if (!stanceIds.has(state.stanceId)) {
      throw new Error(`state "${state.id}" references unknown stance "${state.stanceId}".`);
    }
    if (!sourceIds.has(state.sourceId)) {
      throw new Error(`state "${state.id}" references unknown source "${state.sourceId}".`);
    }
  }

  return {
    schemaVersion: ANIMATION_CONTROLLER_SCHEMA_VERSION,
    id: slug(source.id, 'animationController.id'),
    label: stringValue(source.label, 'animationController.label', 80),
    sources,
    stances,
    states,
  };
}

export function cloneAnimationController(document: AnimationControllerV1): AnimationControllerV1 {
  return parseAnimationController(structuredClone(document));
}

export function resolveControllerClip(
  controller: AnimationControllerV1,
  locomotion: AnimationLocomotionKind,
  stanceId: string,
): string | null {
  return resolveControllerState(controller, locomotion, stanceId)?.clipName ?? null;
}

export function resolveControllerState(
  controller: AnimationControllerV1,
  locomotion: AnimationLocomotionKind,
  stanceId: string,
): { clipName: string; sourceId: string } | null {
  const match = controller.states.find(
    (state) => state.locomotion === locomotion && state.stanceId === stanceId && state.clipName,
  );
  if (!match) return null;
  return { clipName: match.clipName, sourceId: match.sourceId };
}

/**
 * Armed pack sources to preload (rifle + pistol). Includes every authored
 * source so walk/run/aim clips are available even if coarse states lag.
 */
export function primaryStanceSources(
  controller: AnimationControllerV1,
): AnimationControllerSourceV1[] {
  const needed = new Set<string>();
  for (const source of controller.sources) {
    if (source.id === UAL_ANIMATION_SOURCE_ID) continue;
    needed.add(source.id);
  }
  for (const state of controller.states) {
    if (state.stanceId !== 'rifle' && state.stanceId !== 'pistol') continue;
    if (!state.clipName || state.sourceId === UAL_ANIMATION_SOURCE_ID) continue;
    needed.add(state.sourceId);
  }
  return controller.sources.filter((source) => needed.has(source.id));
}

/** Locomotion enums use underscores; state ids must be hyphen slugs. */
export function locomotionStateSlug(locomotion: AnimationLocomotionKind): string {
  return locomotion.replaceAll('_', '-');
}

const PRO_RIFLE_ROOT = '/src/assets/protected/animations/pro-rifle';
const HANDGUN_LOCOMOTION_ROOT = '/src/assets/protected/animations/handgun-locomotions';
const RIFLE_IDLE_CLIP = 'idle';
const RIFLE_AIM_IDLE_CLIP = 'idle_aiming';
const RIFLE_CROUCH_IDLE_CLIP = 'idle_crouching';
const RIFLE_CROUCH_AIM_IDLE_CLIP = 'idle_crouching_aiming';
const RIFLE_CROUCH_WALK_CLIP = 'walk_crouching_forward';
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

function packSourceId(prefix: string, clipStem: string): string {
  return `${prefix}-${clipStem.replaceAll('_', '-')}`;
}

export function buildDefaultAnimationController(): AnimationControllerV1 {
  const stances: AnimationControllerStanceV1[] = [
    { id: 'unarmed', label: 'Unarmed' },
    { id: 'rifle', label: 'Rifle' },
    { id: 'pistol', label: 'Pistol' },
  ];

  // Pro Rifle idle/aim authors ~55° root yaw when Body Orientation remaps.
  // Temporarily 0 while testing Unity import "Based Upon = Original" + re-export.
  // Restore -54 on idle / idle_aiming if facing is still wrong after that.
  const rifleYawByClip: Record<string, number> = {
    // [RIFLE_IDLE_CLIP]: -54,
    // [RIFLE_AIM_IDLE_CLIP]: -54,
  };
  const rifleClips = [
    RIFLE_IDLE_CLIP,
    RIFLE_AIM_IDLE_CLIP,
    RIFLE_CROUCH_IDLE_CLIP,
    RIFLE_CROUCH_AIM_IDLE_CLIP,
    RIFLE_CROUCH_WALK_CLIP,
    RIFLE_WALK_CLIP,
    RIFLE_RUN_CLIP,
    RIFLE_SPRINT_CLIP,
    RIFLE_JUMP_START_CLIP,
    RIFLE_JUMP_LOOP_CLIP,
    RIFLE_JUMP_LAND_CLIP,
  ];
  const pistolClips = [
    PISTOL_IDLE_CLIP,
    PISTOL_WALK_CLIP,
    PISTOL_RUN_CLIP,
    PISTOL_JUMP_CLIP,
    PISTOL_JUMP_LOOP_CLIP,
  ];
  const sources: AnimationControllerSourceV1[] = [
    ...rifleClips.map((clipStem) => ({
      id: packSourceId('r8', clipStem),
      url: `${PRO_RIFLE_ROOT}/${clipStem}.glb`,
      label: clipStem,
      yawOffsetDegrees: rifleYawByClip[clipStem] ?? 0,
    })),
    ...pistolClips.map((clipStem) => ({
      id: packSourceId('hg', clipStem),
      url: `${HANDGUN_LOCOMOTION_ROOT}/${clipStem}.glb`,
      label: clipStem,
      yawOffsetDegrees: 0,
    })),
  ];

  const states: AnimationControllerStateV1[] = [
    {
      id: 'unarmed-idle',
      label: 'Unarmed Idle',
      locomotion: 'idle',
      stanceId: 'unarmed',
      clipName: 'Idle_Loop',
      sourceId: UAL_ANIMATION_SOURCE_ID,
    },
    {
      id: 'unarmed-walk',
      label: 'Unarmed Walk',
      locomotion: 'walk',
      stanceId: 'unarmed',
      clipName: 'Walk_Loop',
      sourceId: UAL_ANIMATION_SOURCE_ID,
    },
    {
      id: 'unarmed-run',
      label: 'Unarmed Run',
      locomotion: 'run',
      stanceId: 'unarmed',
      clipName: 'Walk_Loop',
      sourceId: UAL_ANIMATION_SOURCE_ID,
    },
    {
      id: 'unarmed-sprint',
      label: 'Unarmed Sprint',
      locomotion: 'sprint',
      stanceId: 'unarmed',
      clipName: 'Sprint_Loop',
      sourceId: UAL_ANIMATION_SOURCE_ID,
    },
    {
      id: 'unarmed-jump-start',
      label: 'Unarmed Jump Start',
      locomotion: 'jump_start',
      stanceId: 'unarmed',
      clipName: 'Jump_Start',
      sourceId: UAL_ANIMATION_SOURCE_ID,
    },
    {
      id: 'unarmed-jump-loop',
      label: 'Unarmed Jump Loop',
      locomotion: 'jump_loop',
      stanceId: 'unarmed',
      clipName: 'Jump_Loop',
      sourceId: UAL_ANIMATION_SOURCE_ID,
    },
    {
      id: 'unarmed-jump-land',
      label: 'Unarmed Jump Land',
      locomotion: 'jump_land',
      stanceId: 'unarmed',
      clipName: 'Jump_Land',
      sourceId: UAL_ANIMATION_SOURCE_ID,
    },
    {
      id: 'rifle-idle',
      label: 'Rifle Idle',
      locomotion: 'idle',
      stanceId: 'rifle',
      clipName: RIFLE_IDLE_CLIP,
      sourceId: packSourceId('r8', RIFLE_IDLE_CLIP),
    },
    {
      id: 'rifle-idle-aiming',
      label: 'Rifle Idle Aiming',
      locomotion: 'idle_aiming',
      stanceId: 'rifle',
      clipName: RIFLE_AIM_IDLE_CLIP,
      sourceId: packSourceId('r8', RIFLE_AIM_IDLE_CLIP),
    },
    {
      id: 'rifle-idle-crouching',
      label: 'Rifle Idle Crouching',
      locomotion: 'idle_crouching',
      stanceId: 'rifle',
      clipName: RIFLE_CROUCH_IDLE_CLIP,
      sourceId: packSourceId('r8', RIFLE_CROUCH_IDLE_CLIP),
    },
    {
      id: 'rifle-idle-crouching-aiming',
      label: 'Rifle Idle Crouching Aiming',
      locomotion: 'idle_crouching_aiming',
      stanceId: 'rifle',
      clipName: RIFLE_CROUCH_AIM_IDLE_CLIP,
      sourceId: packSourceId('r8', RIFLE_CROUCH_AIM_IDLE_CLIP),
    },
    {
      id: 'rifle-walk-crouching',
      label: 'Rifle Walk Crouching',
      locomotion: 'walk_crouching',
      stanceId: 'rifle',
      clipName: RIFLE_CROUCH_WALK_CLIP,
      sourceId: packSourceId('r8', RIFLE_CROUCH_WALK_CLIP),
    },
    {
      id: 'rifle-walk',
      label: 'Rifle Walk',
      locomotion: 'walk',
      stanceId: 'rifle',
      clipName: RIFLE_WALK_CLIP,
      sourceId: packSourceId('r8', RIFLE_WALK_CLIP),
    },
    {
      id: 'rifle-run',
      label: 'Rifle Run',
      locomotion: 'run',
      stanceId: 'rifle',
      clipName: RIFLE_RUN_CLIP,
      sourceId: packSourceId('r8', RIFLE_RUN_CLIP),
    },
    {
      id: 'rifle-sprint',
      label: 'Rifle Sprint',
      locomotion: 'sprint',
      stanceId: 'rifle',
      clipName: RIFLE_SPRINT_CLIP,
      sourceId: packSourceId('r8', RIFLE_SPRINT_CLIP),
    },
    {
      id: 'rifle-jump-start',
      label: 'Rifle Jump Start',
      locomotion: 'jump_start',
      stanceId: 'rifle',
      clipName: RIFLE_JUMP_START_CLIP,
      sourceId: packSourceId('r8', RIFLE_JUMP_START_CLIP),
    },
    {
      id: 'rifle-jump-loop',
      label: 'Rifle Jump Loop',
      locomotion: 'jump_loop',
      stanceId: 'rifle',
      clipName: RIFLE_JUMP_LOOP_CLIP,
      sourceId: packSourceId('r8', RIFLE_JUMP_LOOP_CLIP),
    },
    {
      id: 'rifle-jump-land',
      label: 'Rifle Jump Land',
      locomotion: 'jump_land',
      stanceId: 'rifle',
      clipName: RIFLE_JUMP_LAND_CLIP,
      sourceId: packSourceId('r8', RIFLE_JUMP_LAND_CLIP),
    },
    {
      id: 'pistol-idle',
      label: 'Pistol Idle',
      locomotion: 'idle',
      stanceId: 'pistol',
      clipName: PISTOL_IDLE_CLIP,
      sourceId: packSourceId('hg', PISTOL_IDLE_CLIP),
    },
    {
      id: 'pistol-walk',
      label: 'Pistol Walk',
      locomotion: 'walk',
      stanceId: 'pistol',
      clipName: PISTOL_WALK_CLIP,
      sourceId: packSourceId('hg', PISTOL_WALK_CLIP),
    },
    {
      id: 'pistol-run',
      label: 'Pistol Run',
      locomotion: 'run',
      stanceId: 'pistol',
      clipName: PISTOL_RUN_CLIP,
      sourceId: packSourceId('hg', PISTOL_RUN_CLIP),
    },
    {
      id: 'pistol-sprint',
      label: 'Pistol Sprint',
      locomotion: 'sprint',
      stanceId: 'pistol',
      clipName: PISTOL_RUN_CLIP,
      sourceId: packSourceId('hg', PISTOL_RUN_CLIP),
    },
    {
      id: 'pistol-jump-start',
      label: 'Pistol Jump Start',
      locomotion: 'jump_start',
      stanceId: 'pistol',
      clipName: PISTOL_JUMP_CLIP,
      sourceId: packSourceId('hg', PISTOL_JUMP_CLIP),
    },
    {
      id: 'pistol-jump-loop',
      label: 'Pistol Jump Loop',
      locomotion: 'jump_loop',
      stanceId: 'pistol',
      clipName: PISTOL_JUMP_LOOP_CLIP,
      sourceId: packSourceId('hg', PISTOL_JUMP_LOOP_CLIP),
    },
    {
      id: 'pistol-jump-land',
      label: 'Pistol Jump Land',
      locomotion: 'jump_land',
      stanceId: 'pistol',
      clipName: PISTOL_JUMP_CLIP,
      sourceId: packSourceId('hg', PISTOL_JUMP_CLIP),
    },
  ];

  return {
    schemaVersion: ANIMATION_CONTROLLER_SCHEMA_VERSION,
    id: 'default',
    label: 'Default Character',
    sources,
    stances,
    states,
  };
}
