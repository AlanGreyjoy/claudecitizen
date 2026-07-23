import type { PrefabComponent } from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { numberInput, textInput } from "./inputs";
import { el } from "../../dom";

import { buildShipControllerFields } from "./ship_controller_fields";

export { buildShipControllerFields };

export function buildShipFrameFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "ship-frame" }>,
): HTMLElement[] {
  void ctx;
  void component;
  return [];
}

export function buildShipStatsFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "ship-stats" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max spd" }),
          numberInput(component.maxSpeedMps ?? 100, (next) =>
            ctx.update({
              ...component,
              maxSpeedMps: Math.min(500, Math.max(5, next)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max HP" }),
          numberInput(component.maxHp ?? 1000, (next) =>
            ctx.update({
              ...component,
              maxHp: Math.min(100_000, Math.max(1, next)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Shields" }),
          numberInput(component.maxShields ?? 500, (next) =>
            ctx.update({
              ...component,
              maxShields: Math.min(100_000, Math.max(0, next)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Regen/s" }),
          numberInput(component.shieldRegenPerSec ?? 25, (next) =>
            ctx.update({
              ...component,
              shieldRegenPerSec: Math.min(10_000, Math.max(0, next)),
            }),
          ),
        ]),
      ];
}

export function buildShipGearFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "ship-gear" }>,
): HTMLElement[] {
  void ctx;
  return [
        el("div", {
          className: "ed-empty-note",
          text: `${component.nodes.length} gear hinge(s). Edit nodes in the prefab JSON for now.`,
        }),
      ];
}

export function buildShipRampFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "ship-ramp" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Node" }),
          textInput(component.node, (node) => ctx.update({ ...component, node })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Lower °" }),
          numberInput(component.lowerRadians, (lowerRadians) =>
            ctx.update({
              ...component,
              lowerRadians: Math.min(10, Math.max(-10, lowerRadians)),
            }),
          ),
        ]),
      ];
}

export function buildShipHullFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "ship-hull" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Rest ht" }),
          numberInput(component.restHeight ?? 0, (next) =>
            ctx.update({
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
}
