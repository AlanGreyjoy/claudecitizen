import { useState, type ReactElement } from 'react';
import { fitBoxColliderToBounds } from '../../../component-actions';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import { ColliderExcludeNodes } from './ColliderExcludeNodes';
import type { ComponentFieldsProps } from './context';
import {
  AssetUrlField,
  CheckboxRow,
  EdButton,
  FieldRow,
  NumberField,
  SelectField,
  TextField,
  Vec3NumberRow,
  ColorField,
} from '../InspectorForm';

export function PointLightFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'point-light' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Color" wide>
        <ColorField
          value={component.color ?? '#dfeaff'}
          onCommit={(color) => update({ ...component, color })}
        />
      </FieldRow>
      <FieldRow label="Intensity" wide>
        <NumberField
          value={component.intensity}
          onCommit={(intensity) =>
            update({
              ...component,
              intensity: Math.min(5_000, Math.max(0, intensity)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Range" wide>
        <NumberField
          value={component.distance}
          onCommit={(distance) =>
            update({
              ...component,
              distance: Math.min(500, Math.max(0, distance)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Decay" wide>
        <NumberField
          value={component.decay ?? 2}
          onCommit={(decay) =>
            update({
              ...component,
              decay: Math.min(4, Math.max(0, decay)),
            })
          }
        />
      </FieldRow>
      <CheckboxRow
        label="Cast shadows"
        checked={component.castShadow ?? false}
        onChange={(checked) =>
          update({ ...component, castShadow: checked || undefined })
        }
      />
    </>
  );
}

export function AreaLightFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'area-light' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Color" wide>
        <ColorField
          value={component.color ?? '#cfe8ff'}
          onCommit={(color) => update({ ...component, color })}
        />
      </FieldRow>
      <FieldRow label="Intensity" wide>
        <NumberField
          value={component.intensity}
          onCommit={(intensity) =>
            update({
              ...component,
              intensity: Math.min(500, Math.max(0, intensity)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Size">
        <NumberField
          value={component.width}
          onCommit={(width) =>
            update({
              ...component,
              width: Math.min(100, Math.max(0.05, width)),
            })
          }
        />
        <NumberField
          value={component.height}
          onCommit={(height) =>
            update({
              ...component,
              height: Math.min(100, Math.max(0.05, height)),
            })
          }
        />
        <span />
      </FieldRow>
    </>
  );
}

export function SpotLightFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'spot-light' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Color" wide>
        <ColorField
          value={component.color ?? '#dfeaff'}
          onCommit={(color) => update({ ...component, color })}
        />
      </FieldRow>
      <FieldRow label="Intensity" wide>
        <NumberField
          value={component.intensity}
          onCommit={(intensity) =>
            update({
              ...component,
              intensity: Math.min(5_000, Math.max(0, intensity)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Range" wide>
        <NumberField
          value={component.distance}
          onCommit={(distance) =>
            update({
              ...component,
              distance: Math.min(500, Math.max(0, distance)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Decay" wide>
        <NumberField
          value={component.decay ?? 2}
          onCommit={(decay) =>
            update({
              ...component,
              decay: Math.min(4, Math.max(0, decay)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Angle" wide>
        <NumberField
          value={component.angle ?? 45}
          onCommit={(angle) =>
            update({
              ...component,
              angle: Math.min(90, Math.max(0, angle)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Penumbra" wide>
        <NumberField
          value={component.penumbra ?? 0}
          onCommit={(penumbra) =>
            update({
              ...component,
              penumbra: Math.min(1, Math.max(0, penumbra)),
            })
          }
        />
      </FieldRow>
      <CheckboxRow
        label="Cast shadows"
        checked={component.castShadow ?? false}
        onChange={(checked) =>
          update({ ...component, castShadow: checked || undefined })
        }
      />
    </>
  );
}

export function SoundFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'sound' }>>): ReactElement {
  const { update, options } = ctx;
  const maxBlend =
    component.zone.shape === 'sphere'
      ? component.zone.radius
      : Math.min(
          component.zone.size.x,
          component.zone.size.y,
          component.zone.size.z,
        ) / 2;
  const previewKey = `sound:${component.soundUrl ?? 'unassigned'}:${component.mode}:${component.playback}`;
  const [playing, setPlaying] = useState(() => options.audioPreview.isPlaying(previewKey));

  return (
    <>
      <AssetUrlField
        label="Sound"
        value={component.soundUrl}
        onCommit={(soundUrl) => update({ ...component, soundUrl })}
      />
      <FieldRow label="Mode" wide>
        <SelectField
          options={['ambient', 'spatial']}
          value={component.mode}
          onCommit={(mode) =>
            update({ ...component, mode: mode as 'ambient' | 'spatial' })
          }
        />
      </FieldRow>
      <FieldRow label="Playback" wide>
        <SelectField
          options={['loop', 'enter']}
          value={component.playback}
          onCommit={(playback) =>
            update({ ...component, playback: playback as 'loop' | 'enter' })
          }
        />
      </FieldRow>
      <FieldRow label="Volume" wide>
        <NumberField
          value={component.volume}
          onCommit={(volume) =>
            update({
              ...component,
              volume: Math.min(1, Math.max(0, volume)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Blend" wide>
        <NumberField
          value={component.blendDistance}
          onCommit={(blendDistance) =>
            update({
              ...component,
              blendDistance: Math.min(maxBlend, Math.max(0, blendDistance)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Zone" wide>
        <SelectField
          options={['sphere', 'box']}
          value={component.zone.shape}
          onCommit={(shape) => {
            if (shape === component.zone.shape) return;
            update({
              ...component,
              blendDistance: Math.min(component.blendDistance, 2.5),
              zone:
                shape === 'sphere'
                  ? { shape: 'sphere', radius: 5 }
                  : { shape: 'box', size: { x: 10, y: 5, z: 10 } },
            });
          }}
        />
      </FieldRow>
      {component.zone.shape === 'sphere' ? (
        <FieldRow label="Radius" wide>
          <NumberField
            value={component.zone.radius}
            onCommit={(radius) => {
              const nextRadius = Math.min(500, Math.max(0.05, radius));
              update({
                ...component,
                blendDistance: Math.min(component.blendDistance, nextRadius),
                zone: { shape: 'sphere', radius: nextRadius },
              });
            }}
          />
        </FieldRow>
      ) : (
        <FieldRow label="Size">
          {(['x', 'y', 'z'] as const).map((axis) => {
            const boxZone = component.zone;
            if (boxZone.shape !== 'box') return null;
            return (
              <NumberField
                key={axis}
                value={boxZone.size[axis]}
                onCommit={(value) => {
                  const size = {
                    ...boxZone.size,
                    [axis]: Math.min(1_000, Math.max(0.05, value)),
                  };
                  update({
                    ...component,
                    blendDistance: Math.min(
                      component.blendDistance,
                      Math.min(size.x, size.y, size.z) / 2,
                    ),
                    zone: { shape: 'box', size },
                  });
                }}
              />
            );
          })}
        </FieldRow>
      )}
      <EdButton
        title={component.soundUrl ? 'Preview assigned sound' : 'Assign an audio asset first'}
        disabled={!component.soundUrl}
        onClick={() => {
          if (!component.soundUrl) return;
          options.audioPreview.toggle(
            previewKey,
            component.soundUrl,
            {
              loop: component.playback === 'loop',
              volume: component.volume,
            },
            setPlaying,
          );
        }}
      >
        {playing ? 'Stop preview' : 'Preview sound'}
      </EdButton>
    </>
  );
}

export function ColliderFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'collider' }>>): ReactElement {
  const { update, fieldOptions } = ctx;
  return (
    <>
      <FieldRow label="Shape" wide>
        <SelectField
          options={['box', 'mesh']}
          value={component.shape}
          onCommit={(shape) => {
            if (shape === 'mesh') {
              update({
                type: 'collider',
                shape: 'mesh',
                node: component.node,
              });
              return;
            }
            const fitted = fieldOptions?.colliderNodeBounds
              ? fitBoxColliderToBounds(fieldOptions.colliderNodeBounds)
              : null;
            update({
              type: 'collider',
              shape: 'box',
              size: fitted?.size ?? { x: 1, y: 1, z: 1 },
              offset: fitted?.offset,
              node: component.node,
            });
          }}
        />
      </FieldRow>
      {component.shape === 'box' ? (
        <FieldRow label="Size">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <NumberField
              key={axis}
              value={component.size[axis]}
              onCommit={(next) =>
                update({
                  ...component,
                  size: {
                    ...component.size,
                    [axis]: Math.max(0.01, next),
                  },
                })
              }
            />
          ))}
        </FieldRow>
      ) : (
        <>
          <FieldRow label="Asset" wide>
            <TextField
              value={component.assetUrl ?? ''}
              onCommit={(assetUrl) =>
                update({
                  ...component,
                  assetUrl: assetUrl.trim() || undefined,
                })
              }
            />
          </FieldRow>
          <CheckboxRow
            label="Convex hull"
            checked={component.convex ?? false}
            onChange={(checked) =>
              update({ ...component, convex: checked || undefined })
            }
          />
          <ColliderExcludeNodes
            store={ctx.store}
            nodes={component.excludeNodes ?? []}
            onChange={(excludeNodes) => update({ ...component, excludeNodes })}
          />
        </>
      )}
      <Vec3NumberRow
        label="Offset"
        values={{
          x: component.offset?.x ?? 0,
          y: component.offset?.y ?? 0,
          z: component.offset?.z ?? 0,
        }}
        onCommitAxis={(axis, next) =>
          update({
            ...component,
            offset: {
              x: 0,
              y: 0,
              z: 0,
              ...component.offset,
              [axis]: next,
            },
          })
        }
      />
      {!fieldOptions?.hideColliderNodeField ? (
        <FieldRow label="Node" wide>
          <TextField
            value={component.node ?? ''}
            onCommit={(node) =>
              update({ ...component, node: node.trim() || undefined })
            }
          />
        </FieldRow>
      ) : null}
    </>
  );
}
