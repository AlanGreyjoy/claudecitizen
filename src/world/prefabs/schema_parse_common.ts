import type { Vec3 } from '../../types';
import type { Quat } from '../../math/quat';
import type { StationFloorId } from '../station';
import type {
  PrefabColor,
  PrefabComponent,
  PrefabCurve,
  PrefabGradient,
  PrefabMaterialOverride,
  PrefabMinMax,
  PrefabTransform,
  PrefabVec2,
} from './schema';

const STATION_FLOOR_IDS: StationFloorId[] = ["hab", "lobby", "hangar"];

export function fail(path: string, message: string): never {
  throw new Error(`Invalid prefab document at ${path}: ${message}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(path, "expected finite number");
  return value;
}

export function parseString(value: unknown, path: string, maxLength = 256): string {
  if (typeof value !== "string") fail(path, "expected string");
  return value.slice(0, maxLength);
}

export function parseVec3(value: unknown, path: string): Vec3 {
  if (!isRecord(value)) fail(path, "expected {x,y,z}");
  return {
    x: parseFiniteNumber(value.x, `${path}.x`),
    y: parseFiniteNumber(value.y, `${path}.y`),
    z: parseFiniteNumber(value.z, `${path}.z`),
  };
}

export function parseVec2(value: unknown, path: string): PrefabVec2 {
  if (!isRecord(value)) fail(path, "expected {x,z}");
  return {
    x: parseFiniteNumber(value.x, `${path}.x`),
    z: parseFiniteNumber(value.z, `${path}.z`),
  };
}

export function parseQuat(value: unknown, path: string): Quat {
  if (!isRecord(value)) fail(path, "expected {x,y,z,w}");
  return {
    x: parseFiniteNumber(value.x, `${path}.x`),
    y: parseFiniteNumber(value.y, `${path}.y`),
    z: parseFiniteNumber(value.z, `${path}.z`),
    w: parseFiniteNumber(value.w, `${path}.w`),
  };
}

export function parseTransform(value: unknown, path: string): PrefabTransform {
  if (!isRecord(value)) fail(path, "expected transform object");
  return {
    position: parseVec3(value.position, `${path}.position`),
    rotation: parseQuat(value.rotation, `${path}.rotation`),
    scale: parseVec3(value.scale, `${path}.scale`),
  };
}

export function parseFloorId(value: unknown, path: string): StationFloorId {
  if (
    typeof value !== "string" ||
    !STATION_FLOOR_IDS.includes(value as StationFloorId)
  ) {
    fail(path, `expected one of ${STATION_FLOOR_IDS.join(", ")}`);
  }
  return value as StationFloorId;
}

export function parseAssetUrl(value: unknown, path: string): string {
  const url = parseString(value, path, 512);
  if (!url.startsWith("/") || url.includes("..")) {
    fail(path, 'asset url must be an absolute path without ".."');
  }
  return url;
}

export function parseNullableAssetUrl(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  const url = parseString(value, path, 512).trim();
  return url.length === 0 ? null : parseAssetUrl(url, path);
}

export function assertOnlyFields(
  value: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(value).find((field) => !allowed.includes(field));
  if (unknown) fail(`${path}.${unknown}`, "unknown field");
}

export function parseColor(value: unknown, path: string): PrefabColor {
  const color = parseString(value, path, 32);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail(path, "expected CSS hex color");
  return color;
}

export function parseUnitValue(value: unknown, path: string): number {
  return Math.min(1, Math.max(0, parseFiniteNumber(value, path)));
}

export function parseOptionalUnitValue(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : parseUnitValue(value, path);
}

export function parseClampedNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, parseFiniteNumber(value, path)));
}

export function parseMinMax(
  value: unknown,
  path: string,
  min: number,
  max: number,
): PrefabMinMax {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { mode: "constant", value: Math.min(max, Math.max(min, value)) };
  }
  if (!isRecord(value)) fail(path, "expected number or {mode,value}|{mode,min,max}");
  if (value.mode === "random") {
    const lo = parseClampedNumber(value.min, `${path}.min`, min, max);
    const hi = parseClampedNumber(value.max, `${path}.max`, min, max);
    return { mode: "random", min: Math.min(lo, hi), max: Math.max(lo, hi) };
  }
  const constant =
    value.value === undefined
      ? parseClampedNumber(value.constant, `${path}.value`, min, max)
      : parseClampedNumber(value.value, `${path}.value`, min, max);
  return { mode: "constant", value: constant };
}

export function parseCurve(value: unknown, path: string): PrefabCurve {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, "expected non-empty keyframe array");
  }
  if (value.length > 16) fail(path, "too many curve keys (max 16)");
  return value.map((key, index) => {
    if (!isRecord(key)) fail(`${path}[${index}]`, "expected {t,value}");
    return {
      t: parseUnitValue(key.t, `${path}[${index}].t`),
      value: parseFiniteNumber(key.value, `${path}[${index}].value`),
    };
  });
}

export function parseGradient(value: unknown, path: string): PrefabGradient {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, "expected non-empty gradient keyframe array");
  }
  if (value.length > 16) fail(path, "too many gradient keys (max 16)");
  return value.map((key, index) => {
    if (!isRecord(key)) fail(`${path}[${index}]`, "expected {t,color}");
    return {
      t: parseUnitValue(key.t, `${path}[${index}].t`),
      color: parseColor(key.color, `${path}[${index}].color`),
      alpha:
        key.alpha === undefined
          ? undefined
          : parseUnitValue(key.alpha, `${path}[${index}].alpha`),
    };
  });
}

export function parseOptionalCurve(
  value: unknown,
  path: string,
): PrefabCurve | undefined {
  return value === undefined ? undefined : parseCurve(value, path);
}

export function parseOptionalGradient(
  value: unknown,
  path: string,
): PrefabGradient | undefined {
  return value === undefined ? undefined : parseGradient(value, path);
}

export function createDefaultParticleSystemComponent(): PrefabComponent & {
  type: "particle-system";
} {
  return {
    type: "particle-system",
    enabled: true,
    playOnAwake: true,
    duration: 5,
    looping: true,
    prewarm: false,
    startDelay: { mode: "constant", value: 0 },
    startLifetime: { mode: "random", min: 0.8, max: 1.4 },
    startSpeed: { mode: "random", min: 0.4, max: 1.2 },
    startSize: { mode: "random", min: 0.04, max: 0.1 },
    startColor: "#ffe6a8",
    startRotation: { mode: "constant", value: 0 },
    gravityModifier: 0.15,
    simulationSpace: "local",
    maxParticles: 128,
    emission: {
      rateOverTime: 24,
      bursts: [],
    },
    shape: {
      enabled: true,
      shape: "cone",
      radius: 0.15,
      radiusThickness: 1,
      angle: 18,
      arc: 360,
      box: { x: 1, y: 1, z: 1 },
      emitFrom: "volume",
      alignToDirection: true,
    },
    velocityOverLifetime: {
      enabled: false,
      space: "local",
      linear: { x: 0, y: 0, z: 0 },
      orbital: { x: 0, y: 0, z: 0 },
      radial: 0,
    },
    forceOverLifetime: {
      enabled: false,
      space: "local",
      force: { x: 0, y: 0, z: 0 },
    },
    colorOverLifetime: {
      enabled: true,
      gradient: [
        { t: 0, color: "#ffe6a8", alpha: 1 },
        { t: 1, color: "#ff6a2a", alpha: 0 },
      ],
    },
    sizeOverLifetime: {
      enabled: true,
      curve: [
        { t: 0, value: 1 },
        { t: 1, value: 0.2 },
      ],
    },
    textureSheetAnimation: {
      enabled: false,
      tilesX: 1,
      tilesY: 1,
      animation: "whole-sheet",
      cycles: 1,
      startFrame: 0,
    },
    collision: {
      enabled: false,
      type: "planes",
      groundPlane: true,
      planes: [],
      dampen: 0.1,
      bounce: 0.3,
      lifetimeLoss: 0.1,
      maxKillSpeed: 100,
    },
    trails: {
      enabled: false,
      ratio: 0.3,
      lifetime: 0.35,
      minVertexDistance: 0.05,
      widthOverTrail: [
        { t: 0, value: 1 },
        { t: 1, value: 0 },
      ],
      colorOverTrail: [
        { t: 0, color: "#ffe6a8", alpha: 0.8 },
        { t: 1, color: "#ff6a2a", alpha: 0 },
      ],
      dieWithParticles: true,
    },
    renderer: {
      renderMode: "billboard",
      blendMode: "additive",
      softParticles: false,
      softParticleNearFade: 0.2,
      softParticleFarFade: 1.5,
      lengthScale: 1,
      speedScale: 0.05,
      sortMode: "none",
    },
  };
}


export function parseOptionalNonNegativeNumber(
  value: unknown,
  path: string,
  max = 50,
): number | undefined {
  if (value === undefined) return undefined;
  return Math.min(max, Math.max(0, parseFiniteNumber(value, path)));
}

export function parseMaterialOverride(
  value: unknown,
  path: string,
): PrefabMaterialOverride {
  if (!isRecord(value)) fail(path, "expected material override object");
  return {
    material: parseString(value.material, `${path}.material`, 128),
    ...(value.color !== undefined
      ? { color: parseColor(value.color, `${path}.color`) }
      : {}),
    ...(value.emissive !== undefined
      ? { emissive: parseColor(value.emissive, `${path}.emissive`) }
      : {}),
    ...(value.emissiveIntensity !== undefined
      ? {
          emissiveIntensity: parseOptionalNonNegativeNumber(
            value.emissiveIntensity,
            `${path}.emissiveIntensity`,
            20,
          ),
        }
      : {}),
    ...(value.metalness !== undefined
      ? { metalness: parseOptionalUnitValue(value.metalness, `${path}.metalness`) }
      : {}),
    ...(value.roughness !== undefined
      ? { roughness: parseOptionalUnitValue(value.roughness, `${path}.roughness`) }
      : {}),
    ...(value.opacity !== undefined
      ? { opacity: parseOptionalUnitValue(value.opacity, `${path}.opacity`) }
      : {}),
  };
}


export function parseShipDoorTrigger(
  value: unknown,
  path: string,
): "radial" | "raycast" | undefined {
  if (value === undefined) return undefined;
  if (value === "radial" || value === "raycast") return value;
  fail(path, 'expected "radial" or "raycast"');
}
