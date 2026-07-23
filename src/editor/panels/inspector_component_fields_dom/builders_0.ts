import type { PrefabComponent } from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { selectInput, textInput } from "./inputs";
import { el } from "../../dom";

import { buildEmptyFrameFields } from "./empty_frame_fields";

export function buildEquipmentSocketFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "equipment-socket" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Socket id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Accepts" }),
          selectInput(["sword", "handgun", "rifle"], component.accepts, (accepts) =>
            ctx.update({
              ...component,
              accepts: accepts as "sword" | "handgun" | "rifle",
            }),
          ),
        ]),
      ];
}

export function buildStationFrameFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "station-frame" }>,
): HTMLElement[] {
  void ctx;
  void component;
  return buildEmptyFrameFields();
}

export function buildPropFrameFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "prop-frame" }>,
): HTMLElement[] {
  void ctx;
  void component;
  return buildEmptyFrameFields();
}

export function buildItemFrameFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "item-frame" }>,
): HTMLElement[] {
  void ctx;
  void component;
  return buildEmptyFrameFields();
}

export function buildDrawnGripFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "drawn-grip" }>,
): HTMLElement[] {
  void ctx;
  void component;
  return buildEmptyFrameFields();
}

export function buildMuzzleFlashFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "muzzle-flash" }>,
): HTMLElement[] {
  void ctx;
  void component;
  return buildEmptyFrameFields();
}
