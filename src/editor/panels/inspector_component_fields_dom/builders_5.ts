import { el, closeIcon } from "../../dom";
import {
  COCKPIT_CONTROL_ACTIONS,
  SHIP_SEAT_ROLES,
  type PrefabComponent,
} from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { assetUrlField, numberInput, selectInput, textInput } from "./inputs";

export function buildShipDoorFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "ship-door" }>,
): HTMLElement[] {
  const rows: HTMLElement[] = [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label, (label) =>
            ctx.update({ ...component, label }),
          ),
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
          el("span", { className: "ed-field-label", text: "Trigger" }),
          selectInput(
            ["radial", "raycast"],
            component.trigger ?? "radial",
            (trigger) =>
              ctx.update({
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
            ctx.update({ ...component, radius: Math.max(0.5, radius) }),
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
                  ctx.update({
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
                    ctx.update({
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
              click: () => ctx.options.onToggleShipDoorPreview?.(component.id),
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
              ctx.update({ ...component, nodes });
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
              ctx.update({
                ...component,
                nodes: [...component.nodes, { name: "Door_R", delta: 1 }],
              }),
          },
        }),
      );
      rows.push(
        assetUrlField("Open SFX", component.openSoundUrl, (openSoundUrl) =>
          ctx.update({ ...component, openSoundUrl }),
        ),
        assetUrlField("Close SFX", component.closeSoundUrl, (closeSoundUrl) =>
          ctx.update({ ...component, closeSoundUrl }),
        ),
      );
      return rows;
    
}

export function buildPilotSeatFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "pilot-seat" }>,
): HTMLElement[] {
  const eye = component.eye ?? { x: 0, y: 0.87, z: 0.25 };
      const stand = component.stand ?? { x: 0, z: -1.55 };
      const role = component.role ?? "passenger";
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Role" }),
          selectInput([...SHIP_SEAT_ROLES], role, (next) =>
            ctx.update({
              ...component,
              role: next as (typeof SHIP_SEAT_ROLES)[number],
            }),
          ),
        ]),
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: "Eye" }),
          ...(["x", "y", "z"] as const).map((axis) =>
            numberInput(eye[axis], (next) =>
              ctx.update({ ...component, eye: { ...eye, [axis]: next } }),
            ),
          ),
        ]),
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: "Stand XZ" }),
          numberInput(stand.x, (x) =>
            ctx.update({ ...component, stand: { ...stand, x } }),
          ),
          numberInput(stand.z, (z) =>
            ctx.update({ ...component, stand: { ...stand, z } }),
          ),
          el("span", {}),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Radius" }),
          numberInput(component.interactRadius ?? 1.45, (radius) =>
            ctx.update({ ...component, interactRadius: Math.max(0.5, radius) }),
          ),
        ]),
      ];
    
}

export function buildBedFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "bed" }>,
): HTMLElement[] {
  const eye = component.eye ?? { x: 0, y: 0.3, z: 0.15 };
      const stand = component.stand ?? { x: -0.9, z: 0 };
      return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "bed", (label) =>
            ctx.update({ ...component, label }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Trigger" }),
          selectInput(
            ["radial", "raycast"],
            component.trigger ?? "radial",
            (trigger) =>
              ctx.update({
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
            ctx.update({ ...component, radius: Math.max(0.5, radius) }),
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
                  ctx.update({
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
              ctx.update({ ...component, eye: { ...eye, [axis]: next } }),
            ),
          ),
        ]),
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: "Stand XZ" }),
          numberInput(stand.x, (x) =>
            ctx.update({ ...component, stand: { ...stand, x } }),
          ),
          numberInput(stand.z, (z) =>
            ctx.update({ ...component, stand: { ...stand, z } }),
          ),
          el("span", {}),
        ]),
      ];
    
}

export function buildRampInteractFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "ramp-interact" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Place" }),
          selectInput(["outside", "deck"], component.placement, (placement) =>
            ctx.update({
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
              ctx.update({ ...component, radius: Math.max(0.5, radius) }),
          ),
        ]),
      ];
}

export function buildCockpitControlFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "cockpit-control" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Action" }),
          selectInput(
            [...COCKPIT_CONTROL_ACTIONS],
            component.action,
            (action) =>
              ctx.update({
                ...component,
                action: action as (typeof COCKPIT_CONTROL_ACTIONS)[number],
              }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "", (label) =>
            ctx.update({
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
              ctx.update({
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
              ctx.update({
                ...component,
                maxDistance: Math.max(0.5, Math.min(10, maxDistance)),
              }),
            0.1,
          ),
        ]),
      ];
}

export function buildEntertainmentSystemFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "entertainment-system" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "Turn on ES", (label) =>
            ctx.update({
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
              ctx.update({
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
              ctx.update({
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
              ctx.update({
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
              ctx.update({
                ...component,
                screenHeight: Math.max(0.15, Math.min(1.5, screenHeight)),
              }),
            0.05,
          ),
        ]),
      ];
}
