import {
  MOVE_OCTANTS,
  PRO_RIFLE_CATALOG_ONLY_CLIPS,
  PRO_RIFLE_LOCOMOTION_CLIPS,
} from './pro_rifle_clips';

export const ANIMATION_CONTROLLER_SCHEMA_VERSION = 1 as const;

export const ANIMATION_LOCOMOTION_KINDS = [
  'idle',
  'idle_aiming',
  'walk',
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
  const states = source.states.map((entry, index) => parseState(entry, `states[${index}]`));

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

function packSourceId(prefix: string, clipStem: string): string {
  return `${prefix}-${clipStem.replaceAll('_', '-')}`;
}

const PRO_RIFLE_LOCOMOTION_SOURCE_IDS = new Set(
  PRO_RIFLE_LOCOMOTION_CLIPS.map((clip) => packSourceId('r8', clip)),
);

/**
 * Primary locomotion sources for rifle + pistol.
 * Rifle includes the full directional/crouch gameplay pack (excludes turns/deaths).
 */
export function primaryStanceSources(
  controller: AnimationControllerV1,
): AnimationControllerSourceV1[] {
  const needed = new Set<string>();
  for (const state of controller.states) {
    if (state.stanceId !== 'rifle' && state.stanceId !== 'pistol') continue;
    if (!state.clipName || state.sourceId === UAL_ANIMATION_SOURCE_ID) continue;
    needed.add(state.sourceId);
  }
  for (const sourceId of PRO_RIFLE_LOCOMOTION_SOURCE_IDS) {
    needed.add(sourceId);
  }
  return controller.sources.filter((source) => needed.has(source.id));
}

/** Locomotion enums use underscores; state ids must be hyphen slugs. */
export function locomotionStateSlug(locomotion: AnimationLocomotionKind): string {
  return locomotion.replaceAll('_', '-');
}

const PRO_RIFLE_ROOT = '/src/assets/protected/animations/pro-rifle';
const HANDGUN_LOCOMOTION_ROOT = '/src/assets/protected/animations/handgun-locomotions';

/** Measured from each in-place clip's foot-travel (or aim) axis; +Z is gameplay forward. */
const PRO_RIFLE_WALK_RUN_YAW_DEGREES = -30;
const PRO_RIFLE_AIM_YAW_DEGREES = -55;

function buildProRifleYawOffsets(): Readonly<Partial<Record<string, number>>> {
  const offsets: Record<string, number> = {
    // Aim-idle holds the rifle ~55deg left of the root's facing.
    idle_aiming: PRO_RIFLE_AIM_YAW_DEGREES,
    idle_crouching_aiming: PRO_RIFLE_AIM_YAW_DEGREES,
  };
  // Walk / run / crouch-walk share the measured walk_forward bias.
  // Sprint stays at 0 — same as the prior primary sprint_forward binding.
  for (const octant of MOVE_OCTANTS) {
    offsets[`walk_${octant}`] = PRO_RIFLE_WALK_RUN_YAW_DEGREES;
    offsets[`walk_crouching_${octant}`] = PRO_RIFLE_WALK_RUN_YAW_DEGREES;
    offsets[`run_${octant}`] = PRO_RIFLE_WALK_RUN_YAW_DEGREES;
  }
  return offsets;
}

const PRO_RIFLE_YAW_OFFSETS = buildProRifleYawOffsets();
const HANDGUN_YAW_OFFSETS: Readonly<Partial<Record<string, number>>> = {
  pistol_walk: -27,
  pistol_run: -19,
};

/** Coarse rifle states for editor / backward compat (forward axis). */
const PRO_RIFLE_LOCOMOTION: Record<AnimationLocomotionKind, string> = {
  idle: 'idle',
  idle_aiming: 'idle_aiming',
  walk: 'walk_forward',
  sprint: 'sprint_forward',
  jump_start: 'jump_up',
  jump_loop: 'jump_loop',
  jump_land: 'jump_down',
};

/** Primary pistol locomotion → handgun-locomotions clip. */
const HANDGUN_LOCOMOTION: Record<AnimationLocomotionKind, string> = {
  idle: 'pistol_idle',
  // No handgun aim-idle clip in the pack yet; plain idle composes with spine aim.
  idle_aiming: 'pistol_idle',
  walk: 'pistol_walk',
  sprint: 'pistol_run',
  jump_start: 'pistol_jump',
  jump_loop: 'pistol_jump_2',
  jump_land: 'pistol_jump',
};

export function buildDefaultAnimationController(): AnimationControllerV1 {
  const locomotionLabels: Record<AnimationLocomotionKind, string> = {
    idle: 'Idle',
    idle_aiming: 'Idle Aiming',
    walk: 'Walk',
    sprint: 'Sprint',
    jump_start: 'Jump Start',
    jump_loop: 'Jump Loop',
    jump_land: 'Jump Land',
  };
  const ualClips: Record<AnimationLocomotionKind, string> = {
    idle: 'Idle_Loop',
    // Unarmed has no aim-idle clip; plain idle composes with spine aim.
    idle_aiming: 'Idle_Loop',
    walk: 'Walk_Loop',
    sprint: 'Sprint_Loop',
    jump_start: 'Jump_Start',
    jump_loop: 'Jump_Loop',
    jump_land: 'Jump_Land',
  };

  const stances: AnimationControllerStanceV1[] = [
    { id: 'unarmed', label: 'Unarmed' },
    { id: 'rifle', label: 'Rifle' },
    { id: 'pistol', label: 'Pistol' },
  ];

  const rifleClips = [
    ...new Set([...PRO_RIFLE_LOCOMOTION_CLIPS, ...PRO_RIFLE_CATALOG_ONLY_CLIPS]),
  ].sort();
  const handgunClips = [...new Set(Object.values(HANDGUN_LOCOMOTION))];
  const sources: AnimationControllerSourceV1[] = [
    ...rifleClips.map((clipStem) => ({
      id: packSourceId('r8', clipStem),
      url: `${PRO_RIFLE_ROOT}/${clipStem}.glb`,
      label: clipStem,
      yawOffsetDegrees: PRO_RIFLE_YAW_OFFSETS[clipStem] ?? 0,
    })),
    ...handgunClips.map((clipStem) => ({
      id: packSourceId('hg', clipStem),
      url: `${HANDGUN_LOCOMOTION_ROOT}/${clipStem}.glb`,
      label: clipStem,
      yawOffsetDegrees: HANDGUN_YAW_OFFSETS[clipStem] ?? 0,
    })),
  ];

  const states: AnimationControllerStateV1[] = [];
  for (const stance of stances) {
    for (const locomotion of ANIMATION_LOCOMOTION_KINDS) {
      if (stance.id === 'unarmed') {
        states.push({
          id: `${stance.id}-${locomotionStateSlug(locomotion)}`,
          label: `${stance.label} ${locomotionLabels[locomotion]}`,
          locomotion,
          stanceId: stance.id,
          clipName: ualClips[locomotion],
          sourceId: UAL_ANIMATION_SOURCE_ID,
        });
        continue;
      }
      if (stance.id === 'rifle') {
        const clipStem = PRO_RIFLE_LOCOMOTION[locomotion];
        states.push({
          id: `${stance.id}-${locomotionStateSlug(locomotion)}`,
          label: `${stance.label} ${locomotionLabels[locomotion]}`,
          locomotion,
          stanceId: stance.id,
          clipName: clipStem,
          sourceId: packSourceId('r8', clipStem),
        });
        continue;
      }
      const clipStem = HANDGUN_LOCOMOTION[locomotion];
      states.push({
        id: `${stance.id}-${locomotionStateSlug(locomotion)}`,
        label: `${stance.label} ${locomotionLabels[locomotion]}`,
        locomotion,
        stanceId: stance.id,
        clipName: clipStem,
        sourceId: packSourceId('hg', clipStem),
      });
    }
  }

  return {
    schemaVersion: ANIMATION_CONTROLLER_SCHEMA_VERSION,
    id: 'default',
    label: 'Default Character',
    sources,
    stances,
    states,
  };
}
