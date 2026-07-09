import { clearChildren, el } from "../dom";
import { ASSET_DND_TYPE } from "../api";
import {
  type EditorEntity,
  type EditorStore,
  type EntityTransform,
} from "../document";
import type { Vec3 } from "../../types";
import {
  addColliderToEntities,
  addComponentFromPalette,
  collectExistingComponentTypes,
  shouldHideShipHullCollider,
} from "../component_actions";
import {
  getComponentDef,
  searchComponents,
  type ComponentDef,
} from "../../world/prefabs/component_registry";
import type { PrefabComponent, ShipZoneGate } from "../../world/prefabs/schema";
import { SHIP_SEAT_ROLES } from "../../world/prefabs/schema";
import type { StationFloorId } from "../../world/station";
import {
  collectMaterialRowsForEntity,
  formatMaterialNumber,
  type MaterialRow,
} from "./material_manager";

const FLOOR_OPTIONS: StationFloorId[] = ["hab", "lobby", "hangar"];

export interface InspectorPanelOptions {
  getGlbNodeLocalTransform?: (
    entityId: string,
    nodeUuid: string,
  ) => EntityTransform | null;
  setGlbNodeLocalTransform?: (
    entityId: string,
    nodeUuid: string,
    transform: Partial<EntityTransform>,
  ) => void;
  getGlbNodeBounds?: (
    entityId: string,
    nodeUuid: string,
  ) => { min: Vec3; max: Vec3 } | null;
}

export function createInspectorPanel(
  container: HTMLElement,
  store: EditorStore,
  options: InspectorPanelOptions = {},
): void {
  const body = el("div", { className: "ed-panel-body" });
  container.append(
    el("div", { className: "ed-panel-title" }, [
      el("span", { text: "Inspector" }),
    ]),
    body,
  );

  function numberInput(
    value: number,
    onCommit: (next: number) => void,
    step = 0.1,
  ): HTMLInputElement {
    return el("input", {
      className: "ed-input",
      attrs: {
        type: "number",
        step: String(step),
        value: String(Math.round(value * 1000) / 1000),
      },
      on: {
        change: (event) => {
          const next = Number((event.target as HTMLInputElement).value);
          if (Number.isFinite(next)) onCommit(next);
        },
        keydown: (event) => event.stopPropagation(),
      },
    });
  }

  function textInput(
    value: string,
    onCommit: (next: string) => void,
  ): HTMLInputElement {
    return el("input", {
      className: "ed-input",
      attrs: { type: "text", value },
      on: {
        change: (event) => onCommit((event.target as HTMLInputElement).value),
        keydown: (event) => event.stopPropagation(),
      },
    });
  }

  function assetUrlField(
    label: string,
    value: string | undefined,
    onCommit: (next: string | undefined) => void,
  ): HTMLElement {
    const input = textInput(value ?? "", (next) => onCommit(next.trim() || undefined));
    input.addEventListener("dragover", (event) => event.preventDefault());
    input.addEventListener("drop", (event) => {
      event.preventDefault();
      const url =
        event.dataTransfer?.getData(ASSET_DND_TYPE) ||
        event.dataTransfer?.getData("text/plain");
      if (url?.startsWith("/")) onCommit(url);
    });
    const controls = el("div", { className: "ed-field-controls" }, [
      input,
      el("button", {
        className: "ed-btn",
        text: "Clear",
        title: "Remove assigned asset",
        on: {
          click: () => onCommit(undefined),
        },
      }),
    ]);
    return el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: label }),
      controls,
    ]);
  }

  function colorInput(
    value: string,
    onCommit: (next: string) => void,
  ): HTMLInputElement {
    return el("input", {
      className: "ed-input",
      attrs: { type: "color", value },
      on: {
        change: (event) => onCommit((event.target as HTMLInputElement).value),
      },
    });
  }

  function selectInput(
    options: readonly string[],
    value: string,
    onCommit: (next: string) => void,
  ): HTMLSelectElement {
    const select = el("select", {
      className: "ed-select",
      on: {
        change: (event) => onCommit((event.target as HTMLSelectElement).value),
      },
    });
    for (const option of options) {
      const optionEl = el("option", { text: option, attrs: { value: option } });
      if (option === value) optionEl.selected = true;
      select.append(optionEl);
    }
    return select;
  }

  interface TransformInputs {
    fields: Record<"position" | "rotation" | "scale", HTMLInputElement[]>;
  }
  let transformInputs: TransformInputs | null = null;
  let glbTransformInputs: TransformInputs | null = null;
  let glbTransformTarget: { entityId: string; nodeUuid: string } | null = null;
  let materialSectionGeneration = 0;

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
    const section = el("div", { className: "ed-section" }, [
      el("h3", { className: "ed-section-title", text: "Transform" }),
    ]);
    const fields: TransformInputs["fields"] = {
      position: [],
      rotation: [],
      scale: [],
    };
    const rows: [keyof TransformInputs["fields"], string, number][] = [
      ["position", "Position", 0.25],
      ["rotation", "Rotation°", 5],
      ["scale", "Scale", 0.1],
    ];
    for (const [key, label, step] of rows) {
      const source = entity[key];
      const inputs = (["x", "y", "z"] as const).map((axis) =>
        numberInput(source[axis], () => commitTransform(entity), step),
      );
      fields[key] = inputs;
      section.append(
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: label }),
          ...inputs,
        ]),
      );
    }
    transformInputs = { fields };
    return section;
  }

  function commitGlbTransform(): void {
    if (!glbTransformInputs || !glbTransformTarget || !options.setGlbNodeLocalTransform) {
      return;
    }
    const read = (inputs: HTMLInputElement[]) => ({
      x: Number(inputs[0].value) || 0,
      y: Number(inputs[1].value) || 0,
      z: Number(inputs[2].value) || 0,
    });
    options.setGlbNodeLocalTransform(glbTransformTarget.entityId, glbTransformTarget.nodeUuid, {
      position: read(glbTransformInputs.fields.position),
      rotation: read(glbTransformInputs.fields.rotation),
      scale: read(glbTransformInputs.fields.scale),
    });
  }

  function glbNodeTransformSection(
    entityId: string,
    nodeUuid: string,
    transform: EntityTransform,
  ): HTMLElement | null {
    if (!options.getGlbNodeLocalTransform || !options.setGlbNodeLocalTransform) {
      return null;
    }
    const section = el("div", { className: "ed-section" }, [
      el("h3", { className: "ed-section-title", text: "Mesh Transform" }),
      el("div", {
        className: "ed-empty-note",
        text: "Local pose on the selected GLB part. Saved as a prefab node override.",
      }),
    ]);
    const fields: TransformInputs["fields"] = {
      position: [],
      rotation: [],
      scale: [],
    };
    const rows: [keyof TransformInputs["fields"], string, number][] = [
      ["position", "Position", 0.01],
      ["rotation", "Rotation°", 1],
      ["scale", "Scale", 0.01],
    ];
    for (const [key, label, step] of rows) {
      const source = transform[key];
      const inputs = (["x", "y", "z"] as const).map((axis) =>
        numberInput(source[axis], () => commitGlbTransform(), step),
      );
      fields[key] = inputs;
      section.append(
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: label }),
          ...inputs,
        ]),
      );
    }
    glbTransformInputs = { fields };
    glbTransformTarget = { entityId, nodeUuid };
    return section;
  }

  function visualSection(entity: EditorEntity): HTMLElement {
    const section = el("div", { className: "ed-section" }, [
      el("h3", { className: "ed-section-title", text: "Visual" }),
    ]);

    if (entity.asset) {
      const asset = entity.asset;
      section.append(
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Model" }),
          el("span", {
            className: "ed-tree-name",
            text: asset.url,
            title: asset.url,
          }),
        ]),
        el("label", { className: "ed-checkbox-row" }, [
          (() => {
            const checkbox = el("input", {
              attrs: { type: "checkbox" },
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
          el("span", { text: "Cast shadows" }),
        ]),
        el("button", {
          className: "ed-btn",
          text: "Remove model",
          on: { click: () => store.setAsset(entity.id, null) },
        }),
      );
      const sub = store.getSubSelection();
      if (sub?.entityId === entity.id) {
        const nodeName =
          store.getGlbNodeName(entity.id, sub.nodeUuid) ?? sub.nodeUuid;
        section.append(
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "GLB node" }),
            el("span", {
              className: "ed-tree-name",
              text: nodeName,
              title: nodeName,
            }),
          ]),
        );
      }
      return section;
    }

    if (entity.primitive) {
      const primitive = entity.primitive;
      const sizeInputs = (["x", "y", "z"] as const).map((axis) =>
        numberInput(primitive.size[axis], (next) => {
          store.setPrimitive(entity.id, {
            ...primitive,
            size: { ...primitive.size, [axis]: Math.max(0.01, next) },
          });
        }),
      );
      const colorInput = el("input", {
        className: "ed-input",
        attrs: { type: "color", value: primitive.color ?? "#4c5663" },
        on: {
          change: (event) =>
            store.setPrimitive(entity.id, {
              ...primitive,
              color: (event.target as HTMLInputElement).value,
            }),
        },
      });
      section.append(
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: "Box size" }),
          ...sizeInputs,
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Color" }),
          colorInput,
        ]),
        el("button", {
          className: "ed-btn",
          text: "Remove box",
          on: { click: () => store.setPrimitive(entity.id, null) },
        }),
      );
      return section;
    }

    section.append(
      el("button", {
        className: "ed-btn",
        text: "Add box primitive",
        on: {
          click: () =>
            store.setPrimitive(entity.id, {
              shape: "box",
              size: { x: 2, y: 2, z: 2 },
              color: "#4c5663",
            }),
        },
      }),
    );
    return section;
  }

  function materialSummaryRow(row: MaterialRow): HTMLElement {
    const swatch = el("span", {
      className: "ed-inspector-material-swatch",
      title: row.values.color,
    });
    swatch.style.background = row.values.color;
    const values = [
      `M ${formatMaterialNumber(row.values.metalness)}`,
      `R ${formatMaterialNumber(row.values.roughness)}`,
      `A ${formatMaterialNumber(row.values.opacity)}`,
    ];
    if (row.values.emissiveIntensity > 0) {
      values.push(`E ${formatMaterialNumber(row.values.emissiveIntensity)}`);
    }
    return el("div", { className: "ed-inspector-material-row" }, [
      swatch,
      el("div", { className: "ed-inspector-material-copy" }, [
        el("span", {
          className: "ed-inspector-material-name",
          text: row.displayName,
          title: row.displayName,
        }),
        el("span", {
          className: "ed-inspector-material-meta",
          text: `${row.source}${row.overridden ? " · override" : ""}`,
        }),
      ]),
      el("span", {
        className: "ed-inspector-material-values",
        text: values.join(" · "),
      }),
    ]);
  }

  function materialsSection(entity: EditorEntity): HTMLElement {
    const sub = store.getSubSelection();
    const selectedNodeName =
      sub?.entityId === entity.id
        ? store.getGlbNodeName(entity.id, sub.nodeUuid)
        : null;
    const section = el("div", { className: "ed-section" }, [
      el("h3", { className: "ed-section-title", text: "Materials" }),
    ]);
    const list = el("div", { className: "ed-inspector-material-list" }, [
      el("div", { className: "ed-empty-note", text: "Loading materials…" }),
    ]);
    section.append(list);

    const generation = ++materialSectionGeneration;
    void collectMaterialRowsForEntity(entity, { nodeName: selectedNodeName })
      .then((rows) => {
        if (
          generation !== materialSectionGeneration ||
          store.getSelection() !== entity.id
        ) {
          return;
        }
        clearChildren(list);
        if (rows.length === 0) {
          list.append(
            el("div", { className: "ed-empty-note", text: "No visual material" }),
          );
          return;
        }
        for (const row of rows) list.append(materialSummaryRow(row));
      })
      .catch(() => {
        if (
          generation !== materialSectionGeneration ||
          store.getSelection() !== entity.id
        ) {
          return;
        }
        clearChildren(list);
        list.append(
          el("div", { className: "ed-empty-note", text: "Materials unavailable" }),
        );
      });
    return section;
  }

  function componentFields(
    component: PrefabComponent,
    update: (next: PrefabComponent) => void,
    fieldOptions?: { hideColliderNodeField?: boolean },
  ): HTMLElement[] {
    switch (component.type) {
      case "station-frame":
      case "prop-frame":
      case "item-frame":
        return [];
      case "spawn-point":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Floor" }),
            selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
              update({ ...component, floorId: floorId as StationFloorId }),
            ),
          ]),
        ];
      case "elevator":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Pair id" }),
            textInput(component.id, (id) => update({ ...component, id })),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "On floor" }),
            selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
              update({ ...component, floorId: floorId as StationFloorId }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "To floor" }),
            selectInput(FLOOR_OPTIONS, component.targetFloor, (targetFloor) =>
              update({
                ...component,
                targetFloor: targetFloor as StationFloorId,
              }),
            ),
          ]),
        ];
      case "hangar-pad":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Hangar" }),
            textInput(component.hangarId, (hangarId) =>
              update({ ...component, hangarId }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Pad #" }),
            numberInput(
              component.padIndex,
              (padIndex) =>
                update({
                  ...component,
                  padIndex: Math.max(1, Math.round(padIndex)),
                }),
              1,
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Floor" }),
            selectInput(
              FLOOR_OPTIONS,
              component.floorId ?? "hangar",
              (floorId) =>
                update({ ...component, floorId: floorId as StationFloorId }),
            ),
          ]),
        ];
      case "interaction": {
        const animIds = (() => {
          const ids: string[] = [];
          const visit = (entities: EditorEntity[]) => {
            for (const entity of entities) {
              for (const comp of entity.components) {
                if (comp.type === "animation" && comp.id) {
                  ids.push(comp.id);
                }
              }
              visit(entity.children);
            }
          };
          visit(store.getState().roots);
          return ids;
        })();

        const rows = [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Id" }),
            textInput(component.id, (id) => update({ ...component, id })),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Floor" }),
            selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
              update({ ...component, floorId: floorId as StationFloorId }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Type" }),
            selectInput(["info", "animation"], component.interactionType ?? "info", (val) =>
              update({ ...component, interactionType: val as "info" | "animation" }),
            ),
          ]),
        ];

        if (component.interactionType === "animation") {
          rows.push(
            el("div", { className: "ed-field-row-wide" }, [
              el("span", { className: "ed-field-label", text: "Target Anim" }),
              selectInput(["", ...animIds], component.targetAnimationId ?? "", (val) =>
                update({ ...component, targetAnimationId: val || undefined }),
              ),
            ])
          );
        }

        rows.push(
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Prompt" }),
            textInput(component.prompt, (prompt) =>
              update({ ...component, prompt }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Key Bind" }),
            textInput(component.keyLabel ?? "F", (keyLabel) =>
              update({ ...component, keyLabel: keyLabel.slice(0, 10) }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Radius" }),
            numberInput(component.radius, (radius) =>
              update({ ...component, radius: Math.max(0.5, radius) }),
            ),
          ]),
          assetUrlField("Proximity SFX", component.proximitySoundUrl, (proximitySoundUrl) =>
            update({ ...component, proximitySoundUrl }),
          ),
          assetUrlField("Interact SFX", component.interactSoundUrl, (interactSoundUrl) =>
            update({ ...component, interactSoundUrl }),
          ),
        );
        return rows;
      }
      case "animation": {
        const rows: HTMLElement[] = [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Id" }),
            textInput(component.id, (id) => update({ ...component, id })),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Name" }),
            textInput(component.name, (name) => update({ ...component, name })),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Motion" }),
            selectInput(["slide", "hinge"], component.motion, (motion) =>
              update({ ...component, motion: motion as "slide" | "hinge" }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Axis" }),
            selectInput(["x", "y", "z"], component.axis, (axis) =>
              update({ ...component, axis: axis as "x" | "y" | "z" }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Duration" }),
            numberInput(component.duration ?? 1.0, (duration) =>
              update({ ...component, duration: Math.max(0.01, duration) }),
            ),
          ]),
          el("label", { className: "ed-checkbox-row" }, [
            (() => {
              const checkbox = el("input", {
                attrs: { type: "checkbox" },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      defaultOpen:
                        (event.target as HTMLInputElement).checked || undefined,
                    }),
                },
              });
              checkbox.checked = component.defaultOpen ?? false;
              return checkbox;
            })(),
            el("span", { text: "Open on spawn" }),
          ]),
        ];

        component.nodes.forEach((node, nodeIndex) => {
          rows.push(
            el("div", { className: "ed-field-row-wide" }, [
              el("span", {
                className: "ed-field-label",
                text: `Node ${nodeIndex + 1}`,
              }),
              el("div", { className: "ed-door-node-row" }, [
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
                el("button", {
                  className: "ed-remove-btn",
                  text: "✕",
                  title: "Remove node",
                  on: {
                    click: () => {
                      if (component.nodes.length <= 1) return;
                      const nodes = component.nodes.filter(
                        (_, index) => index !== nodeIndex,
                      );
                      update({ ...component, nodes });
                    },
                  },
                }),
              ]),
            ]),
          );
        });

        rows.push(
          el("button", {
            className: "ed-btn",
            text: "+ Node",
            title: "Add another GLB node moved by this animation",
            on: {
              click: () =>
                update({
                  ...component,
                  nodes: [...component.nodes, { name: "", delta: 0 }],
                }),
            },
          }),
        );
        return rows;
      }
      case "avms-terminal":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Id" }),
            textInput(component.id, (id) => update({ ...component, id })),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Floor" }),
            selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
              update({ ...component, floorId: floorId as StationFloorId }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Radius" }),
            numberInput(component.radius, (radius) =>
              update({ ...component, radius: Math.max(0.5, radius) }),
            ),
          ]),
        ];
      case "point-light":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Color" }),
            colorInput(component.color ?? "#dfeaff", (color) =>
              update({ ...component, color }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Intensity" }),
            numberInput(component.intensity, (intensity) =>
              update({
                ...component,
                intensity: Math.min(5_000, Math.max(0, intensity)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Range" }),
            numberInput(component.distance, (distance) =>
              update({
                ...component,
                distance: Math.min(500, Math.max(0, distance)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Decay" }),
            numberInput(component.decay ?? 2, (decay) =>
              update({
                ...component,
                decay: Math.min(4, Math.max(0, decay)),
              }),
            ),
          ]),
          el("label", { className: "ed-checkbox-row" }, [
            (() => {
              const checkbox = el("input", {
                attrs: { type: "checkbox" },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      castShadow:
                        (event.target as HTMLInputElement).checked || undefined,
                    }),
                },
              });
              checkbox.checked = component.castShadow ?? false;
              return checkbox;
            })(),
            el("span", { text: "Cast shadows" }),
          ]),
        ];
      case "area-light":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Color" }),
            colorInput(component.color ?? "#cfe8ff", (color) =>
              update({ ...component, color }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Intensity" }),
            numberInput(component.intensity, (intensity) =>
              update({
                ...component,
                intensity: Math.min(500, Math.max(0, intensity)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Size" }),
            numberInput(component.width, (width) =>
              update({
                ...component,
                width: Math.min(100, Math.max(0.05, width)),
              }),
            ),
            numberInput(component.height, (height) =>
              update({
                ...component,
                height: Math.min(100, Math.max(0.05, height)),
              }),
            ),
            el("span", {}),
          ]),
        ];
      case "spot-light":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Color" }),
            colorInput(component.color ?? "#dfeaff", (color) =>
              update({ ...component, color }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Intensity" }),
            numberInput(component.intensity, (intensity) =>
              update({
                ...component,
                intensity: Math.min(5_000, Math.max(0, intensity)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Range" }),
            numberInput(component.distance, (distance) =>
              update({
                ...component,
                distance: Math.min(500, Math.max(0, distance)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Decay" }),
            numberInput(component.decay ?? 2, (decay) =>
              update({
                ...component,
                decay: Math.min(4, Math.max(0, decay)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Angle" }),
            numberInput(component.angle ?? 45, (angle) =>
              update({
                ...component,
                angle: Math.min(90, Math.max(0, angle)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Penumbra" }),
            numberInput(component.penumbra ?? 0, (penumbra) =>
              update({
                ...component,
                penumbra: Math.min(1, Math.max(0, penumbra)),
              }),
            ),
          ]),
          el("label", { className: "ed-checkbox-row" }, [
            (() => {
              const checkbox = el("input", {
                attrs: { type: "checkbox" },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      castShadow:
                        (event.target as HTMLInputElement).checked || undefined,
                    }),
                },
              });
              checkbox.checked = component.castShadow ?? false;
              return checkbox;
            })(),
            el("span", { text: "Cast shadows" }),
          ]),
        ];
      case "collider":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Shape" }),
            selectInput(["box", "mesh"], component.shape, (shape) => {
              if (shape === "mesh") {
                update({
                  type: "collider",
                  shape: "mesh",
                  offset: component.offset,
                  node: component.node,
                });
                return;
              }
              update({
                type: "collider",
                shape: "box",
                size:
                  component.shape === "box"
                    ? component.size
                    : { x: 1, y: 1, z: 1 },
                offset: component.offset,
                node: component.node,
              });
            }),
          ]),
          ...(component.shape === "box"
            ? [
                el("div", { className: "ed-field-row" }, [
                  el("span", { className: "ed-field-label", text: "Size" }),
                  ...(["x", "y", "z"] as const).map((axis) =>
                    numberInput(component.size[axis], (next) =>
                      update({
                        ...component,
                        size: {
                          ...component.size,
                          [axis]: Math.max(0.01, next),
                        },
                      }),
                    ),
                  ),
                ]),
              ]
            : [
                el("div", { className: "ed-field-row-wide" }, [
                  el("span", { className: "ed-field-label", text: "Asset" }),
                  textInput(component.assetUrl ?? "", (assetUrl) =>
                    update({
                      ...component,
                      assetUrl: assetUrl.trim() || undefined,
                    }),
                  ),
                ]),
                el("label", { className: "ed-checkbox-row" }, [
                  (() => {
                    const checkbox = el("input", {
                      attrs: { type: "checkbox" },
                      on: {
                        change: (event) =>
                          update({
                            ...component,
                            convex:
                              (event.target as HTMLInputElement).checked ||
                              undefined,
                          }),
                      },
                    });
                    checkbox.checked = component.convex ?? false;
                    return checkbox;
                  })(),
                  el("span", { text: "Convex hull" }),
                ]),
              ]),
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Offset" }),
            ...(["x", "y", "z"] as const).map((axis) =>
              numberInput(component.offset?.[axis] ?? 0, (next) =>
                update({
                  ...component,
                  offset: {
                    x: 0,
                    y: 0,
                    z: 0,
                    ...component.offset,
                    [axis]: next,
                  },
                }),
              ),
            ),
          ]),
          ...(fieldOptions?.hideColliderNodeField
            ? []
            : [
                el("div", { className: "ed-field-row-wide" }, [
                  el("span", { className: "ed-field-label", text: "Node" }),
                  textInput(component.node ?? "", (node) =>
                    update({ ...component, node: node.trim() || undefined }),
                  ),
                ]),
              ]),
        ];
      case "ship-frame":
        return [];
      case "ship-controller": {
        const entityIds = (() => {
          const ids: string[] = [];
          const visit = (entities: EditorEntity[]) => {
            for (const entity of entities) {
              ids.push(entity.id);
              visit(entity.children);
            }
          };
          visit(store.getState().roots);
          return ids;
        })();
        const entityPicker = (
          value: string | undefined,
          onPick: (next: string | undefined) => void,
        ) =>
          selectInput(["", ...entityIds], value ?? "", (val) =>
            onPick(val || undefined),
          );
        const stats = component.stats ?? {};
        const gear = component.gear ?? { nodes: [] };
        const ramp = component.ramp ?? {
          hinge: { node: "RampParent", lowerRadians: -0.85 },
        };
        const rows: HTMLElement[] = [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Rest ht" }),
            numberInput(component.restHeight ?? 0, (next) =>
              update({
                ...component,
                restHeight:
                  next <= 0 ? undefined : Math.min(50, Math.max(0.2, next)),
              }),
            ),
          ]),
          el("div", { className: "ed-section-label", text: "Stats" }),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Max spd" }),
            numberInput(stats.maxSpeedMps ?? 100, (maxSpeedMps) =>
              update({
                ...component,
                stats: { ...stats, maxSpeedMps: Math.min(500, Math.max(5, maxSpeedMps)) },
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Max HP" }),
            numberInput(stats.maxHp ?? 1000, (maxHp) =>
              update({
                ...component,
                stats: { ...stats, maxHp: Math.min(100_000, Math.max(1, maxHp)) },
              }),
            ),
          ]),
          el("div", { className: "ed-section-label", text: "Ramp" }),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Hinge" }),
            textInput(ramp.hinge?.node ?? "RampParent", (node) =>
              update({
                ...component,
                ramp: {
                  ...ramp,
                  hinge: { ...ramp.hinge, node, lowerRadians: ramp.hinge?.lowerRadians ?? -0.85 },
                },
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Lower °" }),
            numberInput(ramp.hinge?.lowerRadians ?? -0.85, (lowerRadians) =>
              update({
                ...component,
                ramp: {
                  ...ramp,
                  hinge: {
                    node: ramp.hinge?.node ?? "RampParent",
                    lowerRadians: Math.min(10, Math.max(-10, lowerRadians)),
                    axis: ramp.hinge?.axis,
                  },
                },
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Out btn" }),
            entityPicker(ramp.outsideInteractId, (outsideInteractId) =>
              update({ ...component, ramp: { ...ramp, outsideInteractId } }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Deck btn" }),
            entityPicker(ramp.deckInteractId, (deckInteractId) =>
              update({ ...component, ramp: { ...ramp, deckInteractId } }),
            ),
          ]),
          el("div", {
            className: "ed-empty-note",
            text: `${gear.nodes.length} gear hinge(s), ${(component.doors ?? []).length} door(s), ${(component.seats ?? []).length} seat(s). Edit arrays in prefab JSON for now.`,
          }),
        ];
        return rows;
      }
      case "ship-stats":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Max spd" }),
            numberInput(component.maxSpeedMps ?? 100, (next) =>
              update({
                ...component,
                maxSpeedMps: Math.min(500, Math.max(5, next)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Max HP" }),
            numberInput(component.maxHp ?? 1000, (next) =>
              update({
                ...component,
                maxHp: Math.min(100_000, Math.max(1, next)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Shields" }),
            numberInput(component.maxShields ?? 500, (next) =>
              update({
                ...component,
                maxShields: Math.min(100_000, Math.max(0, next)),
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Regen/s" }),
            numberInput(component.shieldRegenPerSec ?? 25, (next) =>
              update({
                ...component,
                shieldRegenPerSec: Math.min(10_000, Math.max(0, next)),
              }),
            ),
          ]),
        ];
      case "ship-gear":
        return [
          el("div", {
            className: "ed-empty-note",
            text: `${component.nodes.length} gear hinge(s). Edit nodes in the prefab JSON for now.`,
          }),
        ];
      case "ship-ramp":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Node" }),
            textInput(component.node, (node) => update({ ...component, node })),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Lower °" }),
            numberInput(component.lowerRadians, (lowerRadians) =>
              update({
                ...component,
                lowerRadians: Math.min(10, Math.max(-10, lowerRadians)),
              }),
            ),
          ]),
        ];
      case "ship-hull":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Rest ht" }),
            numberInput(component.restHeight ?? 0, (next) =>
              update({
                ...component,
                restHeight:
                  next <= 0 ? undefined : Math.min(50, Math.max(0.2, next)),
              }),
            ),
          ]),
          el("div", {
            className: "ed-empty-note",
            text: "Ship origin height above ground when parked (m). 0 = auto: previews rest the hull on the pad.",
          }),
        ];
      case "ship-walk-zone": {
        const gateValue =
          component.gate === undefined
            ? "none"
            : component.gate === "ramp"
              ? "ramp"
              : "door";
        const rows: HTMLElement[] = [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Zone id" }),
            textInput(component.zoneId, (zoneId) =>
              update({ ...component, zoneId }),
            ),
          ]),
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Min XZ" }),
            numberInput(component.min.x, (x) =>
              update({ ...component, min: { ...component.min, x } }),
            ),
            numberInput(component.min.z, (z) =>
              update({ ...component, min: { ...component.min, z } }),
            ),
            el("span", {}),
          ]),
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Max XZ" }),
            numberInput(component.max.x, (x) =>
              update({ ...component, max: { ...component.max, x } }),
            ),
            numberInput(component.max.z, (z) =>
              update({ ...component, max: { ...component.max, z } }),
            ),
            el("span", {}),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Height" }),
            numberInput(component.height ?? 3.1, (height) =>
              update({ ...component, height: Math.max(0.5, height) }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Slope Δ" }),
            numberInput(component.slopeMinUp ?? 0, (slope) =>
              update({
                ...component,
                slopeMinUp: slope === 0 ? undefined : slope,
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Gate" }),
            selectInput(["none", "ramp", "door"], gateValue, (next) => {
              const gate: ShipZoneGate | undefined =
                next === "none"
                  ? undefined
                  : next === "ramp"
                    ? "ramp"
                    : { doorId: "door-1" };
              update({ ...component, gate });
            }),
          ]),
        ];
        if (typeof component.gate === "object") {
          rows.push(
            el("div", { className: "ed-field-row-wide" }, [
              el("span", { className: "ed-field-label", text: "Door id" }),
              textInput(component.gate.doorId, (doorId) =>
                update({ ...component, gate: { doorId } }),
              ),
            ]),
          );
        }
        rows.push(
          el("label", { className: "ed-checkbox-row" }, [
            (() => {
              const checkbox = el("input", {
                attrs: { type: "checkbox" },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      passage:
                        (event.target as HTMLInputElement).checked || undefined,
                    }),
                },
              });
              checkbox.checked = component.passage ?? false;
              return checkbox;
            })(),
            el("span", { text: "Passage (connects rooms)" }),
          ]),
        );
        return rows;
      }
      case "ship-stairs": {
        const isLadder = component.variant === "ladder";
        const gateValue =
          component.gate === undefined
            ? "none"
            : component.gate === "ramp"
              ? "ramp"
              : "door";
        const rows: HTMLElement[] = [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Variant" }),
            selectInput(
              ["stairs", "ladder"],
              component.variant ?? "stairs",
              (next) => {
                if (next === "ladder") {
                  const { stepCount, ...rest } = component;
                  void stepCount;
                  update({ ...rest, variant: "ladder" });
                } else {
                  update({
                    ...component,
                    variant: undefined,
                    stepCount: component.stepCount ?? 4,
                  });
                }
              },
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Zone id" }),
            textInput(component.zoneId, (zoneId) =>
              update({ ...component, zoneId }),
            ),
          ]),
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Min XZ" }),
            numberInput(component.min.x, (x) =>
              update({ ...component, min: { ...component.min, x } }),
            ),
            numberInput(component.min.z, (z) =>
              update({ ...component, min: { ...component.min, z } }),
            ),
            el("span", {}),
          ]),
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Max XZ" }),
            numberInput(component.max.x, (x) =>
              update({ ...component, max: { ...component.max, x } }),
            ),
            numberInput(component.max.z, (z) =>
              update({ ...component, max: { ...component.max, z } }),
            ),
            el("span", {}),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Rise" }),
            numberInput(component.riseUp, (riseUp) =>
              update({ ...component, riseUp: Math.max(0.05, riseUp) }),
            ),
          ]),
        ];
        if (!isLadder) {
          rows.push(
            el("div", { className: "ed-field-row-wide" }, [
              el("span", { className: "ed-field-label", text: "Steps" }),
              numberInput(component.stepCount ?? 4, (stepCount) =>
                update({
                  ...component,
                  stepCount: Math.max(1, Math.floor(stepCount)),
                }),
              ),
            ]),
          );
        }
        rows.push(
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Height" }),
            numberInput(component.height ?? 3.1, (height) =>
              update({ ...component, height: Math.max(0.5, height) }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Gate" }),
            selectInput(["none", "ramp", "door"], gateValue, (next) => {
              const gate: ShipZoneGate | undefined =
                next === "none"
                  ? undefined
                  : next === "ramp"
                    ? "ramp"
                    : { doorId: "door-1" };
              update({ ...component, gate });
            }),
          ]),
        );
        if (typeof component.gate === "object") {
          rows.push(
            el("div", { className: "ed-field-row-wide" }, [
              el("span", { className: "ed-field-label", text: "Door id" }),
              textInput(component.gate.doorId, (doorId) =>
                update({ ...component, gate: { doorId } }),
              ),
            ]),
          );
        }
        rows.push(
          el("label", { className: "ed-checkbox-row" }, [
            (() => {
              const checkbox = el("input", {
                attrs: { type: "checkbox" },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      passage:
                        (event.target as HTMLInputElement).checked || undefined,
                    }),
                },
              });
              checkbox.checked = component.passage ?? false;
              return checkbox;
            })(),
            el("span", { text: "Passage (connects rooms)" }),
          ]),
        );
        return rows;
      }
      case "ship-door": {
        const rows: HTMLElement[] = [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Id" }),
            textInput(component.id, (id) => update({ ...component, id })),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Label" }),
            textInput(component.label, (label) =>
              update({ ...component, label }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Motion" }),
            selectInput(["slide", "hinge"], component.motion, (motion) =>
              update({ ...component, motion: motion as "slide" | "hinge" }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Axis" }),
            selectInput(["x", "y", "z"], component.axis, (axis) =>
              update({ ...component, axis: axis as "x" | "y" | "z" }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Radius" }),
            numberInput(component.radius ?? 1.6, (radius) =>
              update({ ...component, radius: Math.max(0.5, radius) }),
            ),
          ]),
          el("label", { className: "ed-checkbox-row" }, [
            (() => {
              const checkbox = el("input", {
                attrs: { type: "checkbox" },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      defaultOpen:
                        (event.target as HTMLInputElement).checked || undefined,
                    }),
                },
              });
              checkbox.checked = component.defaultOpen ?? false;
              return checkbox;
            })(),
            el("span", { text: "Open on spawn" }),
          ]),
        ];
        component.nodes.forEach((node, nodeIndex) => {
          rows.push(
            el("div", { className: "ed-field-row-wide" }, [
              el("span", {
                className: "ed-field-label",
                text: `Node ${nodeIndex + 1}`,
              }),
              el("div", { className: "ed-door-node-row" }, [
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
                el("button", {
                  className: "ed-remove-btn",
                  text: "✕",
                  title: "Remove node",
                  on: {
                    click: () => {
                      if (component.nodes.length <= 1) return;
                      const nodes = component.nodes.filter(
                        (_, index) => index !== nodeIndex,
                      );
                      update({ ...component, nodes });
                    },
                  },
                }),
              ]),
            ]),
          );
        });
        rows.push(
          el("button", {
            className: "ed-btn",
            text: "+ Node",
            title: "Add another GLB node moved by this door",
            on: {
              click: () =>
                update({
                  ...component,
                  nodes: [...component.nodes, { name: "Door_R", delta: 1 }],
                }),
            },
          }),
        );
        return rows;
      }
      case "pilot-seat": {
        const eye = component.eye ?? { x: 0, y: 0.87, z: 0.25 };
        const stand = component.stand ?? { x: 0, z: -1.55 };
        const role = component.role ?? "passenger";
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Role" }),
            selectInput([...SHIP_SEAT_ROLES], role, (next) =>
              update({
                ...component,
                role: next as (typeof SHIP_SEAT_ROLES)[number],
              }),
            ),
          ]),
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Eye" }),
            ...(["x", "y", "z"] as const).map((axis) =>
              numberInput(eye[axis], (next) =>
                update({ ...component, eye: { ...eye, [axis]: next } }),
              ),
            ),
          ]),
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Stand XZ" }),
            numberInput(stand.x, (x) =>
              update({ ...component, stand: { ...stand, x } }),
            ),
            numberInput(stand.z, (z) =>
              update({ ...component, stand: { ...stand, z } }),
            ),
            el("span", {}),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Radius" }),
            numberInput(component.interactRadius ?? 1.45, (radius) =>
              update({ ...component, interactRadius: Math.max(0.5, radius) }),
            ),
          ]),
        ];
      }
      case "ramp-interact":
        return [
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Place" }),
            selectInput(["outside", "deck"], component.placement, (placement) =>
              update({
                ...component,
                placement: placement as "outside" | "deck",
              }),
            ),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Radius" }),
            numberInput(
              component.radius ?? (component.placement === "outside" ? 3 : 1.7),
              (radius) =>
                update({ ...component, radius: Math.max(0.5, radius) }),
            ),
          ]),
        ];
      case "ramp-mount":
        return [
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Min XZ" }),
            numberInput(component.min.x, (x) =>
              update({ ...component, min: { ...component.min, x } }),
            ),
            numberInput(component.min.z, (z) =>
              update({ ...component, min: { ...component.min, z } }),
            ),
            el("span", {}),
          ]),
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Max XZ" }),
            numberInput(component.max.x, (x) =>
              update({ ...component, max: { ...component.max, x } }),
            ),
            numberInput(component.max.z, (z) =>
              update({ ...component, max: { ...component.max, z } }),
            ),
            el("span", {}),
          ]),
        ];
    }
  }

  function addComponentCombobox(entity: EditorEntity): HTMLElement {
    const wrap = el("div", { className: "ed-combobox" });
    const input = el("input", {
      className: "ed-input",
      attrs: {
        type: "text",
        placeholder: "Add component…",
        autocomplete: "off",
      },
    });
    // preventDefault keeps the input focused for ANY press inside the list
    // (items, padding, empty note) so blur cannot close it mid-click.
    const list = el("div", {
      className: "ed-combobox-list",
      on: { mousedown: (event) => event.preventDefault() },
    });
    wrap.append(input, list);

    let results: ComponentDef[] = [];
    let highlighted = 0;
    let open = false;

    /** Singletons are unique per document, not per entity. */
    function existingTypes() {
      return collectExistingComponentTypes(store);
    }

    function addComponent(def: ComponentDef): void {
      const sub = store.getSubSelection();
      const nodeBounds =
        sub && sub.entityId === entity.id && options.getGlbNodeBounds
          ? () => options.getGlbNodeBounds!(entity.id, sub.nodeUuid)
          : undefined;
      addComponentFromPalette(store, entity.id, def, nodeBounds ? { getNodeBounds: nodeBounds } : undefined);
    }

    /** Moves the highlight without rebuilding the list (rebuilding under the
     * pointer re-fires mouseenter on the fresh node and eats clicks). */
    function refreshHighlight(): void {
      list.querySelectorAll(".ed-combobox-item").forEach((item, index) => {
        item.classList.toggle("is-highlighted", index === highlighted);
      });
    }

    function renderList(): void {
      clearChildren(list);
      if (!open) {
        list.classList.remove("is-open");
        return;
      }
      results = searchComponents(
        input.value,
        store.getState().kind,
        existingTypes(),
      );
      if (shouldHideShipHullCollider(store, entity)) {
        results = results.filter((def) => def.type !== "collider");
      }
      highlighted = Math.min(highlighted, Math.max(0, results.length - 1));
      if (results.length === 0) {
        list.append(
          el("div", {
            className: "ed-combobox-empty",
            text: "No matching components",
          }),
        );
      }
      results.forEach((def, index) => {
        const item = el(
          "div",
          {
            className: `ed-combobox-item${index === highlighted ? " is-highlighted" : ""}`,
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
            el("span", {
              className: "ed-combobox-item-label",
              text: def.label,
            }),
            el("span", { className: "ed-combobox-item-type", text: def.type }),
          ],
        );
        list.append(item);
      });
      list.classList.toggle("is-open", true);
    }

    function setOpen(next: boolean): void {
      open = next;
      if (open) highlighted = 0;
      renderList();
    }

    input.addEventListener("focus", () => setOpen(true));
    input.addEventListener("blur", () => setOpen(false));
    input.addEventListener("input", () => {
      highlighted = 0;
      renderList();
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!open) setOpen(true);
        else if (results.length > 0) {
          highlighted = (highlighted + 1) % results.length;
          refreshHighlight();
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (results.length > 0) {
          highlighted = (highlighted - 1 + results.length) % results.length;
          refreshHighlight();
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        const def = results[highlighted];
        if (open && def) addComponent(def);
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.blur();
      }
    });

    return wrap;
  }

  function componentsSection(entity: EditorEntity): HTMLElement {
    const section = el("div", { className: "ed-section" }, [
      el("h3", { className: "ed-section-title", text: "Components" }),
    ]);

    const sub = store.getSubSelection();
    const subNodeName =
      sub && sub.entityId === entity.id
        ? store.getGlbNodeName(entity.id, sub.nodeUuid)
        : null;

    const isNodeContext = Boolean(subNodeName && entity.asset);
    const components = isNodeContext
      ? store.getNodeOverrideComponents(entity.id, subNodeName!)
      : entity.components;

    if (
      !isNodeContext &&
      shouldHideShipHullCollider(store, entity)
    ) {
      section.append(
        el("div", {
          className: "ed-empty-note",
          text: "Select a GLB node (RampParent, interior floors, doors…) to add walk colliders.",
        }),
      );
    }

    const setComponents = (next: PrefabComponent[]): void => {
      if (isNodeContext) {
        store.setNodeOverrideComponents(entity.id, subNodeName!, next);
      } else {
        store.setComponents(entity.id, next);
      }
    };

    components.forEach((component, index) => {
      const update = (next: PrefabComponent): void => {
        const list = structuredClone(components);
        list[index] = next;
        setComponents(list);
      };
      const bodyEl = el(
        "div",
        { className: "ed-component-body" },
        componentFields(component, update, {
          hideColliderNodeField: isNodeContext && component.type === "collider",
        }),
      );
      const hint =
        component.type === "ship-stairs" && component.variant === "ladder"
          ? "Vertical climb volume. Entity Y is the bottom; Press F at the foot/head to go up or down."
          : getComponentDef(component.type)?.hint;
      if (hint)
        bodyEl.append(el("div", { className: "ed-empty-note", text: hint }));
      const componentLabel =
        component.type === "ship-stairs" && component.variant === "ladder"
          ? "ship-stairs (ladder)"
          : component.type;
      section.append(
        el("div", { className: "ed-component" }, [
          el("div", { className: "ed-component-head" }, [
            el("span", { text: componentLabel }),
            el("button", {
              className: "ed-remove-btn",
              text: "✕",
              title: "Remove component",
              on: {
                click: () => {
                  const list = structuredClone(components);
                  list.splice(index, 1);
                  setComponents(list);
                },
              },
            }),
          ]),
          bodyEl,
        ]),
      );
    });

    section.append(
      el("div", { className: "ed-add-component" }, [
        addComponentCombobox(entity),
      ]),
    );
    return section;
  }

  function render(): void {
    clearChildren(body);
    transformInputs = null;
    glbTransformInputs = null;
    glbTransformTarget = null;

    const selectedIds = store.getSelectedIds();
    if (selectedIds.length > 1) {
      materialSectionGeneration += 1;
      body.append(
        el("div", { className: "ed-section" }, [
          el("div", {
            className: "ed-empty-note",
            text: `${selectedIds.length} entities selected`,
          }),
          el("div", { className: "ed-bulk-actions" }, [
            el("button", {
              className: "ed-btn",
              text: "Add Collider to All",
              on: {
                click: () => addColliderToEntities(store, selectedIds),
              },
            }),
            el("button", {
              className: "ed-btn",
              text: "Group in Empty",
              on: {
                click: () => store.groupSelectedInEmpty(),
              },
            }),
          ]),
        ]),
      );
      return;
    }

    const entity = store.getSelectedEntity();
    if (!entity) {
      materialSectionGeneration += 1;
      body.append(
        el("div", {
          className: "ed-empty-note",
          text: "Nothing selected. Click an object in the scene or the hierarchy.",
        }),
      );
      return;
    }

    const sub = store.getSubSelection();
    const subNodeName = sub && sub.entityId === entity.id ? store.getGlbNodeName(entity.id, sub.nodeUuid) : null;

    const sections: HTMLElement[] = [
      el("div", { className: "ed-section" }, [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Name" }),
          subNodeName
            ? el("span", { className: "ed-field-value-static", text: subNodeName })
            : textInput(entity.name, (name) =>
                store.renameEntity(entity.id, name.trim() || entity.name),
              ),
        ]),
      ]),
      transformSection(entity),
    ];
    if (
      sub?.entityId === entity.id &&
      options.getGlbNodeLocalTransform
    ) {
      const meshTransform = options.getGlbNodeLocalTransform(
        sub.entityId,
        sub.nodeUuid,
      );
      if (meshTransform) {
        const meshSection = glbNodeTransformSection(
          sub.entityId,
          sub.nodeUuid,
          meshTransform,
        );
        if (meshSection) sections.push(meshSection);
      }
    }

    sections.push(visualSection(entity), materialsSection(entity), componentsSection(entity));
    body.append(...sections);
  }

  function refreshGlbTransformInputs(entityId: string, nodeUuid: string): void {
    if (
      !glbTransformInputs ||
      !glbTransformTarget ||
      glbTransformTarget.entityId !== entityId ||
      glbTransformTarget.nodeUuid !== nodeUuid ||
      !options.getGlbNodeLocalTransform
    ) {
      return;
    }
    const transform = options.getGlbNodeLocalTransform(entityId, nodeUuid);
    if (!transform) return;
    const groups: (keyof TransformInputs["fields"])[] = [
      "position",
      "rotation",
      "scale",
    ];
    for (const key of groups) {
      const source = transform[key];
      const inputs = glbTransformInputs.fields[key];
      (["x", "y", "z"] as const).forEach((axis, index) => {
        const input = inputs[index];
        if (document.activeElement === input) return;
        input.value = String(Math.round(source[axis] * 1000) / 1000);
      });
    }
  }

  function refreshTransformInputs(entityId: string): void {
    const entity = store.getSelectedEntity();
    if (!entity || entity.id !== entityId || !transformInputs) return;
    const groups: (keyof TransformInputs["fields"])[] = [
      "position",
      "rotation",
      "scale",
    ];
    for (const key of groups) {
      const source = entity[key];
      const inputs = transformInputs.fields[key];
      (["x", "y", "z"] as const).forEach((axis, index) => {
        const input = inputs[index];
        if (document.activeElement === input) return;
        input.value = String(Math.round(source[axis] * 1000) / 1000);
      });
    }
  }

  store.subscribe((event) => {
    if (
      event.type === "selection" ||
      event.type === "sub-selection" ||
      event.type === "document" ||
      event.type === "structure"
    ) {
      render();
      return;
    }
    if (event.type === "entity" && event.entityId === store.getSelection()) {
      render();
      return;
    }
    if (event.type === "transform") {
      refreshTransformInputs(event.entityId);
      return;
    }
    if (event.type === "glb-transform") {
      refreshGlbTransformInputs(event.entityId, event.nodeUuid);
    }
  });
  render();
}
