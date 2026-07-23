import {
  COCKPIT_STAT_KINDS,
  type PrefabComponent,
} from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { numberInput, selectInput, textInput } from "./inputs";
import { el } from "../../dom";
import { buildConsumableShopFields } from "./consumable_shop_fields";

export function buildWeaponShopFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "weapon-shop" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "Browse weapons", (label) =>
            ctx.update({
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
            component.maxDistance ?? 3,
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
            component.screenWidth ?? 0.45,
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
            component.screenHeight ?? 0.28,
            (screenHeight) =>
              ctx.update({
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
              ctx.update({
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
}

export function buildOutfittersFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "outfitters" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Label" }),
          textInput(component.label ?? "Browse outfitters", (label) =>
            ctx.update({
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
            component.maxDistance ?? 3,
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
            component.screenWidth ?? 0.45,
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
            component.screenHeight ?? 0.28,
            (screenHeight) =>
              ctx.update({
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
              ctx.update({
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
}

export function buildFoodShopFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "food-shop" }>,
): HTMLElement[] {
  return buildConsumableShopFields(ctx, component);
}

export function buildDrinksShopFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "drinks-shop" }>,
): HTMLElement[] {
  return buildConsumableShopFields(ctx, component);
}

export function buildCanteenFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "canteen" }>,
): HTMLElement[] {
  return buildConsumableShopFields(ctx, component);
}

export function buildCockpitStatFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "cockpit-stat" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Kind" }),
          selectInput(
            [...COCKPIT_STAT_KINDS],
            component.kind,
            (kind) =>
              ctx.update({
                ...component,
                kind: kind as (typeof COCKPIT_STAT_KINDS)[number],
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
          el("span", { className: "ed-field-label", text: "Max distance" }),
          numberInput(
            component.maxDistance ?? 3.5,
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
