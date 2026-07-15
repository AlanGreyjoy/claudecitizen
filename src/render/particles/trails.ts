import * as THREE from "three";
import type { PrefabParticleTrails } from "../../world/prefabs/schema";
import { sampleCurve, sampleGradient } from "./curves";

const MAX_TRAIL_POINTS = 24;

interface TrailState {
  active: boolean;
  points: Float32Array;
  ages: Float32Array;
  count: number;
  write: number;
}

export interface ParticleTrailsController {
  object3d: THREE.Object3D;
  reset: () => void;
  beginFrame: () => void;
  pushPoint: (
    particleIndex: number,
    hasTrail: boolean,
    x: number,
    y: number,
    z: number,
    alive: boolean,
  ) => void;
  endFrame: (dt: number) => void;
  dispose: () => void;
  applyConfig: (trails: PrefabParticleTrails | undefined) => void;
}

export function createParticleTrails(
  maxParticles: number,
  trails: PrefabParticleTrails | undefined,
): ParticleTrailsController {
  let config = trails;
  const group = new THREE.Group();
  group.name = "particle-trails";

  const positions = new Float32Array(maxParticles * MAX_TRAIL_POINTS * 3);
  const colors = new Float32Array(maxParticles * MAX_TRAIL_POINTS * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geometry.setDrawRange(0, 0);

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  group.add(lines);

  const states: TrailState[] = Array.from({ length: maxParticles }, () => ({
    active: false,
    points: new Float32Array(MAX_TRAIL_POINTS * 3),
    ages: new Float32Array(MAX_TRAIL_POINTS),
    count: 0,
    write: 0,
  }));

  let drawCount = 0;

  const reset = () => {
    for (const state of states) {
      state.active = false;
      state.count = 0;
      state.write = 0;
    }
    geometry.setDrawRange(0, 0);
  };

  return {
    object3d: group,
    reset,
    beginFrame() {
      drawCount = 0;
    },
    pushPoint(particleIndex, hasTrail, x, y, z, alive) {
      if (!config?.enabled || !hasTrail) return;
      const state = states[particleIndex];
      if (!state) return;
      if (!alive) {
        if (config.dieWithParticles) {
          state.active = false;
          state.count = 0;
          state.write = 0;
        }
        return;
      }

      if (!state.active) {
        state.active = true;
        state.count = 0;
        state.write = 0;
      }

      const last =
        state.count > 0
          ? ((state.write - 1 + MAX_TRAIL_POINTS) % MAX_TRAIL_POINTS) * 3
          : -1;
      if (last >= 0) {
        const dx = x - state.points[last];
        const dy = y - state.points[last + 1];
        const dz = z - state.points[last + 2];
        if (Math.hypot(dx, dy, dz) < config.minVertexDistance) return;
      }

      const idx = state.write * 3;
      state.points[idx] = x;
      state.points[idx + 1] = y;
      state.points[idx + 2] = z;
      state.ages[state.write] = 0;
      state.write = (state.write + 1) % MAX_TRAIL_POINTS;
      state.count = Math.min(MAX_TRAIL_POINTS, state.count + 1);
    },
    endFrame(dt) {
      if (!config?.enabled) {
        geometry.setDrawRange(0, 0);
        group.visible = false;
        return;
      }
      group.visible = true;
      let out = 0;
      for (let p = 0; p < states.length; p += 1) {
        const state = states[p];
        if (!state.active || state.count < 2) continue;
        for (let i = 0; i < state.count; i += 1) {
          const ageIndex = (state.write - 1 - i + MAX_TRAIL_POINTS * 4) % MAX_TRAIL_POINTS;
          state.ages[ageIndex] += dt;
        }
        // Rebuild as consecutive line segments from newest to oldest.
        const ordered: number[] = [];
        for (let i = 0; i < state.count; i += 1) {
          const idx = (state.write - 1 - i + MAX_TRAIL_POINTS * 4) % MAX_TRAIL_POINTS;
          if (state.ages[idx] > config.lifetime) break;
          ordered.push(idx);
        }
        for (let i = 0; i < ordered.length - 1; i += 1) {
          const a = ordered[i];
          const b = ordered[i + 1];
          const tA = Math.min(1, state.ages[a] / Math.max(1e-5, config.lifetime));
          const tB = Math.min(1, state.ages[b] / Math.max(1e-5, config.lifetime));
          const colorA = sampleGradient(config.colorOverTrail, tA);
          const colorB = sampleGradient(config.colorOverTrail, tB);
          // width curve reserved for future ribbon trails; modulate alpha for now
          const widthA = sampleCurve(config.widthOverTrail, tA);
          const widthB = sampleCurve(config.widthOverTrail, tB);

          const a3 = a * 3;
          const b3 = b * 3;
          const o = out * 3;
          positions[o] = state.points[a3];
          positions[o + 1] = state.points[a3 + 1];
          positions[o + 2] = state.points[a3 + 2];
          positions[o + 3] = state.points[b3];
          positions[o + 4] = state.points[b3 + 1];
          positions[o + 5] = state.points[b3 + 2];

          const c = out * 4;
          colors[c] = colorA.r;
          colors[c + 1] = colorA.g;
          colors[c + 2] = colorA.b;
          colors[c + 3] = colorA.a * widthA;
          colors[c + 4] = colorB.r;
          colors[c + 5] = colorB.g;
          colors[c + 6] = colorB.b;
          colors[c + 7] = colorB.a * widthB;
          out += 2;
        }
      }
      drawCount = out;
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.setDrawRange(0, drawCount);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
    applyConfig(next) {
      config = next;
      if (!next?.enabled) reset();
    },
  };
}
