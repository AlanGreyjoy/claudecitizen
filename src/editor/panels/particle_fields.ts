import { el } from "../dom";
import { ASSET_DND_TYPE } from "../api";
import type {
  PrefabComponent,
  PrefabCurve,
  PrefabGradient,
  PrefabMinMax,
} from "../../world/prefabs/schema";
import { PARTICLE_MAX_PARTICLES_HARD_CAP } from "../../world/prefabs/schema";

type ParticleComponent = PrefabComponent & { type: "particle-system" };

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".ktx2", ".ktx"];

function isImageAssetUrl(url: string): boolean {
  const pathname = url.split(/[?#]/, 1)[0].toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

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

function colorInput(value: string, onCommit: (next: string) => void): HTMLInputElement {
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

function checkboxRow(
  label: string,
  checked: boolean,
  onChange: (next: boolean) => void,
): HTMLElement {
  return el("label", { className: "ed-checkbox-row" }, [
    (() => {
      const checkbox = el("input", {
        attrs: { type: "checkbox" },
        on: {
          change: (event) =>
            onChange((event.target as HTMLInputElement).checked),
        },
      });
      checkbox.checked = checked;
      return checkbox;
    })(),
    el("span", { text: label }),
  ]);
}

function row(label: string, control: HTMLElement | HTMLElement[]): HTMLElement {
  return el("div", { className: "ed-field-row-wide" }, [
    el("span", { className: "ed-field-label", text: label }),
    ...(Array.isArray(control) ? control : [control]),
  ]);
}

function minMaxEditor(
  label: string,
  value: PrefabMinMax,
  onCommit: (next: PrefabMinMax) => void,
): HTMLElement[] {
  const mode = value.mode;
  return [
    row(label, [
      selectInput(["constant", "random"], mode, (nextMode) => {
        if (nextMode === "random") {
          const base = mode === "constant" ? value.value : value.min;
          onCommit({ mode: "random", min: base, max: base });
        } else {
          const base = mode === "constant" ? value.value : (value.min + value.max) * 0.5;
          onCommit({ mode: "constant", value: base });
        }
      }),
    ]),
    mode === "constant"
      ? row(`${label} value`, numberInput(value.value, (v) => onCommit({ mode: "constant", value: v })))
      : el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: `${label} min/max` }),
          numberInput(value.min, (min) =>
            onCommit({ mode: "random", min, max: Math.max(min, value.max) }),
          ),
          numberInput(value.max, (max) =>
            onCommit({ mode: "random", min: Math.min(value.min, max), max }),
          ),
          el("span", {}),
        ]),
  ];
}

function curveEditor(
  label: string,
  curve: PrefabCurve,
  onCommit: (next: PrefabCurve) => void,
): HTMLElement {
  const block = el("div", { className: "ed-particle-module-body" });
  block.append(el("div", { className: "ed-field-label", text: label }));
  curve.forEach((key, index) => {
    block.append(
      el("div", { className: "ed-field-row" }, [
        el("span", { className: "ed-field-label", text: `Key ${index}` }),
        numberInput(key.t, (t) => {
          const next = curve.map((k, i) =>
            i === index ? { ...k, t: Math.min(1, Math.max(0, t)) } : k,
          );
          onCommit(next);
        }, 0.05),
        numberInput(key.value, (value) => {
          const next = curve.map((k, i) => (i === index ? { ...k, value } : k));
          onCommit(next);
        }),
        el("button", {
          className: "ed-btn",
          text: "×",
          on: {
            click: () => {
              if (curve.length <= 1) return;
              onCommit(curve.filter((_, i) => i !== index));
            },
          },
        }),
      ]),
    );
  });
  block.append(
    el("button", {
      className: "ed-btn",
      text: "Add key",
      on: {
        click: () =>
          onCommit([...curve, { t: 1, value: curve[curve.length - 1]?.value ?? 1 }]),
      },
    }),
  );
  return block;
}

function gradientEditor(
  label: string,
  gradient: PrefabGradient,
  onCommit: (next: PrefabGradient) => void,
): HTMLElement {
  const block = el("div", { className: "ed-particle-module-body" });
  block.append(el("div", { className: "ed-field-label", text: label }));
  gradient.forEach((key, index) => {
    block.append(
      el("div", { className: "ed-field-row" }, [
        el("span", { className: "ed-field-label", text: `Key ${index}` }),
        numberInput(key.t, (t) => {
          const next = gradient.map((k, i) =>
            i === index ? { ...k, t: Math.min(1, Math.max(0, t)) } : k,
          );
          onCommit(next);
        }, 0.05),
        colorInput(key.color, (color) => {
          const next = gradient.map((k, i) => (i === index ? { ...k, color } : k));
          onCommit(next);
        }),
        numberInput(key.alpha ?? 1, (alpha) => {
          const next = gradient.map((k, i) =>
            i === index ? { ...k, alpha: Math.min(1, Math.max(0, alpha)) } : k,
          );
          onCommit(next);
        }, 0.05),
        el("button", {
          className: "ed-btn",
          text: "×",
          on: {
            click: () => {
              if (gradient.length <= 1) return;
              onCommit(gradient.filter((_, i) => i !== index));
            },
          },
        }),
      ]),
    );
  });
  block.append(
    el("button", {
      className: "ed-btn",
      text: "Add key",
      on: {
        click: () =>
          onCommit([
            ...gradient,
            {
              t: 1,
              color: gradient[gradient.length - 1]?.color ?? "#ffffff",
              alpha: 0,
            },
          ]),
      },
    }),
  );
  return block;
}

function moduleBlock(
  title: string,
  enabled: boolean | undefined,
  onToggle: ((next: boolean) => void) | null,
  children: HTMLElement[],
): HTMLElement {
  const details = el("details", { className: "ed-particle-module" });
  details.open = enabled !== false;
  const summary = el("summary", { className: "ed-particle-module-title" });
  if (onToggle) {
    summary.append(
      (() => {
        const checkbox = el("input", {
          attrs: { type: "checkbox" },
          on: {
            click: (event) => event.stopPropagation(),
            change: (event) => {
              event.stopPropagation();
              onToggle((event.target as HTMLInputElement).checked);
            },
          },
        });
        checkbox.checked = Boolean(enabled);
        return checkbox;
      })(),
    );
  }
  summary.append(document.createTextNode(` ${title}`));
  details.append(summary);
  const body = el("div", { className: "ed-particle-module-body" }, children);
  details.append(body);
  return details;
}

function textureUrlField(
  value: string | undefined,
  onCommit: (next: string | undefined) => void,
): HTMLElement {
  const input = el("input", {
    className: "ed-input",
    attrs: { type: "text", value: value ?? "" },
    on: {
      change: (event) => {
        const next = (event.target as HTMLInputElement).value.trim();
        onCommit(next || undefined);
      },
      keydown: (event) => event.stopPropagation(),
    },
  });
  input.addEventListener("dragover", (event) => event.preventDefault());
  input.addEventListener("drop", (event) => {
    event.preventDefault();
    const url =
      event.dataTransfer?.getData(ASSET_DND_TYPE) ||
      event.dataTransfer?.getData("text/plain");
    if (url?.startsWith("/") && isImageAssetUrl(url)) onCommit(url);
  });
  return el("div", { className: "ed-field-row-wide" }, [
    el("span", { className: "ed-field-label", text: "Texture" }),
    el("div", { className: "ed-field-controls" }, [
      input,
      el("button", {
        className: "ed-btn",
        text: "Clear",
        on: { click: () => onCommit(undefined) },
      }),
    ]),
  ]);
}

export interface ParticlePreviewControls {
  restart: (entityId: string) => void;
  setPlaying: (entityId: string, playing: boolean) => void;
  isPlaying: (entityId: string) => boolean;
}

export function buildParticleSystemFields(
  component: ParticleComponent,
  update: (next: ParticleComponent) => void,
  options: {
    entityId?: string;
    preview?: ParticlePreviewControls;
  } = {},
): HTMLElement[] {
  const rows: HTMLElement[] = [];

  if (options.entityId && options.preview) {
    const entityId = options.entityId;
    const preview = options.preview;
    rows.push(
      el("div", { className: "ed-field-row" }, [
        checkboxRow("Playing", preview.isPlaying(entityId), (playing) =>
          preview.setPlaying(entityId, playing),
        ),
        el("button", {
          className: "ed-btn",
          text: "Restart",
          on: { click: () => preview.restart(entityId) },
        }),
        el("span", {}),
      ]),
    );
  }

  rows.push(
    moduleBlock("Main", true, null, [
      checkboxRow("Enabled", component.enabled !== false, (enabled) =>
        update({ ...component, enabled }),
      ),
      checkboxRow("Play On Awake", component.playOnAwake !== false, (playOnAwake) =>
        update({ ...component, playOnAwake }),
      ),
      checkboxRow("Looping", component.looping, (looping) =>
        update({ ...component, looping }),
      ),
      checkboxRow("Prewarm", Boolean(component.prewarm), (prewarm) =>
        update({ ...component, prewarm }),
      ),
      row(
        "Duration",
        numberInput(component.duration, (duration) =>
          update({ ...component, duration: Math.max(0.01, duration) }),
        ),
      ),
      ...minMaxEditor("Start Delay", component.startDelay, (startDelay) =>
        update({ ...component, startDelay }),
      ),
      ...minMaxEditor("Start Lifetime", component.startLifetime, (startLifetime) =>
        update({ ...component, startLifetime }),
      ),
      ...minMaxEditor("Start Speed", component.startSpeed, (startSpeed) =>
        update({ ...component, startSpeed }),
      ),
      ...minMaxEditor("Start Size", component.startSize, (startSize) =>
        update({ ...component, startSize }),
      ),
      row(
        "Start Color",
        colorInput(component.startColor, (startColor) =>
          update({ ...component, startColor }),
        ),
      ),
      ...minMaxEditor("Start Rotation", component.startRotation, (startRotation) =>
        update({ ...component, startRotation }),
      ),
      row(
        "Gravity",
        numberInput(component.gravityModifier, (gravityModifier) =>
          update({ ...component, gravityModifier }),
        ),
      ),
      row(
        "Simulation",
        selectInput(["local", "world"], component.simulationSpace, (simulationSpace) =>
          update({
            ...component,
            simulationSpace: simulationSpace as "local" | "world",
          }),
        ),
      ),
      row(
        "Max Particles",
        numberInput(
          component.maxParticles,
          (maxParticles) =>
            update({
              ...component,
              maxParticles: Math.min(
                PARTICLE_MAX_PARTICLES_HARD_CAP,
                Math.max(1, Math.floor(maxParticles)),
              ),
            }),
          1,
        ),
      ),
    ]),
  );

  rows.push(
    moduleBlock("Emission", true, null, [
      row(
        "Rate over Time",
        numberInput(component.emission.rateOverTime, (rateOverTime) =>
          update({
            ...component,
            emission: { ...component.emission, rateOverTime: Math.max(0, rateOverTime) },
          }),
        ),
      ),
      el("div", {
        className: "ed-field-label",
        text: `Bursts (${component.emission.bursts.length})`,
      }),
      ...component.emission.bursts.flatMap((burst, index) => [
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: `Burst ${index} time` }),
          numberInput(burst.time, (time) => {
            const bursts = component.emission.bursts.map((b, i) =>
              i === index ? { ...b, time: Math.max(0, time) } : b,
            );
            update({ ...component, emission: { ...component.emission, bursts } });
          }),
          el("button", {
            className: "ed-btn",
            text: "×",
            on: {
              click: () => {
                const bursts = component.emission.bursts.filter((_, i) => i !== index);
                update({ ...component, emission: { ...component.emission, bursts } });
              },
            },
          }),
        ]),
        ...minMaxEditor(`Burst ${index} count`, burst.count, (count) => {
          const bursts = component.emission.bursts.map((b, i) =>
            i === index ? { ...b, count } : b,
          );
          update({ ...component, emission: { ...component.emission, bursts } });
        }),
      ]),
      el("button", {
        className: "ed-btn",
        text: "Add burst",
        on: {
          click: () =>
            update({
              ...component,
              emission: {
                ...component.emission,
                bursts: [
                  ...component.emission.bursts,
                  { time: 0, count: { mode: "constant", value: 12 }, cycles: 1, interval: 0.5 },
                ],
              },
            }),
        },
      }),
    ]),
  );

  const shape = component.shape;
  rows.push(
    moduleBlock(
      "Shape",
      shape.enabled,
      (enabled) => update({ ...component, shape: { ...shape, enabled } }),
      [
        row(
          "Shape",
          selectInput(
            ["sphere", "hemisphere", "cone", "box", "circle", "edge"],
            shape.shape,
            (next) =>
              update({
                ...component,
                shape: {
                  ...shape,
                  shape: next as typeof shape.shape,
                },
              }),
          ),
        ),
        row(
          "Radius",
          numberInput(shape.radius, (radius) =>
            update({ ...component, shape: { ...shape, radius: Math.max(0, radius) } }),
          ),
        ),
        row(
          "Radius Thickness",
          numberInput(shape.radiusThickness, (radiusThickness) =>
            update({
              ...component,
              shape: {
                ...shape,
                radiusThickness: Math.min(1, Math.max(0, radiusThickness)),
              },
            }),
          ),
        ),
        row(
          "Angle",
          numberInput(shape.angle, (angle) =>
            update({
              ...component,
              shape: { ...shape, angle: Math.min(180, Math.max(0, angle)) },
            }),
          ),
        ),
        row(
          "Arc",
          numberInput(shape.arc, (arc) =>
            update({
              ...component,
              shape: { ...shape, arc: Math.min(360, Math.max(0, arc)) },
            }),
          ),
        ),
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: "Box" }),
          numberInput(shape.box.x, (x) =>
            update({ ...component, shape: { ...shape, box: { ...shape.box, x } } }),
          ),
          numberInput(shape.box.y, (y) =>
            update({ ...component, shape: { ...shape, box: { ...shape.box, y } } }),
          ),
          numberInput(shape.box.z, (z) =>
            update({ ...component, shape: { ...shape, box: { ...shape.box, z } } }),
          ),
        ]),
        row(
          "Emit From",
          selectInput(["volume", "shell", "edge"], shape.emitFrom, (emitFrom) =>
            update({
              ...component,
              shape: { ...shape, emitFrom: emitFrom as typeof shape.emitFrom },
            }),
          ),
        ),
        checkboxRow("Align To Direction", shape.alignToDirection, (alignToDirection) =>
          update({ ...component, shape: { ...shape, alignToDirection } }),
        ),
      ],
    ),
  );

  const vel = component.velocityOverLifetime ?? {
    enabled: false,
    space: "local" as const,
    linear: { x: 0, y: 0, z: 0 },
    orbital: { x: 0, y: 0, z: 0 },
    radial: 0,
  };
  rows.push(
    moduleBlock(
      "Velocity over Lifetime",
      vel.enabled,
      (enabled) =>
        update({ ...component, velocityOverLifetime: { ...vel, enabled } }),
      [
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: "Linear" }),
          numberInput(vel.linear.x, (x) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, linear: { ...vel.linear, x } },
            }),
          ),
          numberInput(vel.linear.y, (y) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, linear: { ...vel.linear, y } },
            }),
          ),
          numberInput(vel.linear.z, (z) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, linear: { ...vel.linear, z } },
            }),
          ),
        ]),
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: "Orbital" }),
          numberInput(vel.orbital.x, (x) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, orbital: { ...vel.orbital, x } },
            }),
          ),
          numberInput(vel.orbital.y, (y) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, orbital: { ...vel.orbital, y } },
            }),
          ),
          numberInput(vel.orbital.z, (z) =>
            update({
              ...component,
              velocityOverLifetime: { ...vel, orbital: { ...vel.orbital, z } },
            }),
          ),
        ]),
        row(
          "Radial",
          numberInput(vel.radial, (radial) =>
            update({ ...component, velocityOverLifetime: { ...vel, radial } }),
          ),
        ),
      ],
    ),
  );

  const force = component.forceOverLifetime ?? {
    enabled: false,
    space: "local" as const,
    force: { x: 0, y: 0, z: 0 },
  };
  rows.push(
    moduleBlock(
      "Force over Lifetime",
      force.enabled,
      (enabled) =>
        update({ ...component, forceOverLifetime: { ...force, enabled } }),
      [
        el("div", { className: "ed-field-row" }, [
          el("span", { className: "ed-field-label", text: "Force" }),
          numberInput(force.force.x, (x) =>
            update({
              ...component,
              forceOverLifetime: { ...force, force: { ...force.force, x } },
            }),
          ),
          numberInput(force.force.y, (y) =>
            update({
              ...component,
              forceOverLifetime: { ...force, force: { ...force.force, y } },
            }),
          ),
          numberInput(force.force.z, (z) =>
            update({
              ...component,
              forceOverLifetime: { ...force, force: { ...force.force, z } },
            }),
          ),
        ]),
      ],
    ),
  );

  const colorOver = component.colorOverLifetime ?? {
    enabled: false,
    gradient: [
      { t: 0, color: component.startColor, alpha: 1 },
      { t: 1, color: component.startColor, alpha: 0 },
    ],
  };
  rows.push(
    moduleBlock(
      "Color over Lifetime",
      colorOver.enabled,
      (enabled) =>
        update({ ...component, colorOverLifetime: { ...colorOver, enabled } }),
      [
        gradientEditor("Gradient", colorOver.gradient, (gradient) =>
          update({ ...component, colorOverLifetime: { ...colorOver, gradient } }),
        ),
      ],
    ),
  );

  const sizeOver = component.sizeOverLifetime ?? {
    enabled: false,
    curve: [
      { t: 0, value: 1 },
      { t: 1, value: 0 },
    ],
  };
  rows.push(
    moduleBlock(
      "Size over Lifetime",
      sizeOver.enabled,
      (enabled) =>
        update({ ...component, sizeOverLifetime: { ...sizeOver, enabled } }),
      [
        curveEditor("Curve", sizeOver.curve, (curve) =>
          update({ ...component, sizeOverLifetime: { ...sizeOver, curve } }),
        ),
      ],
    ),
  );

  const sheet = component.textureSheetAnimation ?? {
    enabled: false,
    tilesX: 1,
    tilesY: 1,
    animation: "whole-sheet" as const,
    cycles: 1,
    startFrame: 0,
  };
  rows.push(
    moduleBlock(
      "Texture Sheet Animation",
      sheet.enabled,
      (enabled) =>
        update({ ...component, textureSheetAnimation: { ...sheet, enabled } }),
      [
        row(
          "Tiles X",
          numberInput(sheet.tilesX, (tilesX) =>
            update({
              ...component,
              textureSheetAnimation: {
                ...sheet,
                tilesX: Math.max(1, Math.floor(tilesX)),
              },
            }),
            1,
          ),
        ),
        row(
          "Tiles Y",
          numberInput(sheet.tilesY, (tilesY) =>
            update({
              ...component,
              textureSheetAnimation: {
                ...sheet,
                tilesY: Math.max(1, Math.floor(tilesY)),
              },
            }),
            1,
          ),
        ),
        row(
          "Animation",
          selectInput(["whole-sheet", "single-row"], sheet.animation, (animation) =>
            update({
              ...component,
              textureSheetAnimation: {
                ...sheet,
                animation: animation as "whole-sheet" | "single-row",
              },
            }),
          ),
        ),
        row(
          "Cycles",
          numberInput(sheet.cycles, (cycles) =>
            update({
              ...component,
              textureSheetAnimation: { ...sheet, cycles: Math.max(0.01, cycles) },
            }),
          ),
        ),
        row(
          "Start Frame",
          numberInput(sheet.startFrame, (startFrame) =>
            update({
              ...component,
              textureSheetAnimation: {
                ...sheet,
                startFrame: Math.max(0, Math.floor(startFrame)),
              },
            }),
            1,
          ),
        ),
      ],
    ),
  );

  const collision = component.collision ?? {
    enabled: false,
    type: "planes" as const,
    groundPlane: true,
    planes: [],
    dampen: 0.1,
    bounce: 0.3,
    lifetimeLoss: 0.1,
    maxKillSpeed: 100,
  };
  rows.push(
    moduleBlock(
      "Collision",
      collision.enabled,
      (enabled) => update({ ...component, collision: { ...collision, enabled } }),
      [
        checkboxRow("Ground Plane (Y=0)", collision.groundPlane, (groundPlane) =>
          update({ ...component, collision: { ...collision, groundPlane } }),
        ),
        row(
          "Dampen",
          numberInput(collision.dampen, (dampen) =>
            update({
              ...component,
              collision: {
                ...collision,
                dampen: Math.min(1, Math.max(0, dampen)),
              },
            }),
          ),
        ),
        row(
          "Bounce",
          numberInput(collision.bounce, (bounce) =>
            update({
              ...component,
              collision: {
                ...collision,
                bounce: Math.min(1, Math.max(0, bounce)),
              },
            }),
          ),
        ),
        row(
          "Lifetime Loss",
          numberInput(collision.lifetimeLoss, (lifetimeLoss) =>
            update({
              ...component,
              collision: {
                ...collision,
                lifetimeLoss: Math.min(1, Math.max(0, lifetimeLoss)),
              },
            }),
          ),
        ),
        row(
          "Max Kill Speed",
          numberInput(collision.maxKillSpeed, (maxKillSpeed) =>
            update({
              ...component,
              collision: { ...collision, maxKillSpeed: Math.max(0, maxKillSpeed) },
            }),
          ),
        ),
      ],
    ),
  );

  const trails = component.trails ?? {
    enabled: false,
    ratio: 0.3,
    lifetime: 0.35,
    minVertexDistance: 0.05,
    widthOverTrail: [
      { t: 0, value: 1 },
      { t: 1, value: 0 },
    ],
    colorOverTrail: [
      { t: 0, color: component.startColor, alpha: 0.8 },
      { t: 1, color: component.startColor, alpha: 0 },
    ],
    dieWithParticles: true,
  };
  rows.push(
    moduleBlock(
      "Trails",
      trails.enabled,
      (enabled) => update({ ...component, trails: { ...trails, enabled } }),
      [
        row(
          "Ratio",
          numberInput(trails.ratio, (ratio) =>
            update({
              ...component,
              trails: { ...trails, ratio: Math.min(1, Math.max(0, ratio)) },
            }),
          ),
        ),
        row(
          "Lifetime",
          numberInput(trails.lifetime, (lifetime) =>
            update({
              ...component,
              trails: { ...trails, lifetime: Math.max(0.01, lifetime) },
            }),
          ),
        ),
        row(
          "Min Vertex Dist",
          numberInput(trails.minVertexDistance, (minVertexDistance) =>
            update({
              ...component,
              trails: {
                ...trails,
                minVertexDistance: Math.max(0.001, minVertexDistance),
              },
            }),
          ),
        ),
        checkboxRow("Die With Particles", trails.dieWithParticles, (dieWithParticles) =>
          update({ ...component, trails: { ...trails, dieWithParticles } }),
        ),
        curveEditor("Width over Trail", trails.widthOverTrail, (widthOverTrail) =>
          update({ ...component, trails: { ...trails, widthOverTrail } }),
        ),
        gradientEditor("Color over Trail", trails.colorOverTrail, (colorOverTrail) =>
          update({ ...component, trails: { ...trails, colorOverTrail } }),
        ),
      ],
    ),
  );

  const renderer = component.renderer;
  rows.push(
    moduleBlock("Renderer", true, null, [
      row(
        "Mode",
        selectInput(
          ["billboard", "stretched-billboard", "horizontal", "vertical"],
          renderer.renderMode,
          (renderMode) =>
            update({
              ...component,
              renderer: {
                ...renderer,
                renderMode: renderMode as typeof renderer.renderMode,
              },
            }),
        ),
      ),
      textureUrlField(renderer.textureUrl, (textureUrl) =>
        update({ ...component, renderer: { ...renderer, textureUrl } }),
      ),
      row(
        "Blend",
        selectInput(["alpha", "additive"], renderer.blendMode, (blendMode) =>
          update({
            ...component,
            renderer: {
              ...renderer,
              blendMode: blendMode as typeof renderer.blendMode,
            },
          }),
        ),
      ),
      checkboxRow("Soft Particles", renderer.softParticles, (softParticles) =>
        update({ ...component, renderer: { ...renderer, softParticles } }),
      ),
      row(
        "Soft Near",
        numberInput(renderer.softParticleNearFade, (softParticleNearFade) =>
          update({ ...component, renderer: { ...renderer, softParticleNearFade } }),
        ),
      ),
      row(
        "Soft Far",
        numberInput(renderer.softParticleFarFade, (softParticleFarFade) =>
          update({ ...component, renderer: { ...renderer, softParticleFarFade } }),
        ),
      ),
      row(
        "Length Scale",
        numberInput(renderer.lengthScale, (lengthScale) =>
          update({ ...component, renderer: { ...renderer, lengthScale } }),
        ),
      ),
      row(
        "Speed Scale",
        numberInput(renderer.speedScale, (speedScale) =>
          update({ ...component, renderer: { ...renderer, speedScale } }),
        ),
      ),
      row(
        "Sort",
        selectInput(["none", "by-distance"], renderer.sortMode, (sortMode) =>
          update({
            ...component,
            renderer: {
              ...renderer,
              sortMode: sortMode as typeof renderer.sortMode,
            },
          }),
        ),
      ),
    ]),
  );

  return rows;
}
