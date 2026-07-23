import type { PrefabComponent } from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { assetUrlField, numberInput, selectInput, textInput } from "./inputs";
import { el, closeIcon } from "../../dom";
import { FLOOR_OPTIONS, collectAnimationIds } from "../inspector_logic";
import type { StationFloorId } from "../../../world/station";

export function buildElevatorFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "elevator" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Pair id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "On floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            ctx.update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "To floor" }),
          selectInput(FLOOR_OPTIONS, component.targetFloor, (targetFloor) =>
            ctx.update({
              ...component,
              targetFloor: targetFloor as StationFloorId,
            }),
          ),
        ]),
      ];
}

export function buildHangarPadFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "hangar-pad" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Hangar" }),
          textInput(component.hangarId, (hangarId) =>
            ctx.update({ ...component, hangarId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Pad #" }),
          numberInput(
            component.padIndex,
            (padIndex) =>
              ctx.update({
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
              ctx.update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
      ];
}

export function buildInteractionFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "interaction" }>,
): HTMLElement[] {
  const animIds = collectAnimationIds(ctx.store.getState().roots);

      const rows: HTMLElement[] = [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            ctx.update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Type" }),
          selectInput(["info", "animation"], component.interactionType ?? "info", (val) =>
            ctx.update({ ...component, interactionType: val as "info" | "animation" }),
          ),
        ]),
      ];

      if (component.interactionType === "animation") {
        rows.push(
          el("div", { className: "ed-field-row-wide" }, [
            el("span", { className: "ed-field-label", text: "Target Anim" }),
            selectInput(["", ...animIds], component.targetAnimationId ?? "", (val) =>
              ctx.update({ ...component, targetAnimationId: val || undefined }),
            ),
          ])
        );
      }

      rows.push(
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Prompt" }),
          textInput(component.prompt, (prompt) =>
            ctx.update({ ...component, prompt }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Key Bind" }),
          textInput(component.keyLabel ?? "F", (keyLabel) =>
            ctx.update({ ...component, keyLabel: keyLabel.slice(0, 10) }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Radius" }),
          numberInput(component.radius, (radius) =>
            ctx.update({ ...component, radius: Math.max(0.5, radius) }),
          ),
        ]),
        assetUrlField("Proximity SFX", component.proximitySoundUrl, (proximitySoundUrl) =>
          ctx.update({ ...component, proximitySoundUrl }),
        ),
        assetUrlField("Interact SFX", component.interactSoundUrl, (interactSoundUrl) =>
          ctx.update({ ...component, interactSoundUrl }),
        ),
      );
      return rows;
    
}

export function buildAnimationFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "animation" }>,
): HTMLElement[] {
  const rows: HTMLElement[] = [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Name" }),
          textInput(component.name, (name) => ctx.update({ ...component, name })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Motion" }),
          selectInput(["slide", "hinge"], component.motion, (motion) =>
            ctx.update({ ...component, motion: motion as "slide" | "hinge" }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Axis" }),
          selectInput(["x", "y", "z"], component.axis, (axis) =>
            ctx.update({ ...component, axis: axis as "x" | "y" | "z" }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Duration" }),
          numberInput(component.duration ?? 1.0, (duration) =>
            ctx.update({ ...component, duration: Math.max(0.01, duration) }),
          ),
        ]),
        el("label", { className: "ed-checkbox-row" }, [
          (() => {
            const checkbox = el("input", {
              attrs: { type: "checkbox" },
              on: {
                change: (event) =>
                  ctx.update({
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
                ctx.update({ ...component, nodes });
              }),
              numberInput(node.delta, (delta) => {
                const nodes = component.nodes.map((entry, index) =>
                  index === nodeIndex ? { ...entry, delta } : entry,
                );
                ctx.update({ ...component, nodes });
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
                    ctx.update({ ...component, nodes });
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
              ctx.update({
                ...component,
                nodes: [...component.nodes, { name: "", delta: 0 }],
              }),
          },
        }),
      );
      return rows;
    
}

export function buildObjectAnimationFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "object-animation" }>,
): HTMLElement[] {
  const nodes = component.nodes ?? [];
      const rows: HTMLElement[] = [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Mode" }),
          selectInput(["hover", "spin"], component.mode, (mode) =>
            ctx.update({
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
            ctx.update({ ...component, axis: axis as "x" | "y" | "z" }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", {
            className: "ed-field-label",
            text: component.mode === "spin" ? "Speed (rad/s)" : "Speed (Hz)",
          }),
          numberInput(component.speed ?? (component.mode === "spin" ? 0.4 : 0.5), (speed) =>
            ctx.update({ ...component, speed: Math.max(0, speed) }),
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
                    ctx.update({
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
              ctx.update({ ...component, amplitude: Math.max(0, amplitude) }),
            ),
          ]),
        );
      }
      rows.push(
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Phase (rad)" }),
          numberInput(component.phase ?? 0, (phase) =>
            ctx.update({ ...component, phase }),
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
                ctx.update({ ...component, nodes: nextNodes });
              }),
              el("button", {
                className: "ed-remove-btn",
                title: "Remove node",
                on: {
                  click: () => {
                    const nextNodes = nodes.filter(
                      (_, index) => index !== nodeIndex,
                    );
                    ctx.update({ ...component, nodes: nextNodes });
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
              ctx.update({
                ...component,
                nodes: [...nodes, { name: "" }],
              }),
          },
        }),
      );
      return rows;
    
}

export function buildAvmsTerminalFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "avms-terminal" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            ctx.update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Radius" }),
          numberInput(component.radius, (radius) =>
            ctx.update({ ...component, radius: Math.max(0.5, radius) }),
          ),
        ]),
      ];
}
