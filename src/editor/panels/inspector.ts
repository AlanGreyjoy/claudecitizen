import { clearChildren, el, showToast } from '../dom';
import { createEmptyEntity, type EditorEntity, type EditorStore } from '../document';
import {
  getComponentDef,
  searchComponents,
  type ComponentDef,
} from '../../world/prefabs/component_registry';
import type { PrefabComponent, ShipZoneGate } from '../../world/prefabs/schema';
import type { StationFloorId, StationSide } from '../../world/station';

const FLOOR_OPTIONS: StationFloorId[] = ['hab', 'lobby', 'hangar'];
const SIDE_OPTIONS: StationSide[] = ['minRight', 'maxRight', 'minForward', 'maxForward'];

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
      case 'ship-frame':
        return [];
      case 'ship-hull':
        return [
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Rest ht' }),
            numberInput(component.restHeight ?? 0, (next) =>
              update({
                ...component,
                restHeight: next <= 0 ? undefined : Math.min(50, Math.max(0.2, next)),
              }),
            ),
          ]),
          el('div', {
            className: 'ed-empty-note',
            text: 'Ship origin height above ground when parked (m). 0 = auto: previews rest the hull on the pad.',
          }),
        ];
      case 'ship-walk-zone': {
        const gateValue =
          component.gate === undefined ? 'none' : component.gate === 'ramp' ? 'ramp' : 'door';
        const rows: HTMLElement[] = [
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Zone id' }),
            textInput(component.zoneId, (zoneId) => update({ ...component, zoneId })),
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
            numberInput(component.height ?? 3.1, (height) =>
              update({ ...component, height: Math.max(0.5, height) }),
            ),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Slope Δ' }),
            numberInput(component.slopeMinUp ?? 0, (slope) =>
              update({ ...component, slopeMinUp: slope === 0 ? undefined : slope }),
            ),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Gate' }),
            selectInput(['none', 'ramp', 'door'], gateValue, (next) => {
              const gate: ShipZoneGate | undefined =
                next === 'none' ? undefined : next === 'ramp' ? 'ramp' : { doorId: 'door-1' };
              update({ ...component, gate });
            }),
          ]),
        ];
        if (typeof component.gate === 'object') {
          rows.push(
            el('div', { className: 'ed-field-row-wide' }, [
              el('span', { className: 'ed-field-label', text: 'Door id' }),
              textInput(component.gate.doorId, (doorId) =>
                update({ ...component, gate: { doorId } }),
              ),
            ]),
          );
        }
        rows.push(
          el('label', { className: 'ed-checkbox-row' }, [
            (() => {
              const checkbox = el('input', {
                attrs: { type: 'checkbox' },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      passage: (event.target as HTMLInputElement).checked || undefined,
                    }),
                },
              });
              checkbox.checked = component.passage ?? false;
              return checkbox;
            })(),
            el('span', { text: 'Passage (connects rooms)' }),
          ]),
        );
        return rows;
      }
      case 'ship-door': {
        const rows: HTMLElement[] = [
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Id' }),
            textInput(component.id, (id) => update({ ...component, id })),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Label' }),
            textInput(component.label, (label) => update({ ...component, label })),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Motion' }),
            selectInput(['slide', 'hinge'], component.motion, (motion) =>
              update({ ...component, motion: motion as 'slide' | 'hinge' }),
            ),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Axis' }),
            selectInput(['x', 'y', 'z'], component.axis, (axis) =>
              update({ ...component, axis: axis as 'x' | 'y' | 'z' }),
            ),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Radius' }),
            numberInput(component.radius ?? 1.6, (radius) =>
              update({ ...component, radius: Math.max(0.5, radius) }),
            ),
          ]),
          el('label', { className: 'ed-checkbox-row' }, [
            (() => {
              const checkbox = el('input', {
                attrs: { type: 'checkbox' },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      defaultOpen: (event.target as HTMLInputElement).checked || undefined,
                    }),
                },
              });
              checkbox.checked = component.defaultOpen ?? false;
              return checkbox;
            })(),
            el('span', { text: 'Open on spawn' }),
          ]),
        ];
        component.nodes.forEach((node, nodeIndex) => {
          rows.push(
            el('div', { className: 'ed-field-row-wide' }, [
              el('span', { className: 'ed-field-label', text: `Node ${nodeIndex + 1}` }),
              el('div', { className: 'ed-door-node-row' }, [
                textInput(node.name, (name) => {
                  const nodes = component.nodes.map((entry, index) =>
                    index === nodeIndex ? { ...entry, name } : entry,
                  );
                  update({ ...component, nodes });
                }),
                numberInput(node.delta, (delta) => {
                  const nodes = component.nodes.map((entry, index) =>
                    index === nodeIndex ? { ...entry, delta } : entry,
                  );
                  update({ ...component, nodes });
                }),
                el('button', {
                  className: 'ed-remove-btn',
                  text: '✕',
                  title: 'Remove node',
                  on: {
                    click: () => {
                      if (component.nodes.length <= 1) return;
                      const nodes = component.nodes.filter((_, index) => index !== nodeIndex);
                      update({ ...component, nodes });
                    },
                  },
                }),
              ]),
            ]),
          );
        });
        rows.push(
          el('button', {
            className: 'ed-btn',
            text: '+ Node',
            title: 'Add another GLB node moved by this door',
            on: {
              click: () =>
                update({
                  ...component,
                  nodes: [...component.nodes, { name: 'Door_R', delta: 1 }],
                }),
            },
          }),
        );
        return rows;
      }
      case 'pilot-seat': {
        const eye = component.eye ?? { x: 0, y: 0.87, z: 0.25 };
        const stand = component.stand ?? { x: 0, z: -1.55 };
        return [
          el('div', { className: 'ed-field-row' }, [
            el('span', { className: 'ed-field-label', text: 'Eye' }),
            ...(['x', 'y', 'z'] as const).map((axis) =>
              numberInput(eye[axis], (next) =>
                update({ ...component, eye: { ...eye, [axis]: next } }),
              ),
            ),
          ]),
          el('div', { className: 'ed-field-row' }, [
            el('span', { className: 'ed-field-label', text: 'Stand XZ' }),
            numberInput(stand.x, (x) => update({ ...component, stand: { ...stand, x } })),
            numberInput(stand.z, (z) => update({ ...component, stand: { ...stand, z } })),
            el('span', {}),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Radius' }),
            numberInput(component.interactRadius ?? 1.45, (radius) =>
              update({ ...component, interactRadius: Math.max(0.5, radius) }),
            ),
          ]),
        ];
      }
      case 'ramp-interact':
        return [
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Place' }),
            selectInput(['outside', 'deck'], component.placement, (placement) =>
              update({ ...component, placement: placement as 'outside' | 'deck' }),
            ),
          ]),
          el('div', { className: 'ed-field-row-wide' }, [
            el('span', { className: 'ed-field-label', text: 'Radius' }),
            numberInput(component.radius ?? (component.placement === 'outside' ? 3 : 1.7), (radius) =>
              update({ ...component, radius: Math.max(0.5, radius) }),
            ),
          ]),
        ];
      case 'ramp-mount':
        return [
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
        ];
    }
  }

  function addComponentCombobox(entity: EditorEntity): HTMLElement {
    const wrap = el('div', { className: 'ed-combobox' });
    const input = el('input', {
      className: 'ed-input',
      attrs: { type: 'text', placeholder: 'Add component…', autocomplete: 'off' },
    });
    // preventDefault keeps the input focused for ANY press inside the list
    // (items, padding, empty note) so blur cannot close it mid-click.
    const list = el('div', {
      className: 'ed-combobox-list',
      on: { mousedown: (event) => event.preventDefault() },
    });
    wrap.append(input, list);

    let results: ComponentDef[] = [];
    let highlighted = 0;
    let open = false;

    /** Singletons are unique per document, not per entity. */
    function existingTypes(): PrefabComponent['type'][] {
      const types: PrefabComponent['type'][] = [];
      const visit = (entities: EditorEntity[]): void => {
        for (const current of entities) {
          for (const component of current.components) types.push(component.type);
          visit(current.children);
        }
      };
      visit(store.getState().roots);
      return types;
    }

    function addComponent(def: ComponentDef): void {
      // Unity-style: spatial components live on their own empty marker
      // entities. Adding one to a model entity spawns a child marker (and
      // selects it) so the gizmo positions the component independently.
      const hasVisual = Boolean(entity.asset || entity.primitive);
      if (def.marker && hasVisual) {
        const marker = createEmptyEntity(def.label);
        marker.components = [def.createDefault()];
        store.addEntity(marker, entity.id);
        showToast(`Added "${def.label}" as a child marker — position it with the gizmo.`);
        return;
      }
      const components = structuredClone(entity.components);
      components.push(def.createDefault());
      store.setComponents(entity.id, components);
      // The store event re-renders the inspector, discarding this combobox.
    }

    /** Moves the highlight without rebuilding the list (rebuilding under the
     * pointer re-fires mouseenter on the fresh node and eats clicks). */
    function refreshHighlight(): void {
      list.querySelectorAll('.ed-combobox-item').forEach((item, index) => {
        item.classList.toggle('is-highlighted', index === highlighted);
      });
    }

    function renderList(): void {
      clearChildren(list);
      if (!open) {
        list.classList.remove('is-open');
        return;
      }
      results = searchComponents(input.value, store.getState().kind, existingTypes());
      highlighted = Math.min(highlighted, Math.max(0, results.length - 1));
      if (results.length === 0) {
        list.append(el('div', { className: 'ed-combobox-empty', text: 'No matching components' }));
      }
      results.forEach((def, index) => {
        const item = el(
          'div',
          {
            className: `ed-combobox-item${index === highlighted ? ' is-highlighted' : ''}`,
            on: {
              // mousedown (not click) so the add happens while the input still
              // has focus; the list's own mousedown handler prevents the blur.
              mousedown: () => addComponent(def),
              mouseenter: () => {
                highlighted = index;
                refreshHighlight();
              },
            },
          },
          [
            el('span', { className: 'ed-combobox-item-label', text: def.label }),
            el('span', { className: 'ed-combobox-item-type', text: def.type }),
          ],
        );
        list.append(item);
      });
      list.classList.toggle('is-open', true);
    }

    function setOpen(next: boolean): void {
      open = next;
      if (open) highlighted = 0;
      renderList();
    }

    input.addEventListener('focus', () => setOpen(true));
    input.addEventListener('blur', () => setOpen(false));
    input.addEventListener('input', () => {
      highlighted = 0;
      renderList();
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!open) setOpen(true);
        else if (results.length > 0) {
          highlighted = (highlighted + 1) % results.length;
          refreshHighlight();
        }
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (results.length > 0) {
          highlighted = (highlighted - 1 + results.length) % results.length;
          refreshHighlight();
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const def = results[highlighted];
        if (open && def) addComponent(def);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.blur();
      }
    });

    return wrap;
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
      const hint = getComponentDef(component.type)?.hint;
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

    section.append(el('div', { className: 'ed-add-component' }, [addComponentCombobox(entity)]));
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
