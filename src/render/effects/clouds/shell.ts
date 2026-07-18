import * as THREE from 'three';
import type { Planet, Vec3 } from '../../../types';
import { CLOUD_LAYER_CONFIGS, phaseFromSeed } from '../../../world/clouds';

interface CloudLayer {
  baseOpacity: number;
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
}

export interface CloudShell {
  dispose: () => void;
  setVisible: (visible: boolean) => void;
  update: (
    bodyPosition: Vec3,
    nowSeconds: number,
    spaceFactor: number,
    altitudeMeters?: number,
    cameraPosition?: Vec3,
  ) => void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number, edge0: number, edge1: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 0.000001));
  return t * t * (3 - 2 * t);
}

/**
 * The coverage noise below is a GLSL port of sampleCloudCoverage /
 * sampleCloudAlpha in src/world/clouds.ts — keep the constants in sync.
 *
 * Coverage is sampled by the direction from the planet center to each dome
 * fragment's sim-space position, not by dome-local uv. The dome still follows
 * the camera (it is sky geometry), but the cloud field is anchored to the
 * planet: banks stay over their geography and slide past as you travel,
 * instead of hovering over your head wherever you go.
 */
const VERTEX_SHADER = /* glsl */ `
varying vec3 vSceneOffset;

void main() {
  vSceneOffset = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uCameraSimPos;
uniform float uInvRenderScale;
uniform float uDriftAngle;
uniform float uScale;
uniform float uPhase;
uniform float uOpacity;
varying vec3 vSceneOffset;

float cloudCoverage(vec3 dir) {
  vec3 p = dir * uScale;
  float continental =
    sin(p.x * 2.8 + p.y * 1.1 + uPhase * 0.7) * 0.48 +
    cos(p.y * 3.2 - p.z * 1.4 - uPhase * 0.4) * 0.30 +
    sin(p.x * 1.6 + p.z * 2.1 + p.y * 1.3 + uPhase * 1.2) * 0.18;
  float billow =
    sin(p.x * 9.2 - p.y * 6.4 + p.z * 4.1 + uPhase * 1.5) * 0.15 +
    cos(p.x * 14.5 + p.y * 8.2 - p.z * 11.3 - uPhase * 0.85) * 0.12 +
    sin(p.x * 22.1 + p.y * 18.4 + p.z * 15.7 + uPhase * 2.1) * 0.07;
  float ridges = 1.0 - abs(
    sin(p.x * 7.1 + p.y * 5.3 + uPhase * 0.55) *
    cos(p.z * 6.8 - p.y * 4.2 - uPhase * 0.95)
  );
  float density = continental * 0.62 + (ridges * 2.0 - 1.0) * 0.18 + billow;
  return clamp((density + 0.28) / 1.18, 0.0, 1.0);
}

void main() {
  vec3 viewDir = normalize(vSceneOffset);
  vec3 camUp = normalize(uCameraSimPos);
  // Soften into the horizon ring so the dome edge doesn't read as a hard cut.
  float elevFade = smoothstep(0.02, 0.12, dot(viewDir, camUp));

  vec3 simPos = uCameraSimPos + vSceneOffset * uInvRenderScale;
  vec3 dir = normalize(simPos);
  // Drift the whole deck around the planet spin axis (Y) over time.
  float driftCos = cos(uDriftAngle);
  float driftSin = sin(uDriftAngle);
  dir = vec3(
    driftCos * dir.x + driftSin * dir.z,
    dir.y,
    driftCos * dir.z - driftSin * dir.x
  );

  float coverage = cloudCoverage(dir);
  // Keep a clear sky/cloud break so patches read as clouds, not a solid wash.
  float cloudAlpha = clamp((coverage - 0.28) / 0.42, 0.0, 1.0);
  float alpha = cloudAlpha * elevFade * uOpacity;
  if (alpha < 0.06) discard;

  // Linear-space equivalents of the old sRGB canvas bake (shade 235..255,
  // blue channel lifted by +12/255).
  vec3 color = vec3(
    mix(0.831, 1.0, cloudAlpha),
    mix(0.831, 1.0, cloudAlpha),
    mix(0.930, 1.0, cloudAlpha)
  );
  gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Camera-centered sky dome. The geometry follows the camera, but coverage is
 * sampled against planet-fixed directions so the pattern is anchored to the
 * world. A full sphere is used (no local-up reorientation); the horizon fade
 * is computed per fragment from the camera's radial up.
 */
export function createCloudShell(
  scene: THREE.Scene,
  _planet: Planet,
  seed: number,
  renderScale: number,
): CloudShell {
  const group = new THREE.Group();
  const layers: CloudLayer[] = [];
  // ~45 km at PLANET_RENDER_SCALE=1/500 — beyond local veg, inside typical tile range.
  const domeRadius = 90;
  const invRenderScale = 1 / renderScale;
  const cameraSimPos = new THREE.Vector3();

  CLOUD_LAYER_CONFIGS.forEach((config, layerIndex) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uCameraSimPos: { value: cameraSimPos },
        uInvRenderScale: { value: invRenderScale },
        uDriftAngle: { value: 0 },
        uScale: { value: config.scale },
        uPhase: { value: phaseFromSeed(seed, layerIndex) },
        uOpacity: { value: 0 },
      },
      // Depth-test so nearby trees/terrain occlude the shell; don't write depth
      // so translucent layers don't fight each other.
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      transparent: true,
    });
    const baseOpacity = Math.min(1, config.opacity);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(domeRadius * (1 + layerIndex * 0.05), 64, 32),
      material,
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = -20;
    group.add(mesh);
    layers.push({ baseOpacity, material, mesh });
  });

  scene.add(group);

  function update(
    bodyPosition: Vec3,
    nowSeconds: number,
    spaceFactor: number,
    altitudeMeters = 0,
    cameraPosition?: Vec3,
  ): void {
    if (cameraPosition) {
      group.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
      // Scene space = (sim - focus) * renderScale, so the camera's sim position
      // is the focus body position plus the scaled scene offset.
      cameraSimPos.set(
        bodyPosition.x + cameraPosition.x * invRenderScale,
        bodyPosition.y + cameraPosition.y * invRenderScale,
        bodyPosition.z + cameraPosition.z * invRenderScale,
      );
    }

    const planetShellStrength = 1.0 - smoothstep01(spaceFactor, 0.55, 0.95);
    const lowAltitudeBoost = 1.0 - smoothstep01(altitudeMeters, 8_000, 24_000);
    const shellStrength = clamp01(planetShellStrength * (0.55 + lowAltitudeBoost * 0.45));
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const config = CLOUD_LAYER_CONFIGS[i];
      layer.material.uniforms.uDriftAngle.value =
        nowSeconds * (config?.rotationRate ?? 0.00004) * 40;
      layer.material.uniforms.uOpacity.value = layer.baseOpacity * shellStrength;
    }
  }

  function dispose(): void {
    for (const layer of layers) {
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
    scene.remove(group);
  }

  return {
    dispose,
    setVisible(visible) {
      group.visible = visible;
    },
    update,
  };
}
