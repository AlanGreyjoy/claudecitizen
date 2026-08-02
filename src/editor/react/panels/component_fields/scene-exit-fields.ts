import {
  SCENE_EXIT_INSTANCE_TOKENS,
  type PrefabComponent,
  type SceneExitTrigger,
} from '../../../../world/prefabs/schema';
import { fetchProjectSettings, fetchScene } from '../../../api';

export type SceneExitComponent = Extract<PrefabComponent, { type: 'scene-exit' }>;

export type LabeledOption = { value: string; label: string };

/** Shared station cell — the usual hop between public instance scenes. */
export const STATION_PUBLIC_INSTANCE = 'station:public';

export const SCENE_EXIT_NETWORK_OPTIONS: readonly LabeledOption[] = [
  { value: '', label: '(stay in current cell)' },
  { value: STATION_PUBLIC_INSTANCE, label: 'Shared station (station:public)' },
  { value: '@apartment', label: 'Player apartment (@apartment)' },
  { value: '@hangar', label: 'Player hangar (@hangar)' },
  { value: '@space', label: 'Open space (@space)' },
];

/**
 * Defaults for Network Instance / Arrival Room from the chosen target + trigger.
 * `@space` / fly-through → open-space cell; everything else → shared station lobby.
 */
export function sceneExitRoutingDefaults(
  sceneId: string,
  trigger: SceneExitTrigger,
): Pick<SceneExitComponent, 'networkInstanceId' | 'arrivalRoomId'> {
  if (sceneId === '@space' || trigger === 'fly-through') {
    return { networkInstanceId: '@space', arrivalRoomId: 'lobby' };
  }
  return { networkInstanceId: STATION_PUBLIC_INSTANCE, arrivalRoomId: 'lobby' };
}

/** Target Scene change: also pick trigger so hangar mouths don't stay on interact. */
export function patchSceneExitTarget(
  component: SceneExitComponent,
  sceneId: string,
): SceneExitComponent {
  const trigger: SceneExitTrigger =
    sceneId === '@space' ? 'fly-through' : 'interact';
  return {
    ...component,
    sceneId,
    trigger,
    ...sceneExitRoutingDefaults(sceneId, trigger),
  };
}

export function patchSceneExitTrigger(
  component: SceneExitComponent,
  trigger: SceneExitTrigger,
): SceneExitComponent {
  const sceneId =
    trigger === 'fly-through' && !(component.sceneId ?? '').trim()
      ? '@space'
      : (component.sceneId ?? '');
  return {
    ...component,
    sceneId,
    trigger,
    ...sceneExitRoutingDefaults(sceneId, trigger),
  };
}

/** Options list that keeps a custom/unknown authored value visible. */
export function networkInstanceOptions(current: string): LabeledOption[] {
  const value = current.trim();
  if (!value || SCENE_EXIT_NETWORK_OPTIONS.some((option) => option.value === value)) {
    return [...SCENE_EXIT_NETWORK_OPTIONS];
  }
  if ((SCENE_EXIT_INSTANCE_TOKENS as readonly string[]).includes(value)) {
    return [{ value, label: value }, ...SCENE_EXIT_NETWORK_OPTIONS];
  }
  return [{ value, label: `${value} (custom)` }, ...SCENE_EXIT_NETWORK_OPTIONS];
}

/** Game Manager `openSpaceSceneId` — hide that document from scene-exit Target Scene. */
export async function fetchOpenSpaceSceneId(): Promise<string> {
  try {
    const settings = await fetchProjectSettings();
    const bootId = settings.defaultScene?.trim();
    if (!bootId) return '';
    const boot = await fetchScene(bootId);
    for (const entity of boot.gameObjects ?? []) {
      for (const component of entity.components ?? []) {
        if (component.type !== 'game-manager') continue;
        return component.openSpaceSceneId?.trim() ?? '';
      }
    }
  } catch {
    // Editor API unavailable outside Electron — empty means no exclude.
  }
  return '';
}
