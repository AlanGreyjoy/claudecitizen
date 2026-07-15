import type {
  PrefabParticleShape,
  PrefabMinMax,
} from "../../world/prefabs/schema";
import { hash01, sampleMinMax } from "./curves";

export interface SpawnSample {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

function normalize(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

function randomOnSphere(seed: number): { x: number; y: number; z: number } {
  const u = hash01(seed);
  const v = hash01(seed + 1.7);
  const theta = u * Math.PI * 2;
  const z = v * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: r * Math.cos(theta), y: z, z: r * Math.sin(theta) };
}

function applyThickness(radius: number, thickness: number, seed: number): number {
  const inner = radius * (1 - Math.min(1, Math.max(0, thickness)));
  const t = hash01(seed);
  // Volume bias ~ r^3 for spheres; good enough for cones/circles too.
  const u = Math.cbrt(t);
  return inner + (radius - inner) * u;
}

export function sampleEmitterShape(
  shape: PrefabParticleShape,
  seed: number,
): SpawnSample {
  if (!shape.enabled) {
    return { x: 0, y: 0, z: 0, dirX: 0, dirY: 1, dirZ: 0 };
  }

  const arcRad = ((shape.arc || 360) / 360) * Math.PI * 2;
  const angle = hash01(seed) * arcRad;

  switch (shape.shape) {
    case "box": {
      const sx = shape.box.x * 0.5;
      const sy = shape.box.y * 0.5;
      const sz = shape.box.z * 0.5;
      let x = (hash01(seed + 0.1) * 2 - 1) * sx;
      let y = (hash01(seed + 0.2) * 2 - 1) * sy;
      let z = (hash01(seed + 0.3) * 2 - 1) * sz;
      if (shape.emitFrom === "shell" || shape.emitFrom === "edge") {
        const face = Math.floor(hash01(seed + 0.4) * 6);
        if (face === 0) x = -sx;
        else if (face === 1) x = sx;
        else if (face === 2) y = -sy;
        else if (face === 3) y = sy;
        else if (face === 4) z = -sz;
        else z = sz;
      }
      const dir = normalize(x, y + 0.001, z);
      return { x, y, z, dirX: dir.x, dirY: dir.y, dirZ: dir.z };
    }
    case "circle":
    case "edge": {
      const r =
        shape.shape === "edge" || shape.emitFrom === "edge" || shape.emitFrom === "shell"
          ? shape.radius
          : applyThickness(shape.radius, shape.radiusThickness, seed + 0.5);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      return { x, y: 0, z, dirX: 0, dirY: 1, dirZ: 0 };
    }
    case "cone": {
      const half = (shape.angle * Math.PI) / 180;
      const rBase = applyThickness(shape.radius, shape.radiusThickness, seed + 0.6);
      const along = hash01(seed + 0.7);
      const radiusAt = rBase * along;
      const x = Math.cos(angle) * radiusAt;
      const z = Math.sin(angle) * radiusAt;
      const y = along; // unit height cone; direction from apex
      const dirAngle = half * (radiusAt / Math.max(1e-5, shape.radius || 1));
      const dir = normalize(
        Math.cos(angle) * Math.sin(dirAngle),
        Math.cos(dirAngle),
        Math.sin(angle) * Math.sin(dirAngle),
      );
      return { x, y: y * Math.max(shape.radius, 0.01), z, dirX: dir.x, dirY: dir.y, dirZ: dir.z };
    }
    case "hemisphere": {
      let dir = randomOnSphere(seed + 1.1);
      if (dir.y < 0) dir = { x: dir.x, y: -dir.y, z: dir.z };
      const r =
        shape.emitFrom === "shell" || shape.emitFrom === "edge"
          ? shape.radius
          : applyThickness(shape.radius, shape.radiusThickness, seed + 0.8);
      return {
        x: dir.x * r,
        y: dir.y * r,
        z: dir.z * r,
        dirX: dir.x,
        dirY: dir.y,
        dirZ: dir.z,
      };
    }
    case "sphere":
    default: {
      const dir = randomOnSphere(seed + 2.2);
      const r =
        shape.emitFrom === "shell" || shape.emitFrom === "edge"
          ? shape.radius
          : applyThickness(shape.radius, shape.radiusThickness, seed + 0.9);
      return {
        x: dir.x * r,
        y: dir.y * r,
        z: dir.z * r,
        dirX: dir.x,
        dirY: dir.y,
        dirZ: dir.z,
      };
    }
  }
}

export function sampleBurstCount(count: PrefabMinMax, seed: number): number {
  return Math.max(0, Math.floor(sampleMinMax(count, hash01(seed)) + 1e-6));
}
