import { closeIcon, el } from "../dom";
import { ASSET_DND_TYPE, ENTITY_DND_TYPE } from "../api";
import type { EditorStore } from "../document";
import { fitBoxColliderToBounds } from "../component_actions";
import {
  COCKPIT_CONTROL_ACTIONS,
  COCKPIT_STAT_KINDS,
  SHIP_SEAT_ROLES,
  type PrefabComponent,
} from "../../world/prefabs/schema";
import type { StationFloorId } from "../../world/station";
import {
  FLOOR_OPTIONS,
  collectAnimationIds,
  findEntityById,
  isAudioAssetUrl,
  isImageAssetUrl,
  parseDraggedEntityIds,
  type ComponentFieldOptions,
  type InspectorPanelOptions,
} from "./inspector_logic";
import { buildParticleSystemFields } from "./particle_fields";

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

function typedAssetUrlField(
  label: string,
  value: string | undefined,
  onCommit: (next: string | undefined) => void,
  accepts: (url: string) => boolean,
): HTMLElement {
  const input = textInput(value ?? "", (next) => onCommit(next.trim() || undefined));
  input.addEventListener("dragover", (event) => event.preventDefault());
  input.addEventListener("drop", (event) => {
    event.preventDefault();
    const url =
      event.dataTransfer?.getData(ASSET_DND_TYPE) ||
      event.dataTransfer?.getData("text/plain");
    if (url?.startsWith("/") && accepts(url)) onCommit(url);
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

function assetUrlField(
  label: string,
  value: string | undefined,
  onCommit: (next: string | undefined) => void,
): HTMLElement {
  return typedAssetUrlField(label, value, onCommit, isAudioAssetUrl);
}

function imageAssetUrlField(
  label: string,
  value: string | undefined,
  onCommit: (next: string | undefined) => void,
): HTMLElement {
  return typedAssetUrlField(label, value, onCommit, isImageAssetUrl);
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

/** Imperative field builders for inspector component editors (mounted via ImperativeHost). */
export function buildInspectorComponentFields(
  store: EditorStore,
  component: PrefabComponent,
  update: (next: PrefabComponent) => void,
  options: InspectorPanelOptions,
  fieldOptions?: ComponentFieldOptions,
): HTMLElement[] {
  switch (component.type) {
    case "equipment-socket":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Socket id" }),
          textInput(component.id, (id) => update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Accepts" }),
          selectInput(["sword", "handgun", "rifle"], component.accepts, (accepts) =>
            update({
              ...component,
              accepts: accepts as "sword" | "handgun" | "rifle",
            }),
          ),
        ]),
      ];
    case "station-frame":
    case "prop-frame":
    case "item-frame":
    case "drawn-grip":
    case "muzzle-flash":
    case "barrel-end":
      return [];
    case "weapon-combat":
      return [
        assetUrlField("Fire SFX", component.fireSoundUrl ?? undefined, (fireSoundUrl) =>
          update({ ...component, fireSoundUrl: fireSoundUrl ?? null }),
        ),
        assetUrlField(
          "Dry-fire SFX",
          component.dryFireSoundUrl ?? undefined,
          (dryFireSoundUrl) =>
            update({ ...component, dryFireSoundUrl: dryFireSoundUrl ?? null }),
        ),
        assetUrlField(
          "Reload SFX",
          component.reloadSoundUrl ?? undefined,
          (reloadSoundUrl) =>
            update({ ...component, reloadSoundUrl: reloadSoundUrl ?? null }),
        ),
        imageAssetUrlField(
          "Hit decal",
          component.hitDecalUrl ?? undefined,
          (hitDecalUrl) =>
            update({ ...component, hitDecalUrl: hitDecalUrl ?? null }),
        ),
      ];
    case "spawn-point":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
      ];
    case "npc-spawner":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id: id.trim() })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Population" }),
          textInput(component.populationId, (populationId) =>
            update({ ...component, populationId: populationId.trim() }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Route group" }),
          textInput(component.routeGroup, (routeGroup) =>
            update({ ...component, routeGroup: routeGroup.trim() }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Min alive" }),
          numberInput(component.minAlive, (minAlive) => {
            const nextMin = Math.max(0, Math.min(32, Math.round(minAlive)));
            update({
              ...component,
              minAlive: nextMin,
              maxAlive: Math.max(nextMin, component.maxAlive),
            });
          }, 1),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max alive" }),
          numberInput(component.maxAlive, (maxAlive) =>
            update({
              ...component,
              maxAlive: Math.max(
                component.minAlive,
                Math.min(32, Math.round(maxAlive)),
              ),
            }), 1),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Radius" }),
          numberInput(component.radius, (radius) =>
            update({ ...component, radius: Math.max(0, Math.min(20, radius)) }),
          ),
        ]),
      ];
    case "npc-waypoint":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id: id.trim() })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Route group" }),
          textInput(component.routeGroup, (routeGroup) =>
            update({ ...component, routeGroup: routeGroup.trim() }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Links" }),
          textInput(component.links.join(", "), (raw) => {
            const links = raw
              .split(/[\s,]+/)
              .map((id) => id.trim())
              .filter((id, index, all) => id.length > 0 && all.indexOf(id) === index)
              .slice(0, 16);
            update({ ...component, links });
          }),
        ]),
        el("div", {
          className: "ed-hint",
          text: "Comma-separated waypoint ids. Connections are undirected.",
        }),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Wait min" }),
          numberInput(component.waitMinSeconds, (waitMinSeconds) => {
            const nextMin = Math.max(0, Math.min(120, waitMinSeconds));
            update({
              ...component,
              waitMinSeconds: nextMin,
              waitMaxSeconds: Math.max(nextMin, component.waitMaxSeconds),
            });
          }),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Wait max" }),
          numberInput(component.waitMaxSeconds, (waitMaxSeconds) =>
            update({
              ...component,
              waitMaxSeconds: Math.max(
                component.waitMinSeconds,
                Math.min(120, waitMaxSeconds),
              ),
            }),
          ),
        ]),
      ];
    case "npc-placement": {
      const rows = [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id: id.trim() })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Definition" }),
          textInput(component.npcDefinitionId, (npcDefinitionId) =>
            update({ ...component, npcDefinitionId: npcDefinitionId.trim() }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Display name" }),
          textInput(component.displayName ?? "", (displayName) =>
            update({ ...component, displayName: displayName.trim() || undefined }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Behavior" }),
          selectInput(["stationary", "wander", "patrol"], component.behavior, (behavior) =>
            update({
              ...component,
              behavior: behavior as "stationary" | "wander" | "patrol",
            }),
          ),
        ]),
      ];
      if (component.behavior !== "stationary") {
        rows.push(
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Route group" }),
            textInput(component.routeGroup ?? "", (routeGroup) =>
              update({ ...component, routeGroup: routeGroup.trim() || undefined }),
            ),
          ]),
        );
      }
      return rows;
    }
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
      const animIds = collectAnimationIds(store.getState().roots);

      const rows: HTMLElement[] = [
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
              }, [closeIcon()]),
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
    case "object-animation": {
      const nodes = component.nodes ?? [];
      const rows: HTMLElement[] = [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Mode" }),
          selectInput(["hover", "spin"], component.mode, (mode) =>
            update({
              ...component,
              mode: mode as "hover" | "spin",
              speed:
                mode === "spin"
                  ? (component.speed ?? 0.4)
                  : (component.speed ?? 0.5),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Axis" }),
          selectInput(["x", "y", "z"], component.axis, (axis) =>
            update({ ...component, axis: axis as "x" | "y" | "z" }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", {
            className: "ed-field-label",
            text: component.mode === "spin" ? "Speed (rad/s)" : "Speed (Hz)",
          }),
          numberInput(component.speed ?? (component.mode === "spin" ? 0.4 : 0.5), (speed) =>
            update({ ...component, speed: Math.max(0, speed) }),
          ),
        ]),
      ];
      if (component.mode === "spin") {
        rows.push(
          el("label", { className: "ed-checkbox-row" }, [
            (() => {
              const checkbox = el("input", {
                attrs: { type: "checkbox" },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      reverse:
                        (event.target as HTMLInputElement).checked ||
                        undefined,
                    }),
                },
              });
              checkbox.checked = component.reverse ?? false;
              return checkbox;
            })(),
            el("span", { text: "Reverse spin" }),
          ]),
        );
      }
      if (component.mode === "hover") {
        rows.push(
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Amplitude (m)" }),
            numberInput(component.amplitude ?? 0.08, (amplitude) =>
              update({ ...component, amplitude: Math.max(0, amplitude) }),
            ),
          ]),
        );
      }
      rows.push(
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Phase (rad)" }),
          numberInput(component.phase ?? 0, (phase) =>
            update({ ...component, phase }),
          ),
        ]),
      );

      if (nodes.length === 0) {
        rows.push(
          el("div", {
          className: "ed-hint",
            text: "No GLB nodes — animates this entity root.",
          }),
        );
      }

      nodes.forEach((node, nodeIndex) => {
        rows.push(
          el("div", { className: "ed-field-row-wide" }, [
            el("span", {
              className: "ed-field-label",
              text: `Node ${nodeIndex + 1}`,
            }),
            el("div", { className: "ed-door-node-row" }, [
              textInput(node.name, (name) => {
                const nextNodes = nodes.map((entry, index) =>
                  index === nodeIndex ? { ...entry, name } : entry,
                );
                update({ ...component, nodes: nextNodes });
              }),
              el("button", {
                className: "ed-remove-btn",
                title: "Remove node",
                on: {
                  click: () => {
                    const nextNodes = nodes.filter(
                      (_, index) => index !== nodeIndex,
                    );
                    update({ ...component, nodes: nextNodes });
                  },
                },
              }, [closeIcon()]),
            ]),
          ]),
        );
      });

      rows.push(
        el("button", {
          className: "ed-btn",
          text: "+ Node",
          title: "Animate a named GLB node (leave empty to animate entity root)",
          on: {
            click: () =>
              update({
                ...component,
                nodes: [...nodes, { name: "" }],
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
    case "sound": {
      const maxBlend =
        component.zone.shape === "sphere"
          ? component.zone.radius
          : Math.min(
              component.zone.size.x,
              component.zone.size.y,
              component.zone.size.z,
            ) / 2;
      const previewKey = `sound:${component.soundUrl ?? "unassigned"}:${component.mode}:${component.playback}`;
      const previewBtn = el("button", {
        className: "ed-btn",
        text: options.audioPreview.isPlaying(previewKey)
          ? "Stop preview"
          : "Preview sound",
        title: component.soundUrl
          ? "Preview assigned sound"
          : "Assign an audio asset first",
        on: {
          click: () => {
            if (!component.soundUrl) return;
            options.audioPreview.toggle(
              previewKey,
              component.soundUrl,
              {
                loop: component.playback === "loop",
                volume: component.volume,
              },
              (playing) => {
                previewBtn.textContent = playing
                  ? "Stop preview"
                  : "Preview sound";
              },
            );
          },
        },
      });
      previewBtn.disabled = !component.soundUrl;
      const rows: HTMLElement[] = [
        assetUrlField("Sound", component.soundUrl, (soundUrl) =>
          update({ ...component, soundUrl }),
        ),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Mode" }),
          selectInput(["ambient", "spatial"], component.mode, (mode) =>
            update({
              ...component,
              mode: mode as "ambient" | "spatial",
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Playback" }),
          selectInput(
            ["loop", "enter"],
            component.playback,
            (playback) =>
              update({
                ...component,
                playback: playback as "loop" | "enter",
              }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Volume" }),
          numberInput(component.volume, (volume) =>
            update({
              ...component,
              volume: Math.min(1, Math.max(0, volume)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Blend" }),
          numberInput(component.blendDistance, (blendDistance) =>
            update({
              ...component,
              blendDistance: Math.min(maxBlend, Math.max(0, blendDistance)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Zone" }),
          selectInput(["sphere", "box"], component.zone.shape, (shape) => {
            if (shape === component.zone.shape) return;
            update({
              ...component,
              blendDistance: Math.min(component.blendDistance, 2.5),
              zone:
                shape === "sphere"
                  ? { shape: "sphere", radius: 5 }
                  : { shape: "box", size: { x: 10, y: 5, z: 10 } },
            });
          }),
        ]),
      ];
      if (component.zone.shape === "sphere") {
        rows.push(
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Radius" }),
            numberInput(component.zone.radius, (radius) => {
              const nextRadius = Math.min(500, Math.max(0.05, radius));
              update({
                ...component,
                blendDistance: Math.min(
                  component.blendDistance,
                  nextRadius,
                ),
                zone: { shape: "sphere", radius: nextRadius },
              });
            }),
          ]),
        );
      } else {
        const boxZone = component.zone;
        rows.push(
          el("div", { className: "ed-field-row" }, [
            el("span", { className: "ed-field-label", text: "Size" }),
            ...(["x", "y", "z"] as const).map((axis) =>
              numberInput(boxZone.size[axis], (value) => {
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
                  zone: { shape: "box", size },
                });
              }),
            ),
          ]),
        );
      }
      rows.push(previewBtn);
      return rows;
    }
    case "particle-system":
      return buildParticleSystemFields(component, update, {
        entityId: fieldOptions?.entityId,
        preview: options.particlePreview,
      });
    case "collider":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Shape" }),
          selectInput(["box", "mesh"], component.shape, (shape) => {
            if (shape === "mesh") {
              update({
                type: "collider",
                shape: "mesh",
                node: component.node,
              });
              return;
            }
            const fitted = fieldOptions?.colliderNodeBounds
              ? fitBoxColliderToBounds(fieldOptions.colliderNodeBounds)
              : null;
            update({
              type: "collider",
              shape: "box",
              size: fitted?.size ?? { x: 1, y: 1, z: 1 },
              offset: fitted?.offset,
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
      const entityRefField = (
        value: string | undefined,
        onPick: (next: string | undefined) => void,
      ): HTMLElement => {
        const matched = value
          ? findEntityById(store.getState().roots, value)
          : null;
        const input = el("input", {
          className: "ed-input",
          attrs: {
            type: "text",
            readonly: "true",
            value: matched?.name ?? value ?? "",
            placeholder: "Drop from Hierarchy",
            title: value
              ? matched
                ? `${matched.name} (${value})`
                : `Missing entity: ${value}`
              : "Drag an entity from the Hierarchy onto this field",
          },
        });
        if (value && !matched) input.classList.add("is-missing-ref");
        input.addEventListener("dragover", (event) => {
          const dragEvent = event as DragEvent;
          if (!dragEvent.dataTransfer?.types.includes(ENTITY_DND_TYPE)) return;
          dragEvent.preventDefault();
          if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = "copy";
          input.classList.add("is-drop-target");
        });
        input.addEventListener("dragleave", () => {
          input.classList.remove("is-drop-target");
        });
        input.addEventListener("drop", (event) => {
          const dragEvent = event as DragEvent;
          dragEvent.preventDefault();
          input.classList.remove("is-drop-target");
          const ids = parseDraggedEntityIds(
            dragEvent.dataTransfer?.getData(ENTITY_DND_TYPE) ?? "",
          );
          const nextId = ids[0];
          if (!nextId) return;
          if (!findEntityById(store.getState().roots, nextId)) return;
          onPick(nextId);
        });
        return el("div", { className: "ed-field-controls" }, [
          input,
          el("button", {
            className: "ed-btn",
            text: "Clear",
            title: "Clear entity reference",
            on: {
              click: () => onPick(undefined),
            },
          }),
        ]);
      };
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
        el("div", {
          className: "ed-empty-note",
          text: "Ship origin height above the pad (m). Viewport: cyan pad = authored, amber dashed = auto from hull lowest point. 0 = auto.",
        }),
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
          el("span", { className: "ed-field-label", text: "Mass kg" }),
          numberInput(stats.massKg ?? 12_000, (massKg) =>
            update({
              ...component,
              stats: {
                ...stats,
                massKg: Math.min(50_000_000, Math.max(100, massKg)),
              },
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max rot" }),
          numberInput(stats.maxAngularRateRadps ?? 0.85, (maxAngularRateRadps) =>
            update({
              ...component,
              stats: {
                ...stats,
                maxAngularRateRadps: Math.min(10, Math.max(0.05, maxAngularRateRadps)),
              },
            }),
          ),
        ]),
        el("div", { className: "ed-section-label", text: "Thrust (N)" }),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Fwd" }),
          numberInput(stats.forwardThrustN ?? 3_696_000, (forwardThrustN) =>
            update({
              ...component,
              stats: {
                ...stats,
                forwardThrustN: Math.min(1e12, Math.max(1, forwardThrustN)),
              },
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Back" }),
          numberInput(stats.backwardThrustN ?? 2_217_600, (backwardThrustN) =>
            update({
              ...component,
              stats: {
                ...stats,
                backwardThrustN: Math.min(1e12, Math.max(1, backwardThrustN)),
              },
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Vert" }),
          numberInput(stats.verticalThrustN ?? 2_520_000, (verticalThrustN) =>
            update({
              ...component,
              stats: {
                ...stats,
                verticalThrustN: Math.min(1e12, Math.max(1, verticalThrustN)),
              },
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Lat" }),
          numberInput(stats.lateralThrustN ?? 2_016_000, (lateralThrustN) =>
            update({
              ...component,
              stats: {
                ...stats,
                lateralThrustN: Math.min(1e12, Math.max(1, lateralThrustN)),
              },
            }),
          ),
        ]),
        el("div", { className: "ed-section-label", text: "Torque (N·m)" }),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Pitch" }),
          numberInput(stats.pitchTorqueNm ?? 960_000, (pitchTorqueNm) =>
            update({
              ...component,
              stats: {
                ...stats,
                pitchTorqueNm: Math.min(1e12, Math.max(1, pitchTorqueNm)),
              },
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Yaw" }),
          numberInput(stats.yawTorqueNm ?? 1_104_000, (yawTorqueNm) =>
            update({
              ...component,
              stats: {
                ...stats,
                yawTorqueNm: Math.min(1e12, Math.max(1, yawTorqueNm)),
              },
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Roll" }),
          numberInput(stats.rollTorqueNm ?? 1_584_000, (rollTorqueNm) =>
            update({
              ...component,
              stats: {
                ...stats,
                rollTorqueNm: Math.min(1e12, Math.max(1, rollTorqueNm)),
              },
            }),
          ),
        ]),
        el("div", { className: "ed-section-label", text: "Camera feel" }),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "FOV fwd°" }),
          numberInput(stats.thrustFovForwardDeg ?? 5, (thrustFovForwardDeg) =>
            update({
              ...component,
              stats: {
                ...stats,
                thrustFovForwardDeg: Math.min(
                  30,
                  Math.max(0, thrustFovForwardDeg),
                ),
              },
            }),
            0.5,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "FOV back°" }),
          numberInput(
            stats.thrustFovBackwardDeg ?? 3.5,
            (thrustFovBackwardDeg) =>
              update({
                ...component,
                stats: {
                  ...stats,
                  thrustFovBackwardDeg: Math.min(
                    30,
                    Math.max(0, thrustFovBackwardDeg),
                  ),
                },
              }),
            0.5,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "FOV blend" }),
          numberInput(
            stats.thrustFovBlendPerSec ?? 8,
            (thrustFovBlendPerSec) =>
              update({
                ...component,
                stats: {
                  ...stats,
                  thrustFovBlendPerSec: Math.min(
                    40,
                    Math.max(0.5, thrustFovBlendPerSec),
                  ),
                },
              }),
            0.5,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Boost shake" }),
          numberInput(
            stats.boostShakeAmplitudeM ?? 0.015,
            (boostShakeAmplitudeM) =>
              update({
                ...component,
                stats: {
                  ...stats,
                  boostShakeAmplitudeM: Math.min(
                    0.2,
                    Math.max(0, boostShakeAmplitudeM),
                  ),
                },
              }),
            0.001,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Shake Hz" }),
          numberInput(stats.boostShakeHz ?? 20, (boostShakeHz) =>
            update({
              ...component,
              stats: {
                ...stats,
                boostShakeHz: Math.min(60, Math.max(1, boostShakeHz)),
              },
            }),
            1,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Boost fade" }),
          numberInput(stats.boostBlendPerSec ?? 4.5, (boostBlendPerSec) =>
            update({
              ...component,
              stats: {
                ...stats,
                boostBlendPerSec: Math.min(
                  40,
                  Math.max(0.5, boostBlendPerSec),
                ),
              },
            }),
            0.5,
          ),
        ]),
        assetUrlField("Boost SFX", stats.boostSoundUrl, (boostSoundUrl) =>
          update({
            ...component,
            stats: { ...stats, boostSoundUrl },
          }),
        ),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Boost vol" }),
          numberInput(stats.boostSoundVolume ?? 1, (boostSoundVolume) =>
            update({
              ...component,
              stats: {
                ...stats,
                boostSoundVolume: Math.min(1, Math.max(0, boostSoundVolume)),
              },
            }),
            0.05,
          ),
        ]),
        assetUrlField("Thrust SFX", stats.thrustSoundUrl, (thrustSoundUrl) =>
          update({
            ...component,
            stats: { ...stats, thrustSoundUrl },
          }),
        ),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Thrust vol" }),
          numberInput(stats.thrustSoundVolume ?? 1, (thrustSoundVolume) =>
            update({
              ...component,
              stats: {
                ...stats,
                thrustSoundVolume: Math.min(1, Math.max(0, thrustSoundVolume)),
              },
            }),
            0.05,
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
          entityRefField(ramp.outsideInteractId, (outsideInteractId) =>
            update({ ...component, ramp: { ...ramp, outsideInteractId } }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Deck btn" }),
          entityRefField(ramp.deckInteractId, (deckInteractId) =>
            update({ ...component, ramp: { ...ramp, deckInteractId } }),
          ),
        ]),
        assetUrlField("Open SFX", ramp.openSoundUrl, (openSoundUrl) =>
          update({ ...component, ramp: { ...ramp, openSoundUrl } }),
        ),
        assetUrlField("Close SFX", ramp.closeSoundUrl, (closeSoundUrl) =>
          update({ ...component, ramp: { ...ramp, closeSoundUrl } }),
        ),
        el("div", { className: "ed-section-label", text: "Landing gear" }),
        assetUrlField("Deploy SFX", gear.deploySoundUrl, (deploySoundUrl) =>
          update({
            ...component,
            gear: { ...gear, nodes: gear.nodes ?? [], deploySoundUrl },
          }),
        ),
        assetUrlField("Retract SFX", gear.retractSoundUrl, (retractSoundUrl) =>
          update({
            ...component,
            gear: { ...gear, nodes: gear.nodes ?? [], retractSoundUrl },
          }),
        ),
        el("div", {
          className: "ed-empty-note",
          text: `${gear.nodes.length} gear hinge(s), ${(component.seats ?? []).length} seat(s). Add doors/cubbies as Ship Door marker empties (Open/Close SFX in inspector). Legacy controller.doors[] still bakes if present.`,
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
          text: "Ship origin height above ground when parked (m). 0 = auto. Viewport shows a pad disc at −rest ht under the origin.",
        }),
      ];
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
          el("span", { className: "ed-field-label", text: "Trigger" }),
          selectInput(
            ["radial", "raycast"],
            component.trigger ?? "radial",
            (trigger) =>
              update({
                ...component,
                trigger: trigger as "radial" | "raycast",
              }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", {
            className: "ed-field-label",
            text:
              (component.trigger ?? "radial") === "raycast"
                ? "Max distance"
                : "Radius",
          }),
          numberInput(component.radius ?? 1.6, (radius) =>
            update({ ...component, radius: Math.max(0.5, radius) }),
          ),
        ]),
        ...((component.trigger ?? "radial") === "raycast"
          ? [
              el("div", { className: "ed-field-row-wide" }, [
                el("span", {
                  className: "ed-field-label",
                  text: "Aim radius",
                }),
                numberInput(component.aimRadius ?? 0.35, (aimRadius) =>
                  update({
                    ...component,
                    aimRadius: Math.max(0.05, aimRadius),
                  }),
                ),
              ]),
            ]
          : []),
        el("div", { className: "ed-field-row-wide ed-door-spawn-row" }, [
          el("label", { className: "ed-checkbox-row" }, [
            (() => {
              const checkbox = el("input", {
                attrs: { type: "checkbox" },
                on: {
                  change: (event) =>
                    update({
                      ...component,
                      defaultOpen:
                        (event.target as HTMLInputElement).checked ||
                        undefined,
                    }),
                },
              });
              checkbox.checked = component.defaultOpen ?? false;
              return checkbox;
            })(),
            el("span", { text: "Open on spawn" }),
          ]),
          el("button", {
            className: "ed-btn",
            text: "Animate",
            title: "Preview this door open / closed in the viewport",
            on: {
              click: () => options.onToggleShipDoorPreview?.(component.id),
            },
          }),
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
              }, [closeIcon()]),
            ]),
          ]),
          el("div", { className: "ed-field-row-wide" }, [
            el("span", {
              className: "ed-field-label",
              text: "Under",
            }),
            textInput(node.under ?? "", (under) => {
              const nodes = component.nodes.map((entry, index) =>
                index === nodeIndex
                  ? {
                      ...entry,
                      under: under.trim() ? under.trim() : undefined,
                    }
                  : entry,
              );
              update({ ...component, nodes });
            }),
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
      rows.push(
        assetUrlField("Open SFX", component.openSoundUrl, (openSoundUrl) =>
          update({ ...component, openSoundUrl }),
        ),
        assetUrlField("Close SFX", component.closeSoundUrl, (closeSoundUrl) =>
          update({ ...component, closeSoundUrl }),
        ),
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
    case "bed": {
      const eye = component.eye ?? { x: 0, y: 0.3, z: 0.15 };
      const stand = component.stand ?? { x: -0.9, z: 0 };
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "bed", (label) =>
            update({ ...component, label }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Trigger" }),
          selectInput(
            ["radial", "raycast"],
            component.trigger ?? "radial",
            (trigger) =>
              update({
                ...component,
                trigger: trigger as "radial" | "raycast",
              }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", {
            className: "ed-field-label",
            text:
              (component.trigger ?? "radial") === "raycast"
                ? "Max distance"
                : "Radius",
          }),
          numberInput(component.radius ?? 1.6, (radius) =>
            update({ ...component, radius: Math.max(0.5, radius) }),
          ),
        ]),
        ...((component.trigger ?? "radial") === "raycast"
          ? [
              el("div", { className: "ed-field-row-wide" }, [
                el("span", {
                  className: "ed-field-label",
                  text: "Aim radius",
                }),
                numberInput(component.aimRadius ?? 0.35, (aimRadius) =>
                  update({
                    ...component,
                    aimRadius: Math.max(0.05, aimRadius),
                  }),
                ),
              ]),
            ]
          : []),
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
    case "cockpit-control":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Action" }),
          selectInput(
            [...COCKPIT_CONTROL_ACTIONS],
            component.action,
            (action) =>
              update({
                ...component,
                action: action as (typeof COCKPIT_CONTROL_ACTIONS)[number],
              }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "", (label) =>
            update({
              ...component,
              label: label.trim() ? label.trim() : undefined,
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Gaze radius" }),
          numberInput(
            component.gazeRadius ?? 0.2,
            (gazeRadius) =>
              update({
                ...component,
                gazeRadius: Math.max(0.05, Math.min(2, gazeRadius)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max distance" }),
          numberInput(
            component.maxDistance ?? 2.5,
            (maxDistance) =>
              update({
                ...component,
                maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
              }),
            0.1,
          ),
        ]),
      ];
    case "entertainment-system":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "Turn on ES", (label) =>
            update({
              ...component,
              label: label.trim() ? label.trim() : undefined,
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Gaze radius" }),
          numberInput(
            component.gazeRadius ?? 0.35,
            (gazeRadius) =>
              update({
                ...component,
                gazeRadius: Math.max(0.05, Math.min(2, gazeRadius)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max distance" }),
          numberInput(
            component.maxDistance ?? 2,
            (maxDistance) =>
              update({
                ...component,
                maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
              }),
            0.1,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Screen width" }),
          numberInput(
            component.screenWidth ?? 0.55,
            (screenWidth) =>
              update({
                ...component,
                screenWidth: Math.max(0.2, Math.min(2, screenWidth)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Screen height" }),
          numberInput(
            component.screenHeight ?? 0.32,
            (screenHeight) =>
              update({
                ...component,
                screenHeight: Math.max(0.15, Math.min(1.5, screenHeight)),
              }),
            0.05,
          ),
        ]),
      ];
    case "weapon-shop":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "Browse weapons", (label) =>
            update({
              ...component,
              label: label.trim() ? label.trim() : undefined,
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Gaze radius" }),
          numberInput(
            component.gazeRadius ?? 0.4,
            (gazeRadius) =>
              update({
                ...component,
                gazeRadius: Math.max(0.05, Math.min(2, gazeRadius)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max distance" }),
          numberInput(
            component.maxDistance ?? 3,
            (maxDistance) =>
              update({
                ...component,
                maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
              }),
            0.1,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Screen width" }),
          numberInput(
            component.screenWidth ?? 0.45,
            (screenWidth) =>
              update({
                ...component,
                screenWidth: Math.max(0.2, Math.min(2, screenWidth)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Screen height" }),
          numberInput(
            component.screenHeight ?? 0.28,
            (screenHeight) =>
              update({
                ...component,
                screenHeight: Math.max(0.15, Math.min(1.5, screenHeight)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Item IDs" }),
          textInput(
            (component.itemDefinitionIds ?? []).join(", "),
            (raw) => {
              const ids = raw
                .split(/[,\s]+/)
                .map((id) => id.trim())
                .filter((id) => id.length > 0);
              update({
                ...component,
                itemDefinitionIds: ids.length > 0 ? ids : undefined,
              });
            },
          ),
        ]),
        el("div", {
          className: "ed-hint",
          text: "Optional comma-separated weapon definition IDs. Empty = all catalog weapons.",
        }),
      ];
    case "outfitters":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "Browse outfitters", (label) =>
            update({
              ...component,
              label: label.trim() ? label.trim() : undefined,
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Gaze radius" }),
          numberInput(
            component.gazeRadius ?? 0.4,
            (gazeRadius) =>
              update({
                ...component,
                gazeRadius: Math.max(0.05, Math.min(2, gazeRadius)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max distance" }),
          numberInput(
            component.maxDistance ?? 3,
            (maxDistance) =>
              update({
                ...component,
                maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
              }),
            0.1,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Screen width" }),
          numberInput(
            component.screenWidth ?? 0.45,
            (screenWidth) =>
              update({
                ...component,
                screenWidth: Math.max(0.2, Math.min(2, screenWidth)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Screen height" }),
          numberInput(
            component.screenHeight ?? 0.28,
            (screenHeight) =>
              update({
                ...component,
                screenHeight: Math.max(0.15, Math.min(1.5, screenHeight)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Item IDs" }),
          textInput(
            (component.itemDefinitionIds ?? []).join(", "),
            (raw) => {
              const ids = raw
                .split(/[,\s]+/)
                .map((id) => id.trim())
                .filter((id) => id.length > 0);
              update({
                ...component,
                itemDefinitionIds: ids.length > 0 ? ids : undefined,
              });
            },
          ),
        ]),
        el("div", {
          className: "ed-hint",
          text: "Optional comma-separated catalog IDs. Empty = all stocked outfitters items (Back = backpacks).",
        }),
      ];
    case "food-shop":
    case "drinks-shop":
    case "canteen": {
      const defaultLabel =
        component.type === "food-shop"
          ? "Browse food"
          : component.type === "drinks-shop"
            ? "Browse drinks"
            : "Browse food & drinks";
      const filterHint =
        component.type === "food-shop"
          ? "Optional comma-separated food item IDs. Empty = all food consumables."
          : component.type === "drinks-shop"
            ? "Optional comma-separated drink item IDs. Empty = all drink consumables."
            : "Optional comma-separated consumable IDs. Empty = all food and drinks.";
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? defaultLabel, (label) =>
            update({
              ...component,
              label: label.trim() ? label.trim() : undefined,
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Gaze radius" }),
          numberInput(
            component.gazeRadius ?? 0.4,
            (gazeRadius) =>
              update({
                ...component,
                gazeRadius: Math.max(0.05, Math.min(2, gazeRadius)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max distance" }),
          numberInput(
            component.maxDistance ?? 3,
            (maxDistance) =>
              update({
                ...component,
                maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
              }),
            0.1,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Screen width" }),
          numberInput(
            component.screenWidth ?? 0.45,
            (screenWidth) =>
              update({
                ...component,
                screenWidth: Math.max(0.2, Math.min(2, screenWidth)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Screen height" }),
          numberInput(
            component.screenHeight ?? 0.28,
            (screenHeight) =>
              update({
                ...component,
                screenHeight: Math.max(0.15, Math.min(1.5, screenHeight)),
              }),
            0.05,
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Item IDs" }),
          textInput(
            (component.itemDefinitionIds ?? []).join(", "),
            (raw) => {
              const ids = raw
                .split(/[,\s]+/)
                .map((id) => id.trim())
                .filter((id) => id.length > 0);
              update({
                ...component,
                itemDefinitionIds: ids.length > 0 ? ids : undefined,
              });
            },
          ),
        ]),
        el("div", {
          className: "ed-hint",
          text: filterHint,
        }),
      ];
    }
    case "cockpit-stat":
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Kind" }),
          selectInput(
            [...COCKPIT_STAT_KINDS],
            component.kind,
            (kind) =>
              update({
                ...component,
                kind: kind as (typeof COCKPIT_STAT_KINDS)[number],
              }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "", (label) =>
            update({
              ...component,
              label: label.trim() ? label.trim() : undefined,
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max distance" }),
          numberInput(
            component.maxDistance ?? 3.5,
            (maxDistance) =>
              update({
                ...component,
                maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
              }),
            0.1,
          ),
        ]),
      ];
  }
}
