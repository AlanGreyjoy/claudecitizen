import type { ReactElement } from 'react';
import {
  SCENE_INSTANCE_SCOPES,
  SCENE_UI_SCREENS,
  type PrefabComponent,
  type SceneInstanceScope,
  type SceneUiScreen,
} from '../../../../world/prefabs/schema';
import type { ComponentFieldsProps } from './context';
import { FieldRow, NumberField, SelectField, TextField } from '../InspectorForm';

const SPAWN_OPTIONS = ['station', 'surface'];
const PREFAB_KIND_OPTIONS = ['station', 'ship', 'site', 'prop', 'item'];
const AUTO_OPTIONS = ['on activate', 'automatic'];

export function GameManagerFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'game-manager' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="System ID" wide>
        <TextField
          value={component.systemId}
          onCommit={(systemId) => update({ ...component, systemId })}
        />
      </FieldRow>
      <FieldRow label="Planet ID" wide>
        <TextField
          value={component.planetId}
          onCommit={(planetId) => update({ ...component, planetId })}
        />
      </FieldRow>
      <FieldRow label="Spawn" wide>
        <SelectField
          options={SPAWN_OPTIONS}
          value={component.spawn}
          onCommit={(spawn) =>
            update({
              ...component,
              spawn: spawn === 'surface' ? 'surface' : 'station',
            })
          }
        />
      </FieldRow>
    </>
  );
}

export function PlanetFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'planet' }>>): ReactElement {
  const { update } = ctx;
  return (
    <FieldRow label="Planet ID" wide>
      <TextField
        value={component.planetId}
        onCommit={(planetId) => update({ ...component, planetId })}
      />
    </FieldRow>
  );
}

export function PlayerStartFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'player-start' }>>): ReactElement {
  const { update } = ctx;
  return (
    <FieldRow label="Spawn" wide>
      <SelectField
        options={SPAWN_OPTIONS}
        value={component.spawn}
        onCommit={(spawn) =>
          update({
            ...component,
            spawn: spawn === 'surface' ? 'surface' : 'station',
          })
        }
      />
    </FieldRow>
  );
}

export function PrefabInstanceFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'prefab-instance' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Prefab ID" wide>
        <TextField
          value={component.prefabId}
          onCommit={(prefabId) => update({ ...component, prefabId })}
        />
      </FieldRow>
      <FieldRow label="Kind" wide>
        <SelectField
          options={PREFAB_KIND_OPTIONS}
          value={component.prefabKind ?? 'station'}
          onCommit={(prefabKind) =>
            update({
              ...component,
              prefabKind: prefabKind as NonNullable<
                Extract<PrefabComponent, { type: 'prefab-instance' }>['prefabKind']
              >,
            })
          }
        />
      </FieldRow>
    </>
  );
}

export function UiScreenFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'ui-screen' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Screen" wide>
        <SelectField
          options={[...SCENE_UI_SCREENS]}
          value={component.screen}
          onCommit={(screen) =>
            update({ ...component, screen: screen as SceneUiScreen })
          }
        />
      </FieldRow>
      {component.screen === 'menu' ? (
        <FieldRow label="Menu ID" wide>
          <TextField
            value={component.menuId ?? ''}
            onCommit={(menuId) => update({ ...component, menuId })}
          />
        </FieldRow>
      ) : null}
    </>
  );
}

export function SceneLinkFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'scene-link' }>>): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Scene ID" wide>
        <TextField
          value={component.sceneId}
          onCommit={(sceneId) => update({ ...component, sceneId })}
        />
      </FieldRow>
      <FieldRow label="Trigger" wide>
        <SelectField
          options={AUTO_OPTIONS}
          value={component.auto ? 'automatic' : 'on activate'}
          onCommit={(mode) => update({ ...component, auto: mode === 'automatic' })}
        />
      </FieldRow>
      <FieldRow label="Delay (s)" wide>
        <NumberField
          value={component.delaySeconds ?? 0}
          onCommit={(delaySeconds) => update({ ...component, delaySeconds })}
        />
      </FieldRow>
    </>
  );
}

export function InstancedSceneFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'instanced-scene' }>>): ReactElement {
  const { update } = ctx;
  return (
    <FieldRow label="Scope" wide>
      <SelectField
        options={[...SCENE_INSTANCE_SCOPES]}
        value={component.scope}
        onCommit={(scope) =>
          update({ ...component, scope: scope as SceneInstanceScope })
        }
      />
    </FieldRow>
  );
}
