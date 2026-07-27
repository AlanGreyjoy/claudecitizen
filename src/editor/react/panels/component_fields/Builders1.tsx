import type { ReactElement } from 'react';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import type { StationFloorId } from '../../../../world/station';
import { FLOOR_OPTIONS } from '../../../panels/inspector-logic';
import type { ComponentFieldsProps } from './context';
import {
  AssetUrlField,
  FieldRow,
  Hint,
  ImageAssetUrlField,
  ModelAssetUrlField,
  NumberField,
  SelectField,
  TextField,
} from '../InspectorForm';

export function BarrelEndFields(): ReactElement {
  return <></>;
}

export function WeaponCombatFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'weapon-combat' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <AssetUrlField
        label="Fire SFX"
        value={component.fireSoundUrl ?? undefined}
        onCommit={(fireSoundUrl) =>
          update({ ...component, fireSoundUrl: fireSoundUrl ?? null })
        }
      />
      <AssetUrlField
        label="Dry-fire SFX"
        value={component.dryFireSoundUrl ?? undefined}
        onCommit={(dryFireSoundUrl) =>
          update({ ...component, dryFireSoundUrl: dryFireSoundUrl ?? null })
        }
      />
      <AssetUrlField
        label="Reload SFX"
        value={component.reloadSoundUrl ?? undefined}
        onCommit={(reloadSoundUrl) =>
          update({ ...component, reloadSoundUrl: reloadSoundUrl ?? null })
        }
      />
      <ImageAssetUrlField
        label="Hit decal"
        value={component.hitDecalUrl ?? undefined}
        onCommit={(hitDecalUrl) =>
          update({ ...component, hitDecalUrl: hitDecalUrl ?? null })
        }
      />
    </>
  );
}

export function SpawnPointFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'spawn-point' }>>): ReactElement {
  const { update } = ctx;
  return (
    <FieldRow label="Floor" wide>
      <SelectField
        options={FLOOR_OPTIONS}
        value={component.floorId}
        onCommit={(floorId) =>
          update({ ...component, floorId: floorId as StationFloorId })
        }
      />
    </FieldRow>
  );
}

export function NpcSpawnerFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'npc-spawner' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField
          value={component.id}
          onCommit={(id) => update({ ...component, id: id.trim() })}
        />
      </FieldRow>
      <FieldRow label="Population" wide>
        <TextField
          value={component.populationId}
          onCommit={(populationId) =>
            update({ ...component, populationId: populationId.trim() })
          }
        />
      </FieldRow>
      <ModelAssetUrlField
        label="Character model"
        value={component.modelUrl}
        onCommit={(modelUrl) => update({ ...component, modelUrl })}
      />
      <Hint>
        Drag a character GLB from the asset browser. Empty uses the modular
        Sidekick avatar from the population definition.
      </Hint>
      <FieldRow label="Floor" wide>
        <SelectField
          options={FLOOR_OPTIONS}
          value={component.floorId}
          onCommit={(floorId) =>
            update({ ...component, floorId: floorId as StationFloorId })
          }
        />
      </FieldRow>
      <FieldRow label="Behavior" wide>
        <SelectField
          options={['route', 'roam']}
          value={component.behavior}
          onCommit={(behavior) =>
            update({ ...component, behavior: behavior as 'route' | 'roam' })
          }
        />
      </FieldRow>
      {component.behavior === 'route' ? (
        <FieldRow label="Route group" wide>
          <TextField
            value={component.routeGroup}
            onCommit={(routeGroup) =>
              update({ ...component, routeGroup: routeGroup.trim() })
            }
          />
        </FieldRow>
      ) : (
        <Hint>
          Roaming needs no waypoints, but there is no station navmesh either —
          NPCs walk straight lines and pass through walls and props. Keep the
          roam radius inside open floor.
        </Hint>
      )}
      <FieldRow label="Min alive" wide>
        <NumberField
          value={component.minAlive}
          step={1}
          onCommit={(minAlive) => {
            const nextMin = Math.max(0, Math.min(32, Math.round(minAlive)));
            update({
              ...component,
              minAlive: nextMin,
              maxAlive: Math.max(nextMin, component.maxAlive),
            });
          }}
        />
      </FieldRow>
      <FieldRow label="Max alive" wide>
        <NumberField
          value={component.maxAlive}
          step={1}
          onCommit={(maxAlive) =>
            update({
              ...component,
              maxAlive: Math.max(
                component.minAlive,
                Math.min(32, Math.round(maxAlive)),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Radius" wide>
        <NumberField
          value={component.radius}
          onCommit={(radius) =>
            update({ ...component, radius: Math.max(0, Math.min(20, radius)) })
          }
        />
      </FieldRow>
      <Hint>Spawn jitter around the marker.</Hint>
      {component.behavior === 'roam' ? (
        <>
          <FieldRow label="Roam radius" wide>
            <NumberField
              value={component.roamRadius}
              onCommit={(roamRadius) =>
                update({
                  ...component,
                  roamRadius: Math.max(0, Math.min(60, roamRadius)),
                })
              }
            />
          </FieldRow>
          <FieldRow label="Roam wait min" wide>
            <NumberField
              value={component.roamWaitMinSeconds}
              onCommit={(seconds) => {
                const nextMin = Math.max(0, Math.min(120, seconds));
                update({
                  ...component,
                  roamWaitMinSeconds: nextMin,
                  roamWaitMaxSeconds: Math.max(nextMin, component.roamWaitMaxSeconds),
                });
              }}
            />
          </FieldRow>
          <FieldRow label="Roam wait max" wide>
            <NumberField
              value={component.roamWaitMaxSeconds}
              onCommit={(seconds) =>
                update({
                  ...component,
                  roamWaitMaxSeconds: Math.max(
                    component.roamWaitMinSeconds,
                    Math.min(120, seconds),
                  ),
                })
              }
            />
          </FieldRow>
        </>
      ) : null}
    </>
  );
}

export function NpcWaypointFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'npc-waypoint' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField
          value={component.id}
          onCommit={(id) => update({ ...component, id: id.trim() })}
        />
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
      <FieldRow label="Route group" wide>
        <TextField
          value={component.routeGroup}
          onCommit={(routeGroup) =>
            update({ ...component, routeGroup: routeGroup.trim() })
          }
        />
      </FieldRow>
      <FieldRow label="Links" wide>
        <TextField
          value={component.links.join(', ')}
          onCommit={(raw) => {
            const links = raw
              .split(/[\s,]+/)
              .map((id) => id.trim())
              .filter((id, index, all) => id.length > 0 && all.indexOf(id) === index)
              .slice(0, 16);
            update({ ...component, links });
          }}
        />
      </FieldRow>
      <Hint>Comma-separated waypoint ids. Connections are undirected.</Hint>
      <FieldRow label="Wait min" wide>
        <NumberField
          value={component.waitMinSeconds}
          onCommit={(waitMinSeconds) => {
            const nextMin = Math.max(0, Math.min(120, waitMinSeconds));
            update({
              ...component,
              waitMinSeconds: nextMin,
              waitMaxSeconds: Math.max(nextMin, component.waitMaxSeconds),
            });
          }}
        />
      </FieldRow>
      <FieldRow label="Wait max" wide>
        <NumberField
          value={component.waitMaxSeconds}
          onCommit={(waitMaxSeconds) =>
            update({
              ...component,
              waitMaxSeconds: Math.max(
                component.waitMinSeconds,
                Math.min(120, waitMaxSeconds),
              ),
            })
          }
        />
      </FieldRow>
    </>
  );
}

export function NpcPlacementFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'npc-placement' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Id" wide>
        <TextField
          value={component.id}
          onCommit={(id) => update({ ...component, id: id.trim() })}
        />
      </FieldRow>
      <FieldRow label="Definition" wide>
        <TextField
          value={component.npcDefinitionId}
          onCommit={(npcDefinitionId) =>
            update({ ...component, npcDefinitionId: npcDefinitionId.trim() })
          }
        />
      </FieldRow>
      <FieldRow label="Display name" wide>
        <TextField
          value={component.displayName ?? ''}
          onCommit={(displayName) =>
            update({ ...component, displayName: displayName.trim() || undefined })
          }
        />
      </FieldRow>
      <ModelAssetUrlField
        label="Character model"
        value={component.modelUrl}
        onCommit={(modelUrl) => update({ ...component, modelUrl })}
      />
      <Hint>
        Drag a character GLB from the asset browser. Empty uses the modular
        Sidekick avatar from the definition.
      </Hint>
      <FieldRow label="Floor" wide>
        <SelectField
          options={FLOOR_OPTIONS}
          value={component.floorId}
          onCommit={(floorId) =>
            update({ ...component, floorId: floorId as StationFloorId })
          }
        />
      </FieldRow>
      <FieldRow label="Behavior" wide>
        <SelectField
          options={['stationary', 'wander', 'patrol']}
          value={component.behavior}
          onCommit={(behavior) =>
            update({
              ...component,
              behavior: behavior as 'stationary' | 'wander' | 'patrol',
            })
          }
        />
      </FieldRow>
      {component.behavior !== 'stationary' ? (
        <FieldRow label="Route group" wide>
          <TextField
            value={component.routeGroup ?? ''}
            onCommit={(routeGroup) =>
              update({ ...component, routeGroup: routeGroup.trim() || undefined })
            }
          />
        </FieldRow>
      ) : null}
    </>
  );
}
