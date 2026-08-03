import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { PrefabComponent, SceneExitTrigger } from '../../../../world/prefabs/schema';
import { SCENE_EXIT_TRIGGERS } from '../../../../world/prefabs/schema';
import type { StationFloorId } from '../../../../world/station';
import { collectAnimationIds, FLOOR_OPTIONS } from '../../../panels/inspector-logic';
import {
  LADDER_DEFAULT_CLIMB_SPEED,
  LADDER_DEFAULT_LABEL,
  LADDER_DEFAULT_RADIUS,
} from '../../../../world/ladders';
import type { ComponentFieldsProps } from './context';
import { SceneRefField } from './SceneRefField';
import {
  fetchOpenSpaceSceneId,
  networkInstanceOptions,
  patchSceneExitTarget,
  patchSceneExitTrigger,
  STATION_PUBLIC_INSTANCE,
  type SceneExitComponent,
} from './scene-exit-fields';
import {
  AVMS_DEFAULT_HANGAR_INSTANCE,
  AVMS_DEFAULT_HANGAR_ROOM,
  hangarInstanceOptions,
  patchAvmsHangarScene,
} from './avms-terminal-fields';
import {
  AssetUrlField,
  CheckboxRow,
  DoorNodeRow,
  EdButton,
  FieldRow,
  Hint,
  NumberField,
  RemoveButton,
  SelectField,
  TextField,
} from '../InspectorForm';

/** Press F on foot, or cross it in a ship (a hangar mouth is not a door). */
const SCENE_EXIT_TRIGGER_OPTIONS = [...SCENE_EXIT_TRIGGERS];

/**
 * `@space` is a Game Manager hop, not a document: a hangar prefab can be reused
 * across projects only if it names the token instead of somebody's scene id.
 */
const SPACE_EXIT_OPTION = [{ id: '@space', name: 'Open Space (Game Manager)' }];

function useOpenSpaceSceneId(): string {
  const [openSpaceSceneId, setOpenSpaceSceneId] = useState('');
  useEffect(() => {
    let cancelled = false;
    void fetchOpenSpaceSceneId().then((id) => {
      if (!cancelled) setOpenSpaceSceneId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return openSpaceSceneId;
}

/** Rewrite a literal open-space scene id to the `@space` token once it is known. */
function useMigrateOpenSpaceTarget(
  component: SceneExitComponent,
  update: (next: PrefabComponent) => void,
  openSpaceSceneId: string,
): void {
  const componentRef = useRef(component);
  componentRef.current = component;
  useEffect(() => {
    const current = componentRef.current;
    if (!openSpaceSceneId || current.sceneId !== openSpaceSceneId) return;
    update(patchSceneExitTarget(current, '@space'));
  }, [openSpaceSceneId, component.sceneId, update]);
}

export function SceneExitFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'scene-exit' }>>): ReactElement {
  const { update } = ctx;
  const openSpaceSceneId = useOpenSpaceSceneId();
  useMigrateOpenSpaceTarget(component, update, openSpaceSceneId);
  const networkValue = component.networkInstanceId ?? STATION_PUBLIC_INSTANCE;
  const arrivalValue = component.arrivalRoomId ?? 'lobby';
  const arrivalOptions = (FLOOR_OPTIONS as readonly string[]).includes(arrivalValue)
    ? FLOOR_OPTIONS
    : [arrivalValue, ...FLOOR_OPTIONS];

  return (
    <>
      <FieldRow label="Target Scene" wide>
        <SceneRefField
          value={component.sceneId ?? ''}
          emptyLabel="(pick a scene)"
          extraOptions={SPACE_EXIT_OPTION}
          excludeSceneIds={openSpaceSceneId ? [openSpaceSceneId] : []}
          onCommit={(sceneId) => update(patchSceneExitTarget(component, sceneId))}
        />
      </FieldRow>
      <FieldRow label="Trigger" wide>
        <SelectField
          options={SCENE_EXIT_TRIGGER_OPTIONS}
          value={component.trigger ?? 'interact'}
          onCommit={(trigger) =>
            update(patchSceneExitTrigger(component, trigger as SceneExitTrigger))
          }
        />
      </FieldRow>
      <FieldRow label="Prompt" wide>
        <TextField
          value={component.prompt ?? 'Press F — exit to station'}
          onCommit={(prompt) => update({ ...component, prompt })}
        />
      </FieldRow>
      <FieldRow label="Radius" wide>
        <NumberField
          value={component.radius ?? 2.5}
          onCommit={(radius) => update({ ...component, radius })}
        />
      </FieldRow>
      <FieldRow label="Network Instance" wide>
        <SelectField
          options={networkInstanceOptions(networkValue)}
          value={networkValue}
          onCommit={(networkInstanceId) =>
            update({ ...component, networkInstanceId })
          }
        />
      </FieldRow>
      <FieldRow label="Arrival Room" wide>
        <SelectField
          options={arrivalOptions}
          value={arrivalValue}
          onCommit={(arrivalRoomId) =>
            update({
              ...component,
              arrivalRoomId: (arrivalRoomId as StationFloorId) || 'lobby',
            })
          }
        />
      </FieldRow>
      <Hint>
        Target Scene `@space` uses the Game Manager Open Space hop. Open-space
        fly-throughs resolve the System Map station that owns this hangar
        (`hangarSceneId`) and spawn at that station&apos;s Hangar Open Space
        Exit. Changing Target or Trigger auto-fills Network Instance and Arrival
        Room.
      </Hint>
    </>
  );
}

export function LadderFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'ladder' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Height (m)" wide>
        <NumberField
          value={component.height}
          step={0.1}
          onCommit={(height) =>
            update({ ...component, height: Math.max(0.5, height) })
          }
        />
      </FieldRow>
      <FieldRow label="Reach (m)" wide>
        <NumberField
          value={component.radius ?? LADDER_DEFAULT_RADIUS}
          step={0.1}
          onCommit={(radius) => update({ ...component, radius: Math.max(0.3, radius) })}
        />
      </FieldRow>
      <FieldRow label="Climb m/s" wide>
        <NumberField
          value={component.climbSpeed ?? LADDER_DEFAULT_CLIMB_SPEED}
          step={0.1}
          onCommit={(climbSpeed) =>
            update({ ...component, climbSpeed: Math.max(0.2, climbSpeed) })
          }
        />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? LADDER_DEFAULT_LABEL}
          onCommit={(label) => update({ ...component, label })}
        />
      </FieldRow>
      <Hint>
        Place at the foot of the ladder, where the player stands to mount. +Z
        (blue axis) is the side they face away from while climbing and step off
        toward at the top.
      </Hint>
    </>
  );
}

export function HangarPadFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'hangar-pad' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Hangar" wide>
        <TextField
          value={component.hangarId}
          onCommit={(hangarId) => update({ ...component, hangarId })}
        />
      </FieldRow>
      <FieldRow label="Pad #" wide>
        <NumberField
          value={component.padIndex}
          step={1}
          onCommit={(padIndex) =>
            update({ ...component, padIndex: Math.max(1, Math.round(padIndex)) })
          }
        />
      </FieldRow>
      <FieldRow label="Floor" wide>
        <SelectField
          options={FLOOR_OPTIONS}
          value={component.floorId ?? 'hangar'}
          onCommit={(floorId) =>
            update({ ...component, floorId: floorId as StationFloorId })
          }
        />
      </FieldRow>
    </>
  );
}

export function InteractionFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'interaction' }>>): ReactElement {
  const { update, store } = ctx;
  const animIds = collectAnimationIds(store.getState().roots);
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Floor" wide>
        <SelectField
          options={FLOOR_OPTIONS}
          value={component.floorId}
          onCommit={(floorId) =>
            update({ ...component, floorId: floorId as StationFloorId })
          }
        />
      </FieldRow>
      <FieldRow label="Type" wide>
        <SelectField
          options={['info', 'animation']}
          value={component.interactionType ?? 'info'}
          onCommit={(val) =>
            update({ ...component, interactionType: val as 'info' | 'animation' })
          }
        />
      </FieldRow>
      {component.interactionType === 'animation' ? (
        <FieldRow label="Target Anim" wide>
          <SelectField
            options={['', ...animIds]}
            value={component.targetAnimationId ?? ''}
            onCommit={(val) =>
              update({ ...component, targetAnimationId: val || undefined })
            }
          />
        </FieldRow>
      ) : null}
      <FieldRow label="Prompt" wide>
        <TextField
          value={component.prompt}
          onCommit={(prompt) => update({ ...component, prompt })}
        />
      </FieldRow>
      <FieldRow label="Key Bind" wide>
        <TextField
          value={component.keyLabel ?? 'F'}
          onCommit={(keyLabel) =>
            update({ ...component, keyLabel: keyLabel.slice(0, 10) })
          }
        />
      </FieldRow>
      <FieldRow label="Radius" wide>
        <NumberField
          value={component.radius}
          onCommit={(radius) => update({ ...component, radius: Math.max(0.5, radius) })}
        />
      </FieldRow>
      <AssetUrlField
        label="Proximity SFX"
        value={component.proximitySoundUrl}
        onCommit={(proximitySoundUrl) => update({ ...component, proximitySoundUrl })}
      />
      <AssetUrlField
        label="Interact SFX"
        value={component.interactSoundUrl}
        onCommit={(interactSoundUrl) => update({ ...component, interactSoundUrl })}
      />
    </>
  );
}

export function AnimationFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'animation' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Name" wide>
        <TextField value={component.name} onCommit={(name) => update({ ...component, name })} />
      </FieldRow>
      <FieldRow label="Motion" wide>
        <SelectField
          options={['slide', 'hinge']}
          value={component.motion}
          onCommit={(motion) =>
            update({ ...component, motion: motion as 'slide' | 'hinge' })
          }
        />
      </FieldRow>
      <FieldRow label="Axis" wide>
        <SelectField
          options={['x', 'y', 'z']}
          value={component.axis}
          onCommit={(axis) => update({ ...component, axis: axis as 'x' | 'y' | 'z' })}
        />
      </FieldRow>
      <FieldRow label="Duration" wide>
        <NumberField
          value={component.duration ?? 1.0}
          onCommit={(duration) =>
            update({ ...component, duration: Math.max(0.01, duration) })
          }
        />
      </FieldRow>
      <CheckboxRow
        label="Open on spawn"
        checked={component.defaultOpen ?? false}
        onChange={(checked) =>
          update({ ...component, defaultOpen: checked || undefined })
        }
      />
      {component.nodes.map((node, nodeIndex) => (
        <FieldRow key={nodeIndex} label={`Node ${nodeIndex + 1}`} wide>
          <DoorNodeRow>
            <TextField
              value={node.name}
              onCommit={(name) => {
                const nodes = component.nodes.map((entry, index) =>
                  index === nodeIndex ? { ...entry, name } : entry,
                );
                update({ ...component, nodes });
              }}
            />
            <NumberField
              value={node.delta}
              onCommit={(delta) => {
                const nodes = component.nodes.map((entry, index) =>
                  index === nodeIndex ? { ...entry, delta } : entry,
                );
                update({ ...component, nodes });
              }}
            />
            <RemoveButton
              title="Remove node"
              onClick={() => {
                if (component.nodes.length <= 1) return;
                const nodes = component.nodes.filter((_, index) => index !== nodeIndex);
                update({ ...component, nodes });
              }}
            />
          </DoorNodeRow>
        </FieldRow>
      ))}
      <EdButton
        title="Add another GLB node moved by this animation"
        onClick={() =>
          update({
            ...component,
            nodes: [...component.nodes, { name: '', delta: 0 }],
          })
        }
      >
        + Node
      </EdButton>
    </>
  );
}

export function ObjectAnimationFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'object-animation' }>>): ReactElement {
  const { update } = ctx;
  const nodes = component.nodes ?? [];
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Mode" wide>
        <SelectField
          options={['hover', 'spin']}
          value={component.mode}
          onCommit={(mode) =>
            update({
              ...component,
              mode: mode as 'hover' | 'spin',
              speed:
                mode === 'spin'
                  ? (component.speed ?? 0.4)
                  : (component.speed ?? 0.5),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Axis" wide>
        <SelectField
          options={['x', 'y', 'z']}
          value={component.axis}
          onCommit={(axis) => update({ ...component, axis: axis as 'x' | 'y' | 'z' })}
        />
      </FieldRow>
      <FieldRow
        label={component.mode === 'spin' ? 'Speed (rad/s)' : 'Speed (Hz)'}
        wide
      >
        <NumberField
          value={component.speed ?? (component.mode === 'spin' ? 0.4 : 0.5)}
          onCommit={(speed) => update({ ...component, speed: Math.max(0, speed) })}
        />
      </FieldRow>
      {component.mode === 'spin' ? (
        <CheckboxRow
          label="Reverse spin"
          checked={component.reverse ?? false}
          onChange={(checked) =>
            update({ ...component, reverse: checked || undefined })
          }
        />
      ) : null}
      {component.mode === 'hover' ? (
        <FieldRow label="Amplitude (m)" wide>
          <NumberField
            value={component.amplitude ?? 0.08}
            onCommit={(amplitude) =>
              update({ ...component, amplitude: Math.max(0, amplitude) })
            }
          />
        </FieldRow>
      ) : null}
      <FieldRow label="Phase (rad)" wide>
        <NumberField
          value={component.phase ?? 0}
          onCommit={(phase) => update({ ...component, phase })}
        />
      </FieldRow>
      {nodes.length === 0 ? (
        <Hint>No GLB nodes — animates this entity root.</Hint>
      ) : null}
      {nodes.map((node, nodeIndex) => (
        <FieldRow key={nodeIndex} label={`Node ${nodeIndex + 1}`} wide>
          <DoorNodeRow>
            <TextField
              value={node.name}
              onCommit={(name) => {
                const nextNodes = nodes.map((entry, index) =>
                  index === nodeIndex ? { ...entry, name } : entry,
                );
                update({ ...component, nodes: nextNodes });
              }}
            />
            <RemoveButton
              title="Remove node"
              onClick={() => {
                const nextNodes = nodes.filter((_, index) => index !== nodeIndex);
                update({ ...component, nodes: nextNodes });
              }}
            />
          </DoorNodeRow>
        </FieldRow>
      ))}
      <EdButton
        title="Animate a named GLB node (leave empty to animate entity root)"
        onClick={() =>
          update({
            ...component,
            nodes: [...nodes, { name: '' }],
          })
        }
      >
        + Node
      </EdButton>
    </>
  );
}

export function AvmsTerminalFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'avms-terminal' }>>): ReactElement {
  const { update } = ctx;
  const hangarInstanceValue =
    component.hangarInstanceId ?? AVMS_DEFAULT_HANGAR_INSTANCE;
  const hangarRoomValue = component.hangarRoomId ?? AVMS_DEFAULT_HANGAR_ROOM;
  const hangarRoomOptions = (FLOOR_OPTIONS as readonly string[]).includes(hangarRoomValue)
    ? FLOOR_OPTIONS
    : [hangarRoomValue, ...FLOOR_OPTIONS];
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? 'AVMS terminal'}
          onCommit={(label) =>
            update({
              ...component,
              label: label.trim() ? label.trim() : undefined,
            })
          }
        />
      </FieldRow>
      <FieldRow label="Gaze radius" wide>
        <NumberField
          value={component.gazeRadius ?? 0.4}
          step={0.05}
          onCommit={(gazeRadius) =>
            update({
              ...component,
              gazeRadius: Math.max(0.05, Math.min(2, gazeRadius)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Max distance" wide>
        <NumberField
          value={component.maxDistance ?? 3}
          step={0.1}
          onCommit={(maxDistance) =>
            update({
              ...component,
              maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Screen width" wide>
        <NumberField
          value={component.screenWidth ?? 0.45}
          step={0.05}
          onCommit={(screenWidth) =>
            update({
              ...component,
              screenWidth: Math.max(0.2, Math.min(2, screenWidth)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Screen height" wide>
        <NumberField
          value={component.screenHeight ?? 0.28}
          step={0.05}
          onCommit={(screenHeight) =>
            update({
              ...component,
              screenHeight: Math.max(0.15, Math.min(1.5, screenHeight)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Hangar Scene" wide>
        <SceneRefField
          value={component.hangarSceneId ?? ''}
          emptyLabel="(no hangar button)"
          onCommit={(hangarSceneId) =>
            update(patchAvmsHangarScene(component, hangarSceneId))
          }
        />
      </FieldRow>
      <FieldRow label="Hangar Button" wide>
        <TextField
          value={component.hangarLabel ?? 'To Hangar'}
          onCommit={(hangarLabel) =>
            update({
              ...component,
              hangarLabel: hangarLabel.trim() ? hangarLabel.trim() : undefined,
            })
          }
        />
      </FieldRow>
      <FieldRow label="Hangar Instance" wide>
        <SelectField
          options={hangarInstanceOptions(hangarInstanceValue)}
          value={hangarInstanceValue}
          onCommit={(hangarInstanceId) =>
            update({
              ...component,
              hangarInstanceId: hangarInstanceId.trim() || undefined,
            })
          }
        />
      </FieldRow>
      <FieldRow label="Hangar Room" wide>
        <SelectField
          options={hangarRoomOptions}
          value={hangarRoomValue}
          onCommit={(hangarRoomId) =>
            update({
              ...component,
              hangarRoomId: (hangarRoomId as StationFloorId) || undefined,
            })
          }
        />
      </FieldRow>
      <Hint>
        Place Empty on display face. Local +Z faces player. Walk up, look, press F.
        Pick a Hangar Scene to show the hangar button — Instance and Room fill
        like scene-exit Network Instance / Arrival Room (`@hangar` + hangar).
      </Hint>
    </>
  );
}
