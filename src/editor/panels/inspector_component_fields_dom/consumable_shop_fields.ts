import type { PrefabComponent } from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { el } from "../../dom";
import { numberInput, textInput } from "./inputs";

type ConsumableShopComponent = Extract<
  PrefabComponent,
  { type: "food-shop" | "drinks-shop" | "canteen" }
>;

function consumableShopDefaults(component: ConsumableShopComponent): {
  defaultLabel: string;
  filterHint: string;
} {
  if (component.type === "food-shop") {
    return {
      defaultLabel: "Browse food",
      filterHint:
        "Optional comma-separated food item IDs. Empty = all food consumables.",
    };
  }
  if (component.type === "drinks-shop") {
    return {
      defaultLabel: "Browse drinks",
      filterHint:
        "Optional comma-separated drink item IDs. Empty = all drink consumables.",
    };
  }
  return {
    defaultLabel: "Browse food & drinks",
    filterHint:
      "Optional comma-separated consumable IDs. Empty = all food and drinks.",
  };
}

export function buildConsumableShopFields(
  ctx: ComponentFieldBuildContext,
  component: ConsumableShopComponent,
): HTMLElement[] {
  const { update } = ctx;
  const { defaultLabel, filterHint } = consumableShopDefaults(component);
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
      textInput((component.itemDefinitionIds ?? []).join(", "), (raw) => {
        const ids = raw
          .split(/[,\s]+/)
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        update({
          ...component,
          itemDefinitionIds: ids.length > 0 ? ids : undefined,
        });
      }),
    ]),
    el("div", {
      className: "ed-hint",
      text: filterHint,
    }),
  ];
}
