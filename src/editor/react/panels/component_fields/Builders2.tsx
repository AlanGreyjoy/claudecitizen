import { useEffect, useState, type ReactElement } from 'react';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import type { StationFloorId } from '../../../../world/station';
import { collectAnimationIds, FLOOR_OPTIONS } from '../../../panels/inspector-logic';
import {
  LADDER_DEFAULT_CLIMB_SPEED,
  LADDER_DEFAULT_LABEL,
  LADDER_DEFAULT_RADIUS,
} from '../../../../world/ladders';
import { fetchSceneList, type SceneListEntry } from '../../../api';
import type { ComponentFieldsProps } from './context';
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

export function ElevatorFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'elevator' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Pair id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="On floor" wide>
        <SelectField
          options={FLOOR_OPTIONS}
          value={component.floorId}
          onCommit={(floorId) =>
            update({ ...component, floorId: floorId as StationFloorId })
          }
        />
      </FieldRow>
      <FieldRow label="To floor" wide>
        <SelectField
          options={FLOOR_OPTIONS}
          value={component.targetFloor}
          onCommit={(targetFloor) =>
            update({ ...component, targetFloor: targetFloor as StationFloorId })
          }
        />
      </FieldRow>
    </>
  );
}

export function SceneExitFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'scene-exit' }>>): ReactElement {
  const { update } = ctx;
  const [scenes, setScenes] = useState<SceneListEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchSceneList()
      .then((list) => {
        if (!cancelled) setScenes(list);
      })
      .catch(() => {
        if (!cancelled) setScenes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sceneId = component.sceneId ?? '';
  const sceneEntries = [...scenes];
  if (sceneId && !sceneEntries.some((entry) => entry.id === sceneId)) {
    sceneEntries.unshift({ id: sceneId, name: sceneId });
  }

  return (
    <>
      <FieldRow label="Target Scene" wide>
        <select
          className="ed-select"
          value={sceneId}
          onChange={(event) =>
            update({ ...component, sceneId: event.currentTarget.value.trim() })
          }
        >
          <option value="">(pick a scene)</option>
          {sceneEntries.map(({ id, name }) => (
            <option key={id} value={id}>
              {name} ({id})
            </option>
          ))}
        </select>
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
        <TextField
          value={component.networkInstanceId ?? 'station:public'}
          onCommit={(networkInstanceId) =>
            update({ ...component, networkInstanceId: networkInstanceId.trim() })
          }
        />
      </FieldRow>
      <FieldRow label="Arrival Room" wide>
        <TextField
          value={component.arrivalRoomId ?? 'lobby'}
          onCommit={(arrivalRoomId) =>
            update({ ...component, arrivalRoomId: arrivalRoomId.trim() || 'lobby' })
          }
        />
      </FieldRow>
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
      <FieldRow label="Radius" wide>
        <NumberField
          value={component.radius}
          onCommit={(radius) => update({ ...component, radius: Math.max(0.5, radius) })}
        />
      </FieldRow>
    </>
  );
}
