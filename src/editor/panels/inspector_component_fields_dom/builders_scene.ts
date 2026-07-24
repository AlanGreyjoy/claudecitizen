import type { PrefabComponent } from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { selectInput, textInput } from "./inputs";
import { el } from "../../dom";

const SPAWN_OPTIONS = ["station", "surface"];

const PREFAB_KIND_OPTIONS = ["station", "ship", "site", "prop", "item"];

export function buildGameManagerFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "game-manager" }>,
): HTMLElement[] {
  return [
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "System ID" }),
      textInput(component.systemId, (systemId) =>
        ctx.update({ ...component, systemId }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Planet ID" }),
      textInput(component.planetId, (planetId) =>
        ctx.update({ ...component, planetId }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Spawn" }),
      selectInput(SPAWN_OPTIONS, component.spawn, (spawn) =>
        ctx.update({
          ...component,
          spawn: spawn === "surface" ? "surface" : "station",
        }),
      ),
    ]),
  ];
}

export function buildPlanetFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "planet" }>,
): HTMLElement[] {
  return [
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Planet ID" }),
      textInput(component.planetId, (planetId) =>
        ctx.update({ ...component, planetId }),
      ),
    ]),
  ];
}

export function buildPlayerStartFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "player-start" }>,
): HTMLElement[] {
  return [
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Spawn" }),
      selectInput(SPAWN_OPTIONS, component.spawn, (spawn) =>
        ctx.update({
          ...component,
          spawn: spawn === "surface" ? "surface" : "station",
        }),
      ),
    ]),
  ];
}

export function buildPrefabInstanceFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "prefab-instance" }>,
): HTMLElement[] {
  return [
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Prefab ID" }),
      textInput(component.prefabId, (prefabId) =>
        ctx.update({ ...component, prefabId }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Kind" }),
      selectInput(
        PREFAB_KIND_OPTIONS,
        component.prefabKind ?? "station",
        (prefabKind) =>
          ctx.update({
            ...component,
            prefabKind: prefabKind as NonNullable<
              Extract<PrefabComponent, { type: "prefab-instance" }>["prefabKind"]
            >,
          }),
      ),
    ]),
  ];
}
