import type { PrefabComponent } from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { assetUrlField, imageAssetUrlField, numberInput, selectInput, textInput } from "./inputs";
import { el } from "../../dom";
import { FLOOR_OPTIONS } from "../inspector_logic";
import type { StationFloorId } from "../../../world/station";

export function buildBarrelEndFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "barrel-end" }>,
): HTMLElement[] {
  void ctx;
  void component;
  return [];
}

export function buildWeaponCombatFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "weapon-combat" }>,
): HTMLElement[] {
  return [
        assetUrlField("Fire SFX", component.fireSoundUrl ?? undefined, (fireSoundUrl) =>
          ctx.update({ ...component, fireSoundUrl: fireSoundUrl ?? null }),
        ),
        assetUrlField(
          "Dry-fire SFX",
          component.dryFireSoundUrl ?? undefined,
          (dryFireSoundUrl) =>
            ctx.update({ ...component, dryFireSoundUrl: dryFireSoundUrl ?? null }),
        ),
        assetUrlField(
          "Reload SFX",
          component.reloadSoundUrl ?? undefined,
          (reloadSoundUrl) =>
            ctx.update({ ...component, reloadSoundUrl: reloadSoundUrl ?? null }),
        ),
        imageAssetUrlField(
          "Hit decal",
          component.hitDecalUrl ?? undefined,
          (hitDecalUrl) =>
            ctx.update({ ...component, hitDecalUrl: hitDecalUrl ?? null }),
        ),
      ];
}

export function buildSpawnPointFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "spawn-point" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            ctx.update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
      ];
}

export function buildNpcSpawnerFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "npc-spawner" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id: id.trim() })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Population" }),
          textInput(component.populationId, (populationId) =>
            ctx.update({ ...component, populationId: populationId.trim() }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            ctx.update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Route group" }),
          textInput(component.routeGroup, (routeGroup) =>
            ctx.update({ ...component, routeGroup: routeGroup.trim() }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Min alive" }),
          numberInput(component.minAlive, (minAlive) => {
            const nextMin = Math.max(0, Math.min(32, Math.round(minAlive)));
            ctx.update({
              ...component,
              minAlive: nextMin,
              maxAlive: Math.max(nextMin, component.maxAlive),
            });
          }, 1),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Max alive" }),
          numberInput(component.maxAlive, (maxAlive) =>
            ctx.update({
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
            ctx.update({ ...component, radius: Math.max(0, Math.min(20, radius)) }),
          ),
        ]),
      ];
}

export function buildNpcWaypointFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "npc-waypoint" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id: id.trim() })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            ctx.update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Route group" }),
          textInput(component.routeGroup, (routeGroup) =>
            ctx.update({ ...component, routeGroup: routeGroup.trim() }),
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
            ctx.update({ ...component, links });
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
            ctx.update({
              ...component,
              waitMinSeconds: nextMin,
              waitMaxSeconds: Math.max(nextMin, component.waitMaxSeconds),
            });
          }),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Wait max" }),
          numberInput(component.waitMaxSeconds, (waitMaxSeconds) =>
            ctx.update({
              ...component,
              waitMaxSeconds: Math.max(
                component.waitMinSeconds,
                Math.min(120, waitMaxSeconds),
              ),
            }),
          ),
        ]),
      ];
}

export function buildNpcPlacementFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "npc-placement" }>,
): HTMLElement[] {
  const rows = [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Id" }),
          textInput(component.id, (id) => ctx.update({ ...component, id: id.trim() })),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Definition" }),
          textInput(component.npcDefinitionId, (npcDefinitionId) =>
            ctx.update({ ...component, npcDefinitionId: npcDefinitionId.trim() }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Display name" }),
          textInput(component.displayName ?? "", (displayName) =>
            ctx.update({ ...component, displayName: displayName.trim() || undefined }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Floor" }),
          selectInput(FLOOR_OPTIONS, component.floorId, (floorId) =>
            ctx.update({ ...component, floorId: floorId as StationFloorId }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Behavior" }),
          selectInput(["stationary", "wander", "patrol"], component.behavior, (behavior) =>
            ctx.update({
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
              ctx.update({ ...component, routeGroup: routeGroup.trim() || undefined }),
            ),
          ]),
        );
      }
      return rows;
    
}
