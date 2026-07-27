import type { ReactElement } from 'react';
import {
  COCKPIT_CONTROL_ACTIONS,
  SHIP_SEAT_ROLES,
  type PrefabComponent,
} from '../../../../world/prefabs/schema';
import type { ComponentFieldsProps } from './context';
import {
  AssetUrlField,
  CheckboxRow,
  DoorNodeRow,
  EdButton,
  EntityRefField,
  FieldRow,
  NumberField,
  RemoveButton,
  SelectField,
  TextField,
} from '../InspectorForm';

export function ShipDoorFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'ship-door' }>>): ReactElement {
  const { update, options } = ctx;
  const trigger = component.trigger ?? 'radial';
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label}
          onCommit={(label) => update({ ...component, label })}
        />
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
      <FieldRow label="Trigger" wide>
        <SelectField
          options={['radial', 'raycast']}
          value={trigger}
          onCommit={(next) =>
            update({ ...component, trigger: next as 'radial' | 'raycast' })
          }
        />
      </FieldRow>
      <FieldRow label={trigger === 'raycast' ? 'Max distance' : 'Radius'} wide>
        <NumberField
          value={component.radius ?? 1.6}
          onCommit={(radius) => update({ ...component, radius: Math.max(0.5, radius) })}
        />
      </FieldRow>
      {trigger === 'raycast' ? (
        <FieldRow label="Aim radius" wide>
          <NumberField
            value={component.aimRadius ?? 0.35}
            onCommit={(aimRadius) =>
              update({ ...component, aimRadius: Math.max(0.05, aimRadius) })
            }
          />
        </FieldRow>
      ) : null}
      <div className="ed-field-row-wide ed-door-spawn-row">
        <CheckboxRow
          label="Open on spawn"
          checked={component.defaultOpen ?? false}
          onChange={(checked) =>
            update({ ...component, defaultOpen: checked || undefined })
          }
        />
        <EdButton
          title="Preview this door open / closed in the viewport"
          onClick={() => options.onToggleShipDoorPreview?.(component.id)}
        >
          Animate
        </EdButton>
      </div>
      {component.nodes.map((node, nodeIndex) => (
        <div key={nodeIndex}>
          <FieldRow label={`Node ${nodeIndex + 1}`} wide>
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
          <FieldRow label="Under" wide>
            <TextField
              value={node.under ?? ''}
              onCommit={(under) => {
                const nodes = component.nodes.map((entry, index) =>
                  index === nodeIndex
                    ? { ...entry, under: under.trim() ? under.trim() : undefined }
                    : entry,
                );
                update({ ...component, nodes });
              }}
            />
          </FieldRow>
        </div>
      ))}
      <EdButton
        title="Add another GLB node moved by this door"
        onClick={() =>
          update({
            ...component,
            nodes: [...component.nodes, { name: 'Door_R', delta: 1 }],
          })
        }
      >
        + Node
      </EdButton>
      <AssetUrlField
        label="Open SFX"
        value={component.openSoundUrl}
        onCommit={(openSoundUrl) => update({ ...component, openSoundUrl })}
      />
      <AssetUrlField
        label="Close SFX"
        value={component.closeSoundUrl}
        onCommit={(closeSoundUrl) => update({ ...component, closeSoundUrl })}
      />
    </>
  );
}

export function PilotSeatFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'pilot-seat' }>>): ReactElement {
  const { update } = ctx;
  const eye = component.eye ?? { x: 0, y: 0.87, z: 0.25 };
  const stand = component.stand ?? { x: 0, z: -1.55 };
  const role = component.role ?? 'passenger';
  return (
    <>
      <FieldRow label="Role" wide>
        <SelectField
          options={[...SHIP_SEAT_ROLES]}
          value={role}
          onCommit={(next) =>
            update({
              ...component,
              role: next as (typeof SHIP_SEAT_ROLES)[number],
            })
          }
        />
      </FieldRow>
      <FieldRow label="Eye">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <NumberField
            key={axis}
            value={eye[axis]}
            onCommit={(next) => update({ ...component, eye: { ...eye, [axis]: next } })}
          />
        ))}
      </FieldRow>
      <FieldRow label="Stand XZ">
        <NumberField
          value={stand.x}
          onCommit={(x) => update({ ...component, stand: { ...stand, x } })}
        />
        <NumberField
          value={stand.z}
          onCommit={(z) => update({ ...component, stand: { ...stand, z } })}
        />
        <span />
      </FieldRow>
      <FieldRow label="Radius" wide>
        <NumberField
          value={component.interactRadius ?? 1.45}
          onCommit={(radius) =>
            update({ ...component, interactRadius: Math.max(0.5, radius) })
          }
        />
      </FieldRow>
    </>
  );
}

export function BedFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'bed' }>>): ReactElement {
  const { update } = ctx;
  const eye = component.eye ?? { x: 0, y: 0.3, z: 0.15 };
  const stand = component.stand ?? { x: -0.9, z: 0 };
  const trigger = component.trigger ?? 'radial';
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? 'bed'}
          onCommit={(label) => update({ ...component, label })}
        />
      </FieldRow>
      <FieldRow label="Trigger" wide>
        <SelectField
          options={['radial', 'raycast']}
          value={trigger}
          onCommit={(next) =>
            update({ ...component, trigger: next as 'radial' | 'raycast' })
          }
        />
      </FieldRow>
      <FieldRow label={trigger === 'raycast' ? 'Max distance' : 'Radius'} wide>
        <NumberField
          value={component.radius ?? 1.6}
          onCommit={(radius) => update({ ...component, radius: Math.max(0.5, radius) })}
        />
      </FieldRow>
      {trigger === 'raycast' ? (
        <FieldRow label="Aim radius" wide>
          <NumberField
            value={component.aimRadius ?? 0.35}
            onCommit={(aimRadius) =>
              update({ ...component, aimRadius: Math.max(0.05, aimRadius) })
            }
          />
        </FieldRow>
      ) : null}
      <FieldRow label="Eye">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <NumberField
            key={axis}
            value={eye[axis]}
            onCommit={(next) => update({ ...component, eye: { ...eye, [axis]: next } })}
          />
        ))}
      </FieldRow>
      <FieldRow label="Stand XZ">
        <NumberField
          value={stand.x}
          onCommit={(x) => update({ ...component, stand: { ...stand, x } })}
        />
        <NumberField
          value={stand.z}
          onCommit={(z) => update({ ...component, stand: { ...stand, z } })}
        />
        <span />
      </FieldRow>
    </>
  );
}

export function RampInteractFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'ramp-interact' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Place" wide>
        <SelectField
          options={['outside', 'deck']}
          value={component.placement}
          onCommit={(placement) =>
            update({
              ...component,
              placement: placement as 'outside' | 'deck',
            })
          }
        />
      </FieldRow>
      <FieldRow label="Radius" wide>
        <NumberField
          value={component.radius ?? (component.placement === 'outside' ? 3 : 1.7)}
          onCommit={(radius) =>
            update({ ...component, radius: Math.max(0.5, radius) })
          }
        />
      </FieldRow>
    </>
  );
}

export function ShipEntryFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'ship-entry' }>>): ReactElement {
  const { update, store } = ctx;
  return (
    <>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? 'ship'}
          onCommit={(label) => update({ ...component, label })}
        />
      </FieldRow>
      <FieldRow label="Radius" wide>
        <NumberField
          value={component.radius ?? 3}
          onCommit={(radius) => update({ ...component, radius: Math.max(0.5, radius) })}
        />
      </FieldRow>
      <FieldRow label="Seat" wide>
        <EntityRefField
          store={store}
          value={component.seatEntityId}
          onPick={(seatEntityId) => update({ ...component, seatEntityId })}
        />
      </FieldRow>
    </>
  );
}

export function CockpitControlFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'cockpit-control' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Action" wide>
        <SelectField
          options={[...COCKPIT_CONTROL_ACTIONS]}
          value={component.action}
          onCommit={(action) =>
            update({
              ...component,
              action: action as (typeof COCKPIT_CONTROL_ACTIONS)[number],
            })
          }
        />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? ''}
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
          value={component.gazeRadius ?? 0.2}
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
          value={component.maxDistance ?? 2.5}
          step={0.1}
          onCommit={(maxDistance) =>
            update({
              ...component,
              maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
            })
          }
        />
      </FieldRow>
    </>
  );
}

export function EntertainmentSystemFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'entertainment-system' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField value={component.id} onCommit={(id) => update({ ...component, id })} />
      </FieldRow>
      <FieldRow label="Label" wide>
        <TextField
          value={component.label ?? 'Turn on ES'}
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
          value={component.gazeRadius ?? 0.35}
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
          value={component.maxDistance ?? 2}
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
          value={component.screenWidth ?? 0.55}
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
          value={component.screenHeight ?? 0.32}
          step={0.05}
          onCommit={(screenHeight) =>
            update({
              ...component,
              screenHeight: Math.max(0.15, Math.min(1.5, screenHeight)),
            })
          }
        />
      </FieldRow>
    </>
  );
}
