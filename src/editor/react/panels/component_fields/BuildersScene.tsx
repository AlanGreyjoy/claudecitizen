import { useEffect, useState, type ReactElement } from 'react';
import {
  SCENE_INSTANCE_SCOPES,
  SCENE_UI_SCREENS,
  type PrefabComponent,
  type SceneInstanceScope,
  type SceneUiScreen,
} from '../../../../world/prefabs/schema';
import { fetchSceneList, type SceneListEntry } from '../../../api';
import type { ComponentFieldsProps } from './context';
import { FieldRow, NumberField, SelectField, TextField } from '../InspectorForm';

const SPAWN_OPTIONS = ['station', 'surface'];
const PREFAB_KIND_OPTIONS = ['station', 'ship', 'site', 'prop', 'item'];
const AUTO_OPTIONS = ['on activate', 'automatic'];
const NONE_SCENE = '';

export function GameManagerFields({
  ctx,
  component,
}: ComponentFieldsProps<Extract<PrefabComponent, { type: 'game-manager' }>>): ReactElement {
  const { update, store } = ctx;
  const [scenes, setScenes] = useState<SceneListEntry[]>([]);
  const currentSceneId = store.getState().prefabId;

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

  const starting = component.startingSceneId ?? NONE_SCENE;
  const characterCreate = component.characterCreateSceneId ?? NONE_SCENE;
  const sceneEntries = scenes.filter((entry) => entry.id !== currentSceneId);
  for (const id of [starting, characterCreate]) {
    if (id && !sceneEntries.some((entry) => entry.id === id)) {
      sceneEntries.unshift({ id, name: id });
    }
  }

  function commitGameManager(
    patch: Partial<Extract<PrefabComponent, { type: 'game-manager' }>>,
  ): void {
    const next = { ...component, ...patch };
    const characterCreateSceneId = (next.characterCreateSceneId ?? '').trim();
    const startingSceneId = (next.startingSceneId ?? '').trim();
    update({
      type: 'game-manager',
      systemId: next.systemId,
      planetId: next.planetId,
      spawn: next.spawn,
      ...(characterCreateSceneId ? { characterCreateSceneId } : {}),
      ...(startingSceneId ? { startingSceneId } : {}),
    });
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
      <FieldRow label="Character Create Scene" wide>
        <select
          className="ed-select"
          value={characterCreate}
          onChange={(event) =>
            commitGameManager({
              characterCreateSceneId: event.currentTarget.value.trim(),
            })
          }
        >
          <option value={NONE_SCENE}>(none — inline create gate)</option>
          {sceneEntries.map(({ id, name }) => (
            <option key={`create-${id}`} value={id}>
              {name} ({id})
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Starting Hab" wide>
        <select
          className="ed-select"
          value={starting}
          onChange={(event) =>
            commitGameManager({
              startingSceneId: event.currentTarget.value.trim(),
            })
          }
        >
          <option value={NONE_SCENE}>(none — use scene-link)</option>
          {sceneEntries.map(({ id, name }) => (
            <option key={`start-${id}`} value={id}>
              {name} ({id})
            </option>
          ))}
        </select>
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
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Scene ID" wide>
        <TextField
          value={component.sceneId}
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
