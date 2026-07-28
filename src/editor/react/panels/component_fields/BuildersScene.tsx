import { type ReactElement } from 'react';
import {
  SCENE_INSTANCE_SCOPES,
  SCENE_UI_SCREENS,
  type PrefabComponent,
  type SceneInstanceScope,
  type SceneUiScreen,
} from '../../../../world/prefabs/schema';
import type { ComponentFieldsProps } from './context';
import {
  CheckboxRow,
  FieldRow,
  NumberField,
  SelectField,
  TextField,
} from '../InspectorForm';
import { SceneRefField } from './SceneRefField';

const SPAWN_OPTIONS = ['station', 'surface'];
const PREFAB_KIND_OPTIONS = ['station', 'ship', 'site', 'prop', 'item'];
const AUTO_OPTIONS = ['on activate', 'automatic'];
const NONE_SCENE = '';

type GameManagerComponent = Extract<PrefabComponent, { type: 'game-manager' }>;

/** Hop fields, in flow order, with the label and the "unset" copy for each. */
const GAME_MANAGER_HOPS: Array<{
  key: 'titleSceneId' | 'characterCreateSceneId' | 'startingSceneId'
    | 'openSpaceSceneId' | 'loadingSceneId';
  label: string;
  emptyLabel: string;
}> = [
  {
    key: 'titleSceneId',
    label: 'Title Scene',
    emptyLabel: '(none — host the title here)',
  },
  {
    key: 'characterCreateSceneId',
    label: 'Character Create Scene',
    emptyLabel: '(none — inline create gate)',
  },
  {
    key: 'startingSceneId',
    label: 'Starting Hab',
    emptyLabel: '(none — use scene-link)',
  },
  {
    key: 'openSpaceSceneId',
    label: 'Open Space Scene',
    emptyLabel: '(none — no @space exits)',
  },
  {
    key: 'loadingSceneId',
    label: 'Loading Scene',
    emptyLabel: '(none — built-in overlay)',
  },
];

/** The authored pipeline: every hop plus the two auth switches. */
function GameManagerFlowFields({
  component,
  currentSceneId,
  commit,
}: {
  component: GameManagerComponent;
  currentSceneId: string;
  commit: (patch: Partial<GameManagerComponent>) => void;
}): ReactElement {
  return (
    <>
      {GAME_MANAGER_HOPS.map(({ key, label, emptyLabel }) => (
        <FieldRow key={key} label={label} wide>
          <SceneRefField
            value={component[key] ?? NONE_SCENE}
            emptyLabel={emptyLabel}
            excludeSceneId={currentSceneId}
            onCommit={(sceneId) => commit({ [key]: sceneId })}
          />
        </FieldRow>
      ))}
      <CheckboxRow
        label="Require sign-in"
        checked={component.requireAuth ?? true}
        onChange={(requireAuth) => commit({ requireAuth })}
      />
      <CheckboxRow
        label="Skip title when signed in"
        checked={component.skipTitleWhenSignedIn ?? false}
        onChange={(skipTitleWhenSignedIn) => commit({ skipTitleWhenSignedIn })}
      />
    </>
  );
}

export function GameManagerFields({
  ctx,
  component,
}: ComponentFieldsProps<GameManagerComponent>): ReactElement {
  const { update, store } = ctx;
  const currentSceneId = store.getState().prefabId;

  function commitGameManager(patch: Partial<GameManagerComponent>): void {
    // Spread the merged component rather than rebuilding from a key list: an
    // explicit rebuild silently drops every field it forgets, which is how a
    // newly added hop would get erased the next time Spawn is touched.
    const next = { ...component, ...patch, type: 'game-manager' as const };
    for (const { key } of GAME_MANAGER_HOPS) {
      if (!(next[key] ?? '').trim()) delete next[key];
    }
    update(next);
  }

  return (
    <>
      <FieldRow label="System ID" wide>
        <TextField
          value={component.systemId}
          onCommit={(systemId) => commitGameManager({ systemId })}
        />
      </FieldRow>
      <FieldRow label="Planet ID" wide>
        <TextField
          value={component.planetId}
          onCommit={(planetId) => commitGameManager({ planetId })}
        />
      </FieldRow>
      <FieldRow label="Spawn" wide>
        <SelectField
          options={SPAWN_OPTIONS}
          value={component.spawn}
          onCommit={(spawn) =>
            commitGameManager({
              spawn: spawn === 'surface' ? 'surface' : 'station',
            })
          }
        />
      </FieldRow>
      <GameManagerFlowFields
        component={component}
        currentSceneId={currentSceneId}
        commit={commitGameManager}
      />
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
          value={component.prefabKind ?? 'prop'}
          onCommit={(prefabKind) =>
            update({
              ...component,
              prefabKind: prefabKind as
                | 'station'
                | 'ship'
                | 'site'
                | 'prop'
                | 'item',
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
            onCommit={(menuId) =>
              update({ ...component, menuId: menuId.trim() || undefined })
            }
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
  const { update, store } = ctx;
  return (
    <>
      <FieldRow label="Scene" wide>
        <SceneRefField
          value={component.sceneId}
          emptyLabel="(pick a scene)"
          excludeSceneId={store.getState().prefabId}
          onCommit={(sceneId) => update({ ...component, sceneId })}
        />
      </FieldRow>
      <FieldRow label="Advance" wide>
        <SelectField
          options={AUTO_OPTIONS}
          value={component.auto ? 'automatic' : 'on activate'}
          onCommit={(value) =>
            update({ ...component, auto: value === 'automatic' })
          }
        />
      </FieldRow>
      {component.auto ? (
        <FieldRow label="Delay (s)" wide>
          <NumberField
            value={component.delaySeconds ?? 0}
            onCommit={(delaySeconds) => update({ ...component, delaySeconds })}
          />
        </FieldRow>
      ) : null}
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
