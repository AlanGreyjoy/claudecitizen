import { clearChildren, el } from '../dom';
import type { EditorEntity, EditorStore } from '../document';
import type { PrefabComponent, PrefabComponentType } from '../../world/prefabs/schema';
import type { StationFloorId, StationSide } from '../../world/station';

const FLOOR_OPTIONS: StationFloorId[] = ['hab', 'lobby', 'hangar'];
const SIDE_OPTIONS: StationSide[] = ['minRight', 'maxRight', 'minForward', 'maxForward'];

const COMPONENT_DEFAULTS: Record<PrefabComponentType, () => PrefabComponent> = {
  'station-frame': () => ({ type: 'station-frame' }),
  'spawn-point': () => ({ type: 'spawn-point', floorId: 'lobby' }),
  elevator: () => ({ type: 'elevator', id: 'lift-1', targetFloor: 'lobby' }),
  'hangar-pad': () => ({ type: 'hangar-pad', hangarId: 'bay-1', padIndex: 1 }),
  interaction: () => ({ type: 'interaction', id: 'info-1', prompt: 'Press F — inspect', radius: 2.5 }),
  'walk-volume': () => ({
    type: 'walk-volume',
    floorId: 'lobby',
    min: { x: -5, z: -5 },
    max: { x: 5, z: 5 },
    height: 4,
  }),
  collider: () => ({ type: 'collider', shape: 'box', size: { x: 1, y: 1, z: 1 } }),
};

const COMPONENT_HINTS: Partial<Record<PrefabComponentType, string>> = {
  'station-frame': 'Marks the prefab origin used for orbital placement.',
  'spawn-point': 'Player spawn. Entity forward (+Z) sets the facing direction.',
  elevator: 'Pair two markers with the same id on different floors to ride between them.',
  'hangar-pad': 'Ship parking spot. Place inside a hangar walk volume, at pad surface height.',
  interaction: 'Shows a prompt when the player is within the radius.',
  'walk-volume': 'Walkable floor area (local XZ box). The player collides with its edges.',
  collider: 'Reserved for future physics; not used by gameplay yet.',
};

export function createInspectorPanel(container: HTMLElement, store: EditorStore): void {
  const body = el('div', { className: 'ed-panel-body' });
  container.append(
    el('div', { className: 'ed-panel-title' }, [el('span', { text: 'Inspector' })]),
    body,
  );

  function numberInput(
    value: number,
    onCommit: (next: number) => void,
    step = 0.1,
  ): HTMLInputElement {
    return el('input', {
      className: 'ed-input',
      attrs: { type: 'number', step: String(step), value: String(Math.round(value * 1000) / 1000) },
      on: {
        change: (event) => {
          const next = Number((event.target as HTMLInputElement).value);
          if (Number.isFinite(next)) onCommit(next);
        },
        keydown: (event) => event.stopPropagation(),
      },
    });
  }

  function textInput(value: string, onCommit: (next: string) => void): HTMLInputElement {
    return el('input', {
      className: 'ed-input',
      attrs: { type: 'text', value },
      on: {
        change: (event) => onCommit((event.target as HTMLInputElement).value),
        keydown: (event) => event.stopPropagation(),
      },
    });
  }

  function selectInput(
    options: readonly string[],
    value: string,
    onCommit: (next: string) => void,
  ): HTMLSelectElement {
    const select = el('select', {
      className: 'ed-select',
      on: { change: (event) => onCommit((event.target as HTMLSelectElement).value) },
    });
    for (const option of options) {
      const optionEl = el('option', { text: option, attrs: { value: option } });
      if (option === value) optionEl.selected = true;
      select.append(optionEl);
    }
    return select;
  }

  interface TransformInputs {
    fields: Record<'position' | 'rotation' | 'scale', HTMLInputElement[]>;
  }
  let transformInputs: TransformInputs | null = null;

  function commitTransform(entity: EditorEntity): void {
    if (!transformInputs) return;
    const read = (inputs: HTMLInputElement[]) => ({
      x: Number(inputs[0].value) || 0,
      y: Number(inputs[1].value) || 0,
      z: Number(inputs[2].value) || 0,
    });
    store.setTransform(entity.id, {
      position: read(transformInputs.fields.position),
      rotation: read(transformInputs.fields.rotation),
      scale: read(transformInputs.fields.scale),
    });
  }

  function transformSection(entity: EditorEntity): HTMLElement {
    const section = el('div', { className: 'ed-section' }, [
      el('h3', { className: 'ed-section-title', text: 'Transform' }),
    ]);
    const fields: TransformInputs['fields'] = { position: [], rotation: [], scale: [] };
    const rows: [keyof TransformInputs['fields'], string, number][] = [
      ['position', 'Position', 0.25],
      ['rotation', 'Rotation°', 5],
      ['scale', 'Scale', 0.1],
    ];
    for (const [key, label, step] of rows) {
      const source = entity[key];
      const inputs = (['x', 'y', 'z'] as const).map((axis) =>
        numberInput(source[axis], () => commitTransform(entity), step),
      );
      fields[key] = inputs;
      section.append(
        el('div', { className: 'ed-field-row' }, [
          el('span', { className: 'ed-field-label', text: label }),
          ...inputs,
        ]),
      );
    }
    transformInputs = { fields };
    return section;
  }

  function visualSection(entity: EditorEntity): HTMLElement {
    const section = el('div', { className: 'ed-section' }, [
      el('h3', { className: 'ed-section-title', text: 'Visual' }),
    ]);

    if (entity.asset) {
      const asset = entity.asset;
      section.append(
        el('div', { className: 'ed-field-row-wide' }, [
          el('span', { className: 'ed-field-label', text: 'Model' }),
          el('span', { className: 'ed-tree-name', text: asset.url, title: asset.url }),
        ]),
        el('label', { className: 'ed-checkbox-row' }, [
          (() => {
            const checkbox = el('input', {
              attrs: { type: 'checkbox' },
              on: {
                change: (event) =>
                  store.setAsset(entity.id, {
                    ...asset,
                    castShadow: (event.target as HTMLInputElement).checked,
                  }),
              },
            });
            checkbox.checked = asset.castShadow ?? true;
            return checkbox;
          })(),
          el('span', { text: 'Cast shadows' }),
        ]),
        el('button', {
          className: 'ed-btn',
          text: 'Remove model',
          on: { click: () => store.setAsset(entity.id, null) },
        }),
      );
      return section;
    }

    if (entity.primitive) {
      const primitive = entity.primitive;
      const sizeInputs = (['x', 'y', 'z'] as const).map((axis) =>
        numberInput(primitive.size[axis], (next) => {
          store.setPrimitive(entity.id, {
            ...primitive,
            size: { ...primitive.size, [axis]: Math.max(0.01, next) },
          });
        }),
      );
      const colorInput = el('input', {
        className: 'ed-input',
        attrs: { type: 'color', value: primitive.color ?? '#4c5663' },
        on: {
          change: (event) =>
            store.setPrimitive(entity.id, {
              ...primitive,
              color: (event.target as HTMLInputElement).value,
            }),
        },
      });
      section.append(
        el('div', { className: 'ed-field-row' }, [
          el('span', { className: 'ed-field-label', text: 'Box size' }),
          ...sizeInputs,
        ]),
        el('div', { className: 'ed-field-row-wide' }, [
          el('span', { className: 'ed-field-label', text: 'Color' }),
          colorInput,
        ]),
        el('button', {
          className: 'ed-btn',
          text: 'Remove box',
          on: { click: () => store.setPrimitive(entity.id, null) },
        }),
      );
      return section;
    }

    section.append(
      el('button', {
        className: 'ed-btn',
        text: 'Add box primitive',
        on: {
          click: () =>
            store.setPrimitive(entity.id, {
              shape: 'box',
              size: { x: 2, y: 2, z: 2 },
              color: '#4c5663',
            }),
        },
      }),
    );
    return section;
  }

  function componentFields(
    component: PrefabComponent,
    update: (next: PrefabComponent) => void,
  ): HTMLElement[] {
    switch (component.type) {
      case 'station-frame':
        return [];
      case 'spawn-point':
        return [
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Floor' }),
            selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
              update({ ...component, floorId: floorId as StationFloorId }),
            ),
          ]),
        ];
      case 'elevator':
        return [
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Pair id' }),
            textInput(component.id, (id) => update({ ...component, id })),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'To floor' }),
            selectInput(FLOOR_OPTIONS, component.targetFloor, (targetFloor) =>
              update({ ...component, targetFloor: targetFloor as StationFloorId }),
            ),
          ]),
        ];
      case 'hangar-pad':
        return [
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Hangar' }),
            textInput(component.hangarId, (hangarId) => update({ ...component, hangarId })),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Pad #' }),
            numberInput(component.padIndex, (padIndex) =>
              update({ ...component, padIndex: Math.max(1, Math.round(padIndex)) }),
            1),
          ]),
        ];
      case 'interaction':
        return [
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Id' }),
            textInput(component.id, (id) => update({ ...component, id })),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Prompt' }),
            textInput(component.prompt, (prompt) => update({ ...component, prompt })),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Radius' }),
            numberInput(component.radius, (radius) =>
              update({ ...component, radius: Math.max(0.5, radius) }),
            ),
          ]),
        ];
      case 'walk-volume': {
        const openSet = new Set(component.open ?? []);
        return [
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Floor' }),
            selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
              update({ ...component, floorId: floorId as StationFloorId }),
            ),
          ]),
          el('div', { className: 'ed-field-row' }, [
            el('span', { className: 'ed-field-label', text: 'Min XZ' }),
            numberInput(component.min.x, (x) => update({ ...component, min: { ...component.min, x } })),
            numberInput(component.min.z, (z) => update({ ...component, min: { ...component.min, z } })),
            el('span', {}),
          ]),
          el('div', { className: 'ed-field-row' }, [
            el('span', { className: 'ed-field-label', text: 'Max XZ' }),
            numberInput(component.max.x, (x) => update({ ...component, max: { ...component.max, x } })),
            numberInput(component.max.z, (z) => update({ ...component, max: { ...component.max, z } })),
            el('span', {}),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Height' }),
            numberInput(component.height ?? 4, (height) =>
              update({ ...component, height: Math.max(1, height) }),
            ),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Open' }),
            el(
              'div',
              {},
              SIDE_OPTIONS.map((side) =>
                el('label', { className: 'ed-checkbox-row' }, [
                  (() => {
                    const checkbox = el('input', {
                      attrs: { type: 'checkbox' },
                      on: {
                        change: (event) => {
                          const checked = (event.target as HTMLInputElement).checked;
                          if (checked) openSet.add(side);
                          else openSet.delete(side);
                          const open = [...openSet];
                          update({ ...component, ...(open.length > 0 ? { open } : { open: undefined }) });
                        },
                      },
                    });
                    checkbox.checked = openSet.has(side);
                    return checkbox;
                  })(),
                  el('span', { text: side }),
                ]),
              ),
            ),
          ]),
        ];
      }
      case 'collider':
        return [
          el('div', { className: 'ed-field-row' }, [
            el('span', { className: 'ed-field-label', text: 'Size' }),
            ...(['x', 'y', 'z'] as const).map((axis) =>
              numberInput(component.size[axis], (next) =>
                update({ ...component, size: { ...component.size, [axis]: Math.max(0.01, next) } }),
              ),
            ),
          ]),
          el('div', { className: 'ed-field-row' }, [
            el('span', { className: 'ed-field-label', text: 'Offset' }),
            ...(['x', 'y', 'z'] as const).map((axis) =>
              numberInput(component.offset?.[axis] ?? 0, (next) =>
                update({
                  ...component,
                  offset: { x: 0, y: 0, z: 0, ...component.offset, [axis]: next },
                }),
              ),
            ),
          ]),
        ];
    }
  }

  function componentsSection(entity: EditorEntity): HTMLElement {
    const section = el('div', { className: 'ed-section' }, [
      el('h3', { className: 'ed-section-title', text: 'Components' }),
    ]);

    entity.components.forEach((component, index) => {
      const update = (next: PrefabComponent): void => {
        const components = structuredClone(entity.components);
        components[index] = next;
        store.setComponents(entity.id, components);
      };
      const bodyEl = el('div', { className: 'ed-component-body' }, componentFields(component, update));
      const hint = COMPONENT_HINTS[component.type];
      if (hint) bodyEl.append(el('div', { className: 'ed-empty-note', text: hint }));
      section.append(
        el('div', { className: 'ed-component' }, [
          el('div', { className: 'ed-component-head' }, [
            el('span', { text: component.type }),
            el('button', {
              className: 'ed-remove-btn',
              text: '✕',
              title: 'Remove component',
              on: {
                click: () => {
                  const components = structuredClone(entity.components);
                  components.splice(index, 1);
                  store.setComponents(entity.id, components);
                },
              },
            }),
          ]),
          bodyEl,
        ]),
      );
    });

    const typeSelect = selectInput(Object.keys(COMPONENT_DEFAULTS), 'walk-volume', () => {});
    section.append(
      el('div', { className: 'ed-add-component' }, [
        typeSelect,
        el('button', {
          className: 'ed-btn',
          text: '+ Add',
          on: {
            click: () => {
              const type = typeSelect.value as PrefabComponentType;
              const components = structuredClone(entity.components);
              components.push(COMPONENT_DEFAULTS[type]());
              store.setComponents(entity.id, components);
            },
          },
        }),
      ]),
    );
    return section;
  }

  function render(): void {
    clearChildren(body);
    transformInputs = null;
    const entity = store.getSelectedEntity();
    if (!entity) {
      body.append(
        el('div', {
          className: 'ed-empty-note',
          text: 'Nothing selected. Click an object in the scene or the hierarchy.',
        }),
      );
      return;
    }

    body.append(
      el('div', { className: 'ed-section' }, [
        el('div', { className: 'ed-field-row-wide' }, [
          el('span', { className: 'ed-field-label', text: 'Name' }),
          textInput(entity.name, (name) => store.renameEntity(entity.id, name.trim() || entity.name)),
        ]),
      ]),
      transformSection(entity),
      visualSection(entity),
      componentsSection(entity),
    );
  }

  function refreshTransformInputs(entityId: string): void {
    const entity = store.getSelectedEntity();
    if (!entity || entity.id !== entityId || !transformInputs) return;
    const groups: (keyof TransformInputs['fields'])[] = ['position', 'rotation', 'scale'];
    for (const key of groups) {
      const source = entity[key];
      const inputs = transformInputs.fields[key];
      (['x', 'y', 'z'] as const).forEach((axis, index) => {
        const input = inputs[index];
        if (document.activeElement === input) return;
        input.value = String(Math.round(source[axis] * 1000) / 1000);
      });
    }
  }

  store.subscribe((event) => {
    if (event.type === 'selection' || event.type === 'document' || event.type === 'structure') {
      render();
      return;
    }
    if (event.type === 'entity' && event.entityId === store.getSelection()) {
      render();
      return;
    }
    if (event.type === 'transform') {
      refreshTransformInputs(event.entityId);
    }
  });
  render();
}
