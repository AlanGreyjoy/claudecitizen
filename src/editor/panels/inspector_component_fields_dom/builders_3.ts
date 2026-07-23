import type { PrefabComponent } from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { assetUrlField, numberInput, selectInput, textInput, colorInput } from "./inputs";
import { el } from "../../dom";
import { fitBoxColliderToBounds } from "../../component_actions";
import { buildParticleSystemFields as buildParticleSystemEditorFields } from "../particle_fields";

export function buildPointLightFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "point-light" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Color" }),
          colorInput(component.color ?? "#dfeaff", (color) =>
            ctx.update({ ...component, color }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Intensity" }),
          numberInput(component.intensity, (intensity) =>
            ctx.update({
              ...component,
              intensity: Math.min(5_000, Math.max(0, intensity)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Range" }),
          numberInput(component.distance, (distance) =>
            ctx.update({
              ...component,
              distance: Math.min(500, Math.max(0, distance)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Decay" }),
          numberInput(component.decay ?? 2, (decay) =>
            ctx.update({
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
                  ctx.update({
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
}

export function buildAreaLightFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "area-light" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Color" }),
          colorInput(component.color ?? "#cfe8ff", (color) =>
            ctx.update({ ...component, color }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Intensity" }),
          numberInput(component.intensity, (intensity) =>
            ctx.update({
              ...component,
              intensity: Math.min(500, Math.max(0, intensity)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: "Size" }),
          numberInput(component.width, (width) =>
            ctx.update({
              ...component,
              width: Math.min(100, Math.max(0.05, width)),
            }),
          ),
          numberInput(component.height, (height) =>
            ctx.update({
              ...component,
              height: Math.min(100, Math.max(0.05, height)),
            }),
          ),
          el("span", {}),
        ]),
      ];
}

export function buildSpotLightFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "spot-light" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Color" }),
          colorInput(component.color ?? "#dfeaff", (color) =>
            ctx.update({ ...component, color }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Intensity" }),
          numberInput(component.intensity, (intensity) =>
            ctx.update({
              ...component,
              intensity: Math.min(5_000, Math.max(0, intensity)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Range" }),
          numberInput(component.distance, (distance) =>
            ctx.update({
              ...component,
              distance: Math.min(500, Math.max(0, distance)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Decay" }),
          numberInput(component.decay ?? 2, (decay) =>
            ctx.update({
              ...component,
              decay: Math.min(4, Math.max(0, decay)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Angle" }),
          numberInput(component.angle ?? 45, (angle) =>
            ctx.update({
              ...component,
              angle: Math.min(90, Math.max(0, angle)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Penumbra" }),
          numberInput(component.penumbra ?? 0, (penumbra) =>
            ctx.update({
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
                  ctx.update({
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
}

export function buildSoundFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "sound" }>,
): HTMLElement[] {
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
        text: ctx.options.audioPreview.isPlaying(previewKey)
          ? "Stop preview"
          : "Preview sound",
        title: component.soundUrl
          ? "Preview assigned sound"
          : "Assign an audio asset first",
        on: {
          click: () => {
            if (!component.soundUrl) return;
            ctx.options.audioPreview.toggle(
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
          ctx.update({ ...component, soundUrl }),
        ),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Mode" }),
          selectInput(["ambient", "spatial"], component.mode, (mode) =>
            ctx.update({
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
              ctx.update({
                ...component,
                playback: playback as "loop" | "enter",
              }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Volume" }),
          numberInput(component.volume, (volume) =>
            ctx.update({
              ...component,
              volume: Math.min(1, Math.max(0, volume)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Blend" }),
          numberInput(component.blendDistance, (blendDistance) =>
            ctx.update({
              ...component,
              blendDistance: Math.min(maxBlend, Math.max(0, blendDistance)),
            }),
          ),
        ]),
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Zone" }),
          selectInput(["sphere", "box"], component.zone.shape, (shape) => {
            if (shape === component.zone.shape) return;
            ctx.update({
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
              ctx.update({
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
                ctx.update({
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

export function buildParticleSystemComponentFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "particle-system" }>,
): HTMLElement[] {
  return buildParticleSystemEditorFields(component, ctx.update, {
    entityId: ctx.fieldOptions?.entityId,
    preview: ctx.options.particlePreview,
  });
}

export function buildColliderFields(
  ctx: ComponentFieldBuildContext,
  component: Extract<PrefabComponent, { type: "collider" }>,
): HTMLElement[] {
  return [
        el("div", { className: "ed-field-row-wide" }, [
          el("span", { className: "ed-field-label", text: "Shape" }),
          selectInput(["box", "mesh"], component.shape, (shape) => {
            if (shape === "mesh") {
              ctx.update({
                type: "collider",
                shape: "mesh",
                node: component.node,
              });
              return;
            }
            const fitted = ctx.fieldOptions?.colliderNodeBounds
              ? fitBoxColliderToBounds(ctx.fieldOptions.colliderNodeBounds)
              : null;
            ctx.update({
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
                    ctx.update({
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
                  ctx.update({
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
                        ctx.update({
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
              ctx.update({
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
        ...(ctx.fieldOptions?.hideColliderNodeField
          ? []
          : [
              el("div", { className: "ed-field-row-wide" }, [
                el("span", { className: "ed-field-label", text: "Node" }),
                textInput(component.node ?? "", (node) =>
                  ctx.update({ ...component, node: node.trim() || undefined }),
                ),
              ]),
            ]),
      ];
}
