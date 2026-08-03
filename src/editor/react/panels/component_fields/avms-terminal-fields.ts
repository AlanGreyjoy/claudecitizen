import type { PrefabComponent } from '../../../../world/prefabs/schema';
import {
  networkInstanceOptions,
  STATION_PUBLIC_INSTANCE,
  type LabeledOption,
} from './scene-exit-fields';

export type AvmsTerminalComponent = Extract<PrefabComponent, { type: 'avms-terminal' }>;

/** Default cell for AVMS → Hangar travel (per-player hangar instance). */
export const AVMS_DEFAULT_HANGAR_INSTANCE = '@hangar';

/** Default arrival floor inside the hangar scene. */
export const AVMS_DEFAULT_HANGAR_ROOM = 'hangar';

/**
 * Hangar Instance options — same cell tokens as scene-exit, with `@hangar`
 * first so the default reads as the intended To Hangar hop.
 */
export const AVMS_HANGAR_INSTANCE_OPTIONS: readonly LabeledOption[] = [
  { value: AVMS_DEFAULT_HANGAR_INSTANCE, label: 'Player hangar (@hangar)' },
  { value: STATION_PUBLIC_INSTANCE, label: 'Shared station (station:public)' },
  { value: '@apartment', label: 'Player apartment (@apartment)' },
  { value: '@space', label: 'Open space (@space)' },
];

/** Keep a custom/unknown authored cell id visible in the select. */
export function hangarInstanceOptions(current: string): LabeledOption[] {
  const value = current.trim() || AVMS_DEFAULT_HANGAR_INSTANCE;
  if (AVMS_HANGAR_INSTANCE_OPTIONS.some((option) => option.value === value)) {
    return [...AVMS_HANGAR_INSTANCE_OPTIONS];
  }
  // Fall back to the full scene-exit list so odd tokens still resolve cleanly.
  const fromExit = networkInstanceOptions(value).filter((option) => option.value !== '');
  if (fromExit.some((option) => option.value === value)) return fromExit;
  return [{ value, label: `${value} (custom)` }, ...AVMS_HANGAR_INSTANCE_OPTIONS];
}

/**
 * Hangar Scene change: show the hangar button and fill Instance / Room the
 * same way scene-exit fills Network Instance / Arrival Room.
 */
export function patchAvmsHangarScene(
  component: AvmsTerminalComponent,
  hangarSceneId: string,
): AvmsTerminalComponent {
  const id = hangarSceneId.trim();
  if (!id) {
    const next: AvmsTerminalComponent = { ...component };
    delete next.hangarSceneId;
    return next;
  }
  return {
    ...component,
    hangarSceneId: id,
    hangarInstanceId: AVMS_DEFAULT_HANGAR_INSTANCE,
    hangarRoomId: AVMS_DEFAULT_HANGAR_ROOM,
    hangarLabel: component.hangarLabel?.trim() || 'To Hangar',
  };
}
