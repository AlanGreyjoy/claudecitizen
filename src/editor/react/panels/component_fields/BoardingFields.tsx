import type { ReactElement } from 'react';
import {
  SCENE_EXIT_TRIGGERS,
  type PrefabComponent,
  type SceneExitTrigger,
} from '../../../../world/prefabs/schema';
import type { StationFloorId } from '../../../../world/station';
import { FLOOR_OPTIONS } from '../../../panels/inspector-logic';
import type { ComponentFieldsProps } from './context';
import { SceneRefField } from './SceneRefField';
import {
  FieldRow,
  Hint,
  NumberField,
  SelectField,
  TextField,
} from '../InspectorForm';

/** Cross it in a ship, or walk up and press F. */
const EXIT_HANGAR_TRIGGER_OPTIONS = [...SCENE_EXIT_TRIGGERS];

const EXIT_HANGAR_DEFAULT_PROMPT = 'Press F — launch to open space';
const EXIT_HANGAR_DEFAULT_RADIUS = 8;
const ENTER_STATION_DEFAULT_RADIUS = 60;

/**
 * `exit-hangar` — the one hangar → Open Space primitive.
 *
 * There is deliberately no destination picker: which Open Space document the
 * ship lands in is the Game Manager's call, and where in it comes from the
 * owning Station body's `hangar-open-space-exit` mouth via System Map
 * ownership. Authoring either here would be a second source of truth.
 */
export function ExitHangarFields({
  ctx,
  component,
}: ComponentFieldsProps<
  Extract<PrefabComponent, { type: 'exit-hangar' }>
>): ReactElement {
  const { update } = ctx;
  const trigger = component.trigger ?? 'fly-through';
  return (
    <>
      <FieldRow label="Trigger" wide>
        <SelectField
          options={EXIT_HANGAR_TRIGGER_OPTIONS}
          value={trigger}
          onCommit={(next) =>
            update({ ...component, trigger: next as SceneExitTrigger })
          }
        />
      </FieldRow>
      {trigger === 'interact' ? (
        <FieldRow label="Prompt" wide>
          <TextField
            value={component.prompt ?? EXIT_HANGAR_DEFAULT_PROMPT}
            onCommit={(prompt) => update({ ...component, prompt })}
          />
        </FieldRow>
      ) : null}
      <FieldRow label="Radius" wide>
        <NumberField
          value={component.radius ?? EXIT_HANGAR_DEFAULT_RADIUS}
          onCommit={(radius) => update({ ...component, radius })}
        />
      </FieldRow>
      <Hint>
        Destination is the owning Station body&apos;s Hangar Open Space Exit
        mouth, found through System Map ownership (the entry whose Hangar Scene
        is this document). Interact still launches you flying — there is nowhere
        to stand out there.
      </Hint>
    </>
  );
}

/**
 * `enter-station` — Open Space → this family's hangar.
 *
 * The destination normally comes from the System Map entry that placed this
 * station body, so the override exists only for bodies that are not on the map
 * yet or that deliberately route elsewhere.
 */
export function EnterStationFields({
  ctx,
  component,
}: ComponentFieldsProps<
  Extract<PrefabComponent, { type: 'enter-station' }>
>): ReactElement {
  const { update } = ctx;
  const arrivalValue = component.arrivalRoomId ?? 'hangar';
  const arrivalOptions = (FLOOR_OPTIONS as readonly string[]).includes(arrivalValue)
    ? FLOOR_OPTIONS
    : [arrivalValue, ...FLOOR_OPTIONS];
  return (
    <>
      <FieldRow label="Radius" wide>
        <NumberField
          value={component.radius ?? ENTER_STATION_DEFAULT_RADIUS}
          onCommit={(radius) => update({ ...component, radius })}
        />
      </FieldRow>
      <FieldRow label="Hangar Scene" wide>
        <SceneRefField
          value={component.hangarSceneId ?? ''}
          emptyLabel="(System Map Hangar Scene)"
          onCommit={(hangarSceneId) => update({ ...component, hangarSceneId })}
        />
      </FieldRow>
      <FieldRow label="Arrival Room" wide>
        <SelectField
          options={arrivalOptions}
          value={arrivalValue}
          onCommit={(arrivalRoomId) =>
            update({
              ...component,
              arrivalRoomId: (arrivalRoomId as StationFloorId) || 'hangar',
            })
          }
        />
      </FieldRow>
      <Hint>
        Place at the bay mouth on a Runtime: station body. A ship crossing this
        volume lands in the hangar instance — never the concourse, and never as
        a world swap that drops the Open Space host.
      </Hint>
    </>
  );
}
