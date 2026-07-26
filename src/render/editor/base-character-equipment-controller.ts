import {
  UAL_ANIMATION_SOURCE_ID,
  buildDefaultAnimationController,
  cloneAnimationController,
  resolveControllerClip,
  resolveControllerState,
  type AnimationControllerV1,
  type AnimationLocomotionKind,
} from '../../player/animation/schema';
import { setDefaultAnimationController } from '../../player/animation/default-controller';
import {
  fetchAnimationController,
  fetchAnimationControllerList,
  type AnimationControllerListEntry,
} from '../../editor/api';
import type { SidekickAnimationRuntime } from '../characters/sidekick/animation-runtime';
import type { CharacterPreviewPose } from './base-character-equipment-ui';
import { LOCOMOTION_LABELS, labelFromUrl, slugFromUrl } from './base-character-equipment-utils';

export interface ControllerClipContext {
  getControllerState: () => AnimationControllerV1 | null;
  setControllerState: (value: AnimationControllerV1 | null) => void;
  getControllerList: () => AnimationControllerListEntry[];
  setControllerList: (value: AnimationControllerListEntry[]) => void;
  getSelectedControllerId: () => string;
  setSelectedControllerId: (value: string) => void;
  getSelectedStanceId: () => string;
  setSelectedStanceId: (value: string) => void;
  getPreviewLocomotion: () => AnimationLocomotionKind;
  setPreviewLocomotion: (value: AnimationLocomotionKind) => void;
  getLastLoadedSourceId: () => string;
  setLastLoadedSourceId: (value: string) => void;
  getControllerDirty: () => boolean;
  setControllerDirty: (value: boolean) => void;
  getAnimation: () => SidekickAnimationRuntime | null;
  getPreviewPose: () => CharacterPreviewPose;
  markControllerDirty: () => void;
  notifyUiChange: () => void;
  setStageStatus: (message: string, error?: boolean) => void;
  ensureAnimatedPose: () => Promise<void>;
  controllerSourceLoads: Map<string, Promise<void>>;
}

export function ensureSourceForUrl(ctx: ControllerClipContext, url: string): string {
  const controllerState = ctx.getControllerState();
  if (!controllerState) return UAL_ANIMATION_SOURCE_ID;
  const existing = controllerState.sources.find((source) => source.url === url);
  if (existing) {
    ctx.setLastLoadedSourceId(existing.id);
    return existing.id;
  }
  let id = slugFromUrl(url);
  const taken = new Set(controllerState.sources.map((source) => source.id));
  taken.add(UAL_ANIMATION_SOURCE_ID);
  if (taken.has(id)) {
    let suffix = 2;
    while (taken.has(`${id}-${suffix}`)) suffix += 1;
    id = `${id}-${suffix}`;
  }
  controllerState.sources.push({ id, url, label: labelFromUrl(url), yawOffsetDegrees: 0 });
  ctx.setLastLoadedSourceId(id);
  ctx.markControllerDirty();
  return id;
}

export async function loadController(
  ctx: ControllerClipContext,
  id: string,
  opts?: { force?: boolean },
): Promise<void> {
  if (
    !opts?.force &&
    ctx.getControllerDirty() &&
    !window.confirm('Discard unsaved animation controller changes?')
  ) {
    return;
  }
  try {
    const controllerList = await fetchAnimationControllerList();
    ctx.setControllerList(controllerList);
    if (controllerList.length === 0) {
      const controllerState = cloneAnimationController(buildDefaultAnimationController());
      ctx.setControllerState(controllerState);
      ctx.setSelectedControllerId(controllerState.id);
    } else {
      const targetId = controllerList.some((entry) => entry.id === id)
        ? id
        : controllerList[0]!.id;
      const controllerState = cloneAnimationController(await fetchAnimationController(targetId));
      ctx.setControllerState(controllerState);
      ctx.setSelectedControllerId(controllerState.id);
    }
    const controllerState = ctx.getControllerState();
    ctx.setSelectedStanceId(controllerState?.stances[0]?.id ?? 'unarmed');
    ctx.setControllerDirty(false);
    if (controllerState?.id === 'default') {
      setDefaultAnimationController(controllerState);
    }
    ctx.notifyUiChange();
  } catch (error) {
    const controllerState = cloneAnimationController(buildDefaultAnimationController());
    ctx.setControllerState(controllerState);
    ctx.setSelectedControllerId(controllerState.id);
    ctx.setSelectedStanceId(controllerState.stances[0]?.id ?? 'unarmed');
    ctx.setControllerDirty(false);
    setDefaultAnimationController(controllerState);
    ctx.setStageStatus(
      error instanceof Error
        ? `Controller load failed (${error.message}); using in-memory default.`
        : 'Controller load failed; using in-memory default.',
      true,
    );
    ctx.notifyUiChange();
  }
}

export async function ensureControllerClipLoaded(
  ctx: ControllerClipContext,
  clipName: string,
): Promise<string | null> {
  const controllerState = ctx.getControllerState();
  const animation = ctx.getAnimation();
  if (!controllerState || !animation || !clipName) return null;
  if (animation.clipNames.includes(clipName)) return clipName;
  const state = controllerState.states.find((entry) => entry.clipName === clipName);
  const source = (
    state
      ? controllerState.sources.find((entry) => entry.id === state.sourceId)
      : null
  ) ?? controllerState.sources.find(
    (entry) => entry.label === clipName
      || entry.id.endsWith(`-${clipName.replaceAll('_', '-')}`),
  );
  if (!source) {
    return animation.clipNames.includes(clipName) ? clipName : null;
  }
  let pending = ctx.controllerSourceLoads.get(source.id);
  if (!pending) {
    pending = animation.loadAnimationSource(
      source.url,
      clipName,
      source.yawOffsetDegrees,
      { activate: false },
    );
    ctx.controllerSourceLoads.set(source.id, pending);
  }
  try {
    await pending;
    ctx.setLastLoadedSourceId(source.id);
  } finally {
    if (ctx.controllerSourceLoads.get(source.id) === pending) {
      ctx.controllerSourceLoads.delete(source.id);
    }
  }
  return animation.clipNames.includes(clipName) ? clipName : null;
}

export async function loadControllerStateClip(
  ctx: ControllerClipContext,
  locomotion: AnimationLocomotionKind,
  stanceId: string,
): Promise<string | null> {
  const controllerState = ctx.getControllerState();
  if (!controllerState) return null;
  const state = resolveControllerState(controllerState, locomotion, stanceId);
  if (!state) return null;
  return ensureControllerClipLoaded(ctx, state.clipName);
}

export async function previewControllerState(ctx: ControllerClipContext): Promise<void> {
  const controllerState = ctx.getControllerState();
  const animation = ctx.getAnimation();
  if (!controllerState || !animation) return;
  const previewLocomotion = ctx.getPreviewLocomotion();
  const selectedStanceId = ctx.getSelectedStanceId();
  const configuredClip = resolveControllerClip(
    controllerState,
    previewLocomotion,
    selectedStanceId,
  );
  let clipName: string | null;
  try {
    clipName = await loadControllerStateClip(ctx, previewLocomotion, selectedStanceId);
  } catch (error) {
    ctx.setStageStatus(
      error instanceof Error ? error.message : 'Controller animation failed to load.',
      true,
    );
    return;
  }
  if (!clipName) {
    ctx.setStageStatus(
      configuredClip
        ? `Could not load ${configuredClip} for ${selectedStanceId} / ${LOCOMOTION_LABELS[previewLocomotion]}.`
        : `No clip assigned for ${selectedStanceId} / ${LOCOMOTION_LABELS[previewLocomotion]}.`,
      true,
    );
    return;
  }
  await ctx.ensureAnimatedPose();
  animation.setAnimation(clipName, 0.12);
  animation.setPlaying(true);
  ctx.setStageStatus(
    `Controller preview · ${selectedStanceId} ${previewLocomotion} → ${clipName}`,
  );
  ctx.notifyUiChange();
}

export function assignClipToState(ctx: ControllerClipContext, stateId: string, clipName: string): void {
  const controllerState = ctx.getControllerState();
  if (!controllerState) return;
  const state = controllerState.states.find((entry) => entry.id === stateId);
  if (!state) return;
  state.clipName = clipName;
  if (!clipName) {
    ctx.markControllerDirty();
    return;
  }

  // Prefer the pack URL this clip was loaded from so multi-clip GLBs (UAL, etc.)
  // persist a real project path — never the legacy virtual `ual` id.
  const packUrl = ctx.getAnimation()?.getClipSourceUrl(clipName) ?? null;
  if (packUrl && !packUrl.startsWith('blob:') && !packUrl.startsWith('data:')) {
    state.sourceId = ensureSourceForUrl(ctx, packUrl);
  } else if (packUrl?.startsWith('blob:') || packUrl?.startsWith('data:')) {
    ctx.setStageStatus(
      `Clip "${clipName}" came from a local file picker. Load it from the Project panel (assets/…) so Save Ctrl can store a project URL.`,
      true,
    );
    state.sourceId = ctx.getLastLoadedSourceId();
  } else {
    const lastId = ctx.getLastLoadedSourceId();
    const lastSource = controllerState.sources.find((entry) => entry.id === lastId);
    state.sourceId = lastSource?.id ?? lastId;
  }
  ctx.markControllerDirty();
}
