import * as THREE from 'three';

/**
 * GPU wind sway for instanced vegetation.
 *
 * Materials are patched via onBeforeCompile so the stock MeshStandardMaterial
 * lighting/fog pipeline is preserved. All patched materials share a single
 * time uniform object, so one `updateVegetationWind` call per frame animates
 * every grass blade and tree on screen.
 *
 * Displacement happens in object space (before the instance matrix is
 * applied), so plants bend relative to their own "up" no matter where they
 * sit on the planet. The instance's translation is used only to give each
 * plant a unique sway phase.
 */

export interface WindMaterialOptions {
  /** Max horizontal displacement, in the asset's local units. */
  strength: number;
  /** Local-space height of the asset; sway ramps from 0 at the base to full at this height. */
  referenceHeight: number;
  /** Time multiplier; higher values gust faster. */
  speed?: number;
}

const sharedWindTime: THREE.IUniform<number> = { value: 0 };

const WIND_VERTEX_COMMON = /* glsl */ `
uniform float uWindTime;
uniform float uWindStrength;
uniform float uWindHeightInv;
uniform float uWindSpeed;
`;

const WIND_VERTEX_TRANSFORM = /* glsl */ `
{
  float windBend = clamp(position.y * uWindHeightInv, 0.0, 1.0);
  windBend *= windBend;

  vec3 windRef = vec3(0.0);
  #ifdef USE_INSTANCING
    windRef = instanceMatrix[3].xyz;
  #endif
  float windPhase = dot(windRef, vec3(0.317, 0.171, 0.233));
  float windT = uWindTime * uWindSpeed + windPhase;

  // A few incommensurate sine waves approximate gusty, non-repeating wind.
  float swayX = sin(windT) * 0.55
    + sin(windT * 2.13 + 1.7) * 0.25
    + sin(windT * 0.37 + 4.2) * 0.45;
  float swayZ = cos(windT * 0.79 + 2.3) * 0.5
    + sin(windT * 1.53 + 0.9) * 0.3;

  transformed.x += swayX * windBend * uWindStrength;
  transformed.z += swayZ * windBend * uWindStrength * 0.7;
}
`;

export function applyWindToMaterial(
  material: THREE.Material,
  options: WindMaterialOptions,
): void {
  const referenceHeight = Math.max(options.referenceHeight, 1e-3);
  const windUniforms: Record<string, THREE.IUniform> = {
    uWindHeightInv: { value: 1 / referenceHeight },
    uWindSpeed: { value: options.speed ?? 1 },
    uWindStrength: { value: options.strength },
    uWindTime: sharedWindTime,
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_VERTEX_COMMON}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${WIND_VERTEX_TRANSFORM}`,
      );
  };
  // All wind variants share identical shader code (uniforms carry the
  // per-asset tuning), so they can share one compiled program.
  material.customProgramCacheKey = () => 'vegetation-wind';
}

export function updateVegetationWind(timeSeconds: number): void {
  sharedWindTime.value = timeSeconds;
}
