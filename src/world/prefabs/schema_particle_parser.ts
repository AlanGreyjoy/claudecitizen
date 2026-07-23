import type {
  PrefabComponent,
  PrefabParticleBlendMode,
  PrefabParticleRenderMode,
  PrefabParticleShapeType,
  PrefabParticleSimulationSpace,
  PrefabParticleSortMode,
} from "./schema";
import { PARTICLE_MAX_PARTICLES_HARD_CAP } from "./schema";
import {
  createDefaultParticleSystemComponent,
  fail,
  isRecord,
  parseAssetUrl,
  parseClampedNumber,
  parseColor,
  parseCurve,
  parseFiniteNumber,
  parseGradient,
  parseMinMax,
  parseOptionalCurve,
  parseOptionalGradient,
  parseUnitValue,
  parseVec3,
} from "./schema_parse_common";

function parseParticleOptionalModule<T>(
  raw: unknown,
  build: (record: Record<string, unknown>) => T,
): T | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) return undefined;
  return build(raw);
}

function parseParticleShapeType(
  shapeType: unknown,
  fallback: PrefabParticleShapeType,
): PrefabParticleShapeType {
  if (
    shapeType === "sphere" ||
    shapeType === "hemisphere" ||
    shapeType === "cone" ||
    shapeType === "box" ||
    shapeType === "circle" ||
    shapeType === "edge"
  ) {
    return shapeType;
  }
  return fallback;
}

function parseParticleEmission(
  emissionRaw: Record<string, unknown>,
  burstsRaw: unknown[],
  path: string,
  defaults: ReturnType<typeof createDefaultParticleSystemComponent>,
) {
  if (burstsRaw.length > 16) fail(`${path}.emission.bursts`, "too many bursts (max 16)");
  return {
    rateOverTime: parseClampedNumber(
      emissionRaw.rateOverTime ?? defaults.emission.rateOverTime,
      `${path}.emission.rateOverTime`,
      0,
      10_000,
    ),
    bursts: burstsRaw.map((burst, index) => {
      if (!isRecord(burst)) {
        fail(`${path}.emission.bursts[${index}]`, "expected burst object");
      }
      return {
        time: parseClampedNumber(burst.time, `${path}.emission.bursts[${index}].time`, 0, 600),
        count: parseMinMax(
          burst.count ?? { mode: "constant", value: 8 },
          `${path}.emission.bursts[${index}].count`,
          0,
          2048,
        ),
        cycles:
          burst.cycles === undefined
            ? undefined
            : Math.min(
                1000,
                Math.max(
                  1,
                  Math.floor(
                    parseFiniteNumber(
                      burst.cycles,
                      `${path}.emission.bursts[${index}].cycles`,
                    ),
                  ),
                ),
              ),
        interval:
          burst.interval === undefined
            ? undefined
            : parseClampedNumber(
                burst.interval,
                `${path}.emission.bursts[${index}].interval`,
                0.01,
                60,
              ),
      };
    }),
  };
}

function parseParticleShape(
  shapeRaw: Record<string, unknown>,
  path: string,
  defaults: ReturnType<typeof createDefaultParticleSystemComponent>,
  parsedShapeType: PrefabParticleShapeType,
  emitFrom: "volume" | "shell" | "edge",
) {
  const box = parseVec3(shapeRaw.box ?? defaults.shape.box, `${path}.shape.box`);
  return {
    enabled: shapeRaw.enabled === undefined ? true : Boolean(shapeRaw.enabled),
    shape: parsedShapeType,
    radius: parseClampedNumber(
      shapeRaw.radius ?? defaults.shape.radius,
      `${path}.shape.radius`,
      0,
      500,
    ),
    radiusThickness: parseUnitValue(
      shapeRaw.radiusThickness ?? defaults.shape.radiusThickness,
      `${path}.shape.radiusThickness`,
    ),
    angle: parseClampedNumber(
      shapeRaw.angle ?? defaults.shape.angle,
      `${path}.shape.angle`,
      0,
      180,
    ),
    arc: parseClampedNumber(shapeRaw.arc ?? defaults.shape.arc, `${path}.shape.arc`, 0, 360),
    box: {
      x: Math.min(500, Math.max(0.01, box.x)),
      y: Math.min(500, Math.max(0.01, box.y)),
      z: Math.min(500, Math.max(0.01, box.z)),
    },
    emitFrom,
    alignToDirection: Boolean(shapeRaw.alignToDirection ?? defaults.shape.alignToDirection),
  };
}

function parseParticleOptionalModules(
  value: Record<string, unknown>,
  path: string,
  defaults: ReturnType<typeof createDefaultParticleSystemComponent>,
) {
  return {
    velocityOverLifetime: parseParticleOptionalModule(value.velocityOverLifetime, (raw) => ({
      enabled: Boolean(raw.enabled),
      space: (raw.space === "world" ? "world" : "local") as PrefabParticleSimulationSpace,
      linear: parseVec3(raw.linear ?? { x: 0, y: 0, z: 0 }, `${path}.velocityOverLifetime.linear`),
      orbital: parseVec3(
        raw.orbital ?? { x: 0, y: 0, z: 0 },
        `${path}.velocityOverLifetime.orbital`,
      ),
      radial: parseClampedNumber(
        raw.radial ?? 0,
        `${path}.velocityOverLifetime.radial`,
        -200,
        200,
      ),
    })),
    forceOverLifetime: parseParticleOptionalModule(value.forceOverLifetime, (raw) => ({
      enabled: Boolean(raw.enabled),
      space: (raw.space === "world" ? "world" : "local") as PrefabParticleSimulationSpace,
      force: parseVec3(raw.force ?? { x: 0, y: 0, z: 0 }, `${path}.forceOverLifetime.force`),
    })),
    colorOverLifetime: parseParticleOptionalModule(value.colorOverLifetime, (raw) => ({
      enabled: Boolean(raw.enabled),
      gradient: parseGradient(
        raw.gradient ?? defaults.colorOverLifetime!.gradient,
        `${path}.colorOverLifetime.gradient`,
      ),
    })),
    sizeOverLifetime: parseParticleOptionalModule(value.sizeOverLifetime, (raw) => ({
      enabled: Boolean(raw.enabled),
      curve: parseCurve(
        raw.curve ?? defaults.sizeOverLifetime!.curve,
        `${path}.sizeOverLifetime.curve`,
      ),
    })),
    textureSheetAnimation: parseParticleOptionalModule(value.textureSheetAnimation, (raw) => ({
      enabled: Boolean(raw.enabled),
      tilesX: Math.min(
        16,
        Math.max(1, Math.floor(parseFiniteNumber(raw.tilesX ?? 1, `${path}.textureSheetAnimation.tilesX`))),
      ),
      tilesY: Math.min(
        16,
        Math.max(1, Math.floor(parseFiniteNumber(raw.tilesY ?? 1, `${path}.textureSheetAnimation.tilesY`))),
      ),
      animation: (raw.animation === "single-row" ? "single-row" : "whole-sheet") as
        | "single-row"
        | "whole-sheet",
      cycles: parseClampedNumber(
        raw.cycles ?? 1,
        `${path}.textureSheetAnimation.cycles`,
        0.01,
        64,
      ),
      startFrame: Math.min(
        255,
        Math.max(
          0,
          Math.floor(
            parseFiniteNumber(raw.startFrame ?? 0, `${path}.textureSheetAnimation.startFrame`),
          ),
        ),
      ),
    })),
    collision: parseParticleOptionalModule(value.collision, (raw) => {
      const planesRaw = Array.isArray(raw.planes) ? raw.planes : [];
      if (planesRaw.length > 8) fail(`${path}.collision.planes`, "too many planes (max 8)");
      return {
        enabled: Boolean(raw.enabled),
        type: "planes" as const,
        groundPlane: raw.groundPlane === undefined ? true : Boolean(raw.groundPlane),
        planes: planesRaw.map((plane, index) => {
          if (!isRecord(plane)) {
            fail(`${path}.collision.planes[${index}]`, "expected {point,normal}");
          }
          return {
            point: parseVec3(plane.point, `${path}.collision.planes[${index}].point`),
            normal: parseVec3(plane.normal, `${path}.collision.planes[${index}].normal`),
          };
        }),
        dampen: parseUnitValue(raw.dampen ?? 0.1, `${path}.collision.dampen`),
        bounce: parseUnitValue(raw.bounce ?? 0.3, `${path}.collision.bounce`),
        lifetimeLoss: parseUnitValue(raw.lifetimeLoss ?? 0.1, `${path}.collision.lifetimeLoss`),
        maxKillSpeed: parseClampedNumber(
          raw.maxKillSpeed ?? 100,
          `${path}.collision.maxKillSpeed`,
          0,
          10_000,
        ),
      };
    }),
    trails: parseParticleOptionalModule(value.trails, (raw) => ({
      enabled: Boolean(raw.enabled),
      ratio: parseUnitValue(raw.ratio ?? 0.3, `${path}.trails.ratio`),
      lifetime: parseClampedNumber(raw.lifetime ?? 0.35, `${path}.trails.lifetime`, 0.01, 30),
      minVertexDistance: parseClampedNumber(
        raw.minVertexDistance ?? 0.05,
        `${path}.trails.minVertexDistance`,
        0.001,
        10,
      ),
      widthOverTrail:
        parseOptionalCurve(raw.widthOverTrail, `${path}.trails.widthOverTrail`) ??
        defaults.trails!.widthOverTrail,
      colorOverTrail:
        parseOptionalGradient(raw.colorOverTrail, `${path}.trails.colorOverTrail`) ??
        defaults.trails!.colorOverTrail,
      dieWithParticles:
        raw.dieWithParticles === undefined ? true : Boolean(raw.dieWithParticles),
    })),
  };
}

function parseParticleRenderer(
  rendererRaw: Record<string, unknown>,
  path: string,
  defaults: ReturnType<typeof createDefaultParticleSystemComponent>,
  renderMode: "billboard" | "stretched-billboard" | "horizontal" | "vertical",
  blendMode: "alpha" | "additive",
  sortMode: "none" | "by-distance",
) {
  return {
    renderMode,
    textureUrl:
      rendererRaw.textureUrl === undefined
        ? undefined
        : parseAssetUrl(rendererRaw.textureUrl, `${path}.renderer.textureUrl`),
    blendMode,
    softParticles: Boolean(rendererRaw.softParticles),
    softParticleNearFade: parseClampedNumber(
      rendererRaw.softParticleNearFade ?? defaults.renderer.softParticleNearFade,
      `${path}.renderer.softParticleNearFade`,
      0,
      50,
    ),
    softParticleFarFade: parseClampedNumber(
      rendererRaw.softParticleFarFade ?? defaults.renderer.softParticleFarFade,
      `${path}.renderer.softParticleFarFade`,
      0.01,
      200,
    ),
    lengthScale: parseClampedNumber(
      rendererRaw.lengthScale ?? defaults.renderer.lengthScale,
      `${path}.renderer.lengthScale`,
      0,
      50,
    ),
    speedScale: parseClampedNumber(
      rendererRaw.speedScale ?? defaults.renderer.speedScale,
      `${path}.renderer.speedScale`,
      0,
      10,
    ),
    sortMode,
  };
}

function parseParticleRendererMode(rendererRaw: Record<string, unknown>): {
  renderMode: PrefabParticleRenderMode;
  blendMode: PrefabParticleBlendMode;
  sortMode: PrefabParticleSortMode;
} {
  const renderMode =
    rendererRaw.renderMode === "stretched-billboard" ||
    rendererRaw.renderMode === "horizontal" ||
    rendererRaw.renderMode === "vertical"
      ? rendererRaw.renderMode
      : "billboard";
  const blendMode = rendererRaw.blendMode === "alpha" ? "alpha" : "additive";
  const sortMode = rendererRaw.sortMode === "by-distance" ? "by-distance" : "none";
  return { renderMode, blendMode, sortMode };
}

function parseParticleSystemCoreFields(
  value: Record<string, unknown>,
  path: string,
  defaults: ReturnType<typeof createDefaultParticleSystemComponent>,
  simulationSpace: "local" | "world",
) {
  return {
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    playOnAwake: value.playOnAwake === undefined ? true : Boolean(value.playOnAwake),
    duration: parseClampedNumber(value.duration ?? defaults.duration, `${path}.duration`, 0.01, 600),
    looping: value.looping === undefined ? true : Boolean(value.looping),
    prewarm: value.prewarm === undefined ? false : Boolean(value.prewarm),
    startDelay: parseMinMax(value.startDelay ?? defaults.startDelay, `${path}.startDelay`, 0, 60),
    startLifetime: parseMinMax(
      value.startLifetime ?? defaults.startLifetime,
      `${path}.startLifetime`,
      0.01,
      120,
    ),
    startSpeed: parseMinMax(
      value.startSpeed ?? defaults.startSpeed,
      `${path}.startSpeed`,
      -200,
      200,
    ),
    startSize: parseMinMax(
      value.startSize ?? defaults.startSize,
      `${path}.startSize`,
      0.001,
      50,
    ),
    startColor: parseColor(value.startColor ?? defaults.startColor, `${path}.startColor`),
    startRotation: parseMinMax(
      value.startRotation ?? defaults.startRotation,
      `${path}.startRotation`,
      -3600,
      3600,
    ),
    gravityModifier: parseClampedNumber(
      value.gravityModifier ?? defaults.gravityModifier,
      `${path}.gravityModifier`,
      -20,
      20,
    ),
    simulationSpace,
    maxParticles: Math.min(
      PARTICLE_MAX_PARTICLES_HARD_CAP,
      Math.max(
        1,
        Math.floor(
          parseFiniteNumber(value.maxParticles ?? defaults.maxParticles, `${path}.maxParticles`),
        ),
      ),
    ),
  };
}

export function parseParticleSystemComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent & { type: "particle-system" } {
  const defaults = createDefaultParticleSystemComponent();
  const simulationSpace = value.simulationSpace === "world" ? "world" : "local";
  const emissionRaw = isRecord(value.emission) ? value.emission : {};
  const burstsRaw = Array.isArray(emissionRaw.bursts) ? emissionRaw.bursts : [];
  const shapeRaw = isRecord(value.shape) ? value.shape : {};
  const parsedShapeType = parseParticleShapeType(shapeRaw.shape, defaults.shape.shape);
  const emitFrom =
    shapeRaw.emitFrom === "shell" || shapeRaw.emitFrom === "edge"
      ? shapeRaw.emitFrom
      : "volume";
  const rendererRaw = isRecord(value.renderer) ? value.renderer : {};
  const { renderMode, blendMode, sortMode } = parseParticleRendererMode(rendererRaw);
  const optionalModules = parseParticleOptionalModules(value, path, defaults);

  return {
    type: "particle-system",
    ...parseParticleSystemCoreFields(value, path, defaults, simulationSpace),
    emission: parseParticleEmission(emissionRaw, burstsRaw, path, defaults),
    shape: parseParticleShape(shapeRaw, path, defaults, parsedShapeType, emitFrom),
    ...optionalModules,
    renderer: parseParticleRenderer(rendererRaw, path, defaults, renderMode, blendMode, sortMode),
  };
}
