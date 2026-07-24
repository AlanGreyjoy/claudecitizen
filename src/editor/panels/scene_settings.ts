import {
  fetchPlanetList,
  fetchPrefabList,
  fetchSystemList,
  type PlanetListEntry,
  type PrefabListEntry,
  type SystemListEntry,
} from '../api';
import { clearChildren, el, showToast } from '../dom';
import type { EditorStore } from '../document';
import {
  SCENE_ID_PATTERN,
  SCENE_KINDS,
  type SceneKind,
  type SceneSettings,
} from '../../world/scenes/schema';

function titleForKind(kind: SceneKind): string {
  return kind
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function option(value: string, label: string, selected: boolean): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  element.selected = selected;
  return element;
}

function field(label: string, control: HTMLElement, detail?: string): HTMLElement {
  return el('label', { className: 'ed-scene-settings-field' }, [
    el('span', { className: 'ed-scene-settings-label', text: label }),
    control,
    ...(detail ? [el('span', { className: 'ed-scene-settings-detail', text: detail })] : []),
  ]);
}

/**
 * Modal editor for File → Scene → Settings. Mutates the open scene document's
 * sceneKind / sceneSettings on the shared EditorStore.
 */
export async function openSceneSettingsModal(store: EditorStore): Promise<void> {
  const state = store.getState();
  if (state.documentType !== 'scene') {
    showToast('Open a scene to edit Scene Settings.', true);
    return;
  }

  let systems: SystemListEntry[] = [];
  let planets: PlanetListEntry[] = [];
  let prefabs: PrefabListEntry[] = [];
  try {
    [systems, planets, prefabs] = await Promise.all([
      fetchSystemList(),
      fetchPlanetList(),
      fetchPrefabList(),
    ]);
  } catch {
    // Lists may be empty when the project API is cold.
  }

  let draftKind: SceneKind = state.sceneKind;
  const draftSettings: SceneSettings = structuredClone(state.sceneSettings);
  let draftName = state.prefabName;
  let draftId = state.prefabId;

  const overlay = el('div', { className: 'ed-dialog-overlay is-visible' });
  const dialog = el('div', {
    className: 'ed-dialog ed-scene-settings-modal',
    attrs: { role: 'dialog', 'aria-modal': 'true' },
  });
  const form = el('div', { className: 'ed-scene-settings-form' });
  const status = el('div', { className: 'ed-system-status', text: 'Scene Settings' });

  const close = (): void => {
    overlay.remove();
  };

  const renderForm = (): void => {
    clearChildren(form);

    const nameInput = el('input', {
      className: 'ed-input',
      attrs: { type: 'text', value: draftName },
      on: {
        input: () => {
          draftName = nameInput.value;
        },
        keydown: (event) => event.stopPropagation(),
      },
    });
    const idInput = el('input', {
      className: 'ed-input',
      attrs: { type: 'text', value: draftId },
      on: {
        input: () => {
          draftId = idInput.value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 64);
          idInput.value = draftId;
        },
        keydown: (event) => event.stopPropagation(),
      },
    });
    nameInput.addEventListener('input', () => {
      if (!draftId || draftId === slugify(store.getState().prefabName)) {
        draftId = slugify(nameInput.value);
        idInput.value = draftId;
      }
    });

    const kindSelect = el('select', {
      className: 'ed-input',
      on: {
        change: () => {
          draftKind = kindSelect.value as SceneKind;
          renderForm();
        },
        keydown: (event) => event.stopPropagation(),
      },
    });
    kindSelect.append(
      ...SCENE_KINDS.map((kind) => option(kind, titleForKind(kind), kind === draftKind)),
    );

    form.append(
      field('Scene ID', idInput, 'Stable filename and runtime identifier.'),
      field('Name', nameInput),
      field(
        'Runtime',
        kindSelect,
        'Runtime adapters let existing screens and gameplay become scene assets incrementally.',
      ),
    );

    if (draftKind === 'main-game') {
      const systemSelect = el('select', {
        className: 'ed-input',
        on: {
          change: () => {
            draftSettings.systemId = systemSelect.value;
          },
          keydown: (event) => event.stopPropagation(),
        },
      });
      systemSelect.append(
        ...systems.map(({ id, name }) =>
          option(id, `${name} (${id})`, id === draftSettings.systemId),
        ),
      );
      const planetSelect = el('select', {
        className: 'ed-input',
        on: {
          change: () => {
            draftSettings.planetId = planetSelect.value;
          },
          keydown: (event) => event.stopPropagation(),
        },
      });
      planetSelect.append(
        ...planets.map(({ id, name }) =>
          option(id, `${name} (${id})`, id === draftSettings.planetId),
        ),
      );
      const spawnSelect = el('select', {
        className: 'ed-input',
        on: {
          change: () => {
            draftSettings.spawn = spawnSelect.value === 'surface' ? 'surface' : 'station';
          },
          keydown: (event) => event.stopPropagation(),
        },
      });
      spawnSelect.append(
        option('station', 'Orbital station', draftSettings.spawn === 'station'),
        option('surface', 'Planet surface', draftSettings.spawn === 'surface'),
      );
      form.append(
        field('System', systemSelect),
        field('Planet', planetSelect),
        field('Spawn', spawnSelect),
      );
    } else if (draftKind === 'prefab-stage' || draftKind === 'instance') {
      const stagePrefabs = prefabs.filter(
        (entry) => entry.kind === 'station' || entry.kind === 'ship',
      );
      const prefabSelect = el('select', {
        className: 'ed-input',
        on: {
          change: () => {
            const prefab = stagePrefabs.find((entry) => entry.id === prefabSelect.value);
            draftSettings.prefabId = prefabSelect.value;
            draftSettings.prefabKind = prefab?.kind === 'ship' ? 'ship' : 'station';
          },
          keydown: (event) => event.stopPropagation(),
        },
      });
      prefabSelect.append(
        ...stagePrefabs.map(({ id, name, kind }) =>
          option(id, `${name} (${kind})`, id === (draftSettings.prefabId ?? '')),
        ),
      );
      form.append(
        field(
          'Root Prefab',
          prefabSelect,
          draftKind === 'instance'
            ? 'Root prefab for an instanced hangar, habitat, station room, or similar bounded space.'
            : 'Root prefab for an isolated prefab test scene.',
        ),
      );
    } else {
      form.append(
        el('div', {
          className: 'ed-scene-settings-note',
          text: `${titleForKind(draftKind)} uses its existing application runtime. Scene-owned objects can be added as that runtime is migrated.`,
        }),
      );
    }
  };

  const apply = (): void => {
    if (!SCENE_ID_PATTERN.test(draftId) && draftId !== '') {
      status.textContent = 'Scene id must be a lowercase slug.';
      status.classList.add('is-error');
      return;
    }
    store.setDocumentMeta({
      prefabId: draftId,
      prefabName: draftName.trim() || 'Untitled Scene',
      sceneKind: draftKind,
      sceneSettings: draftSettings,
    });
    showToast('Scene settings updated.');
    close();
  };

  dialog.append(
    el('div', { className: 'ed-scene-settings-heading', text: 'Scene Settings' }),
    el('p', {
      className: 'ed-scene-settings-copy',
      text: 'Startup settings for the open scene. Prefer GameManager / Planet / PlayerStart components on GameObjects for world config.',
    }),
    status,
    form,
    el('div', { className: 'ed-base-actions' }, [
      el('button', {
        className: 'ed-btn ed-btn-accent',
        text: 'Apply',
        on: { click: () => apply() },
      }),
      el('button', {
        className: 'ed-btn',
        text: 'Cancel',
        on: { click: () => close() },
      }),
    ]),
  );
  overlay.append(dialog);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  renderForm();
}
