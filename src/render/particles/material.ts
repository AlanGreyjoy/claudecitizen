import * as THREE from "three";
import type {
  PrefabParticleBlendMode,
  PrefabParticleRenderMode,
} from "../../world/prefabs/schema";

const VERTEX_SHADER = /* glsl */ `
attribute vec3 instanceColorAttr;
attribute float instanceAlpha;
attribute vec2 instanceTileOffset;
attribute vec2 instanceTileScale;
attribute float instanceStretch;

uniform float uSoftNear;
uniform float uSoftFar;
uniform int uSoftEnabled;
uniform int uRenderMode;
uniform vec2 uTileScale;

varying vec4 vColor;
varying vec2 vUv;
varying float vViewZ;

void main() {
  vColor = vec4(instanceColorAttr, instanceAlpha);
  vUv = uv * instanceTileScale + instanceTileOffset;

  float sx = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  float sy = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

  vec3 right;
  vec3 up;
  if (uRenderMode == 2) {
    // horizontal
    right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    up = vec3(0.0, 1.0, 0.0);
  } else if (uRenderMode == 3) {
    // vertical
    right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    up = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  } else {
    // billboard / stretched — camera facing
    right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  }

  float stretch = uRenderMode == 1 ? max(instanceStretch, 1.0) : 1.0;
  vec3 local = position;
  local.y *= stretch;
  vec3 worldOffset = right * local.x * sx + up * local.y * sy;
  mvPosition.xyz += worldOffset;

  vViewZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
uniform int uHasMap;
uniform int uSoftEnabled;
uniform float uSoftNear;
uniform float uSoftFar;
uniform float uCameraNear;
uniform float uCameraFar;
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform int uAdditive;

varying vec4 vColor;
varying vec2 vUv;
varying float vViewZ;

float linearizeDepth(float depth) {
  float z = depth * 2.0 - 1.0;
  return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
}

void main() {
  vec4 tex = uHasMap == 1 ? texture2D(uMap, vUv) : vec4(1.0);
  float alpha = tex.a * vColor.a;
  vec3 rgb = tex.rgb * vColor.rgb;

  if (uSoftEnabled == 1) {
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    float sceneDepth = linearizeDepth(texture2D(uDepth, screenUv).r);
    float soft = smoothstep(uSoftNear, uSoftFar, sceneDepth - vViewZ);
    alpha *= soft;
  }

  if (alpha < 0.01) discard;
  if (uAdditive == 1) {
    gl_FragColor = vec4(rgb * alpha, alpha);
  } else {
    gl_FragColor = vec4(rgb, alpha);
  }
}
`;

export interface ParticleMaterialOptions {
  blendMode: PrefabParticleBlendMode;
  renderMode: PrefabParticleRenderMode;
  softParticles: boolean;
  softNear: number;
  softFar: number;
  map?: THREE.Texture | null;
  depthTexture?: THREE.Texture | null;
}

export function createParticleMaterial(
  options: ParticleMaterialOptions,
): THREE.ShaderMaterial {
  const renderMode =
    options.renderMode === "stretched-billboard"
      ? 1
      : options.renderMode === "horizontal"
        ? 2
        : options.renderMode === "vertical"
          ? 3
          : 0;

  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending:
      options.blendMode === "additive"
        ? THREE.AdditiveBlending
        : THREE.NormalBlending,
    uniforms: {
      uMap: { value: options.map ?? null },
      uHasMap: { value: options.map ? 1 : 0 },
      uSoftEnabled: {
        value: options.softParticles && options.depthTexture ? 1 : 0,
      },
      uSoftNear: { value: options.softNear },
      uSoftFar: { value: options.softFar },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 2000 },
      uDepth: { value: options.depthTexture ?? null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uAdditive: { value: options.blendMode === "additive" ? 1 : 0 },
      uRenderMode: { value: renderMode },
      uTileScale: { value: new THREE.Vector2(1, 1) },
    },
  });
}

export function createDefaultParticleTexture(): THREE.Texture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const cx = (size - 1) * 0.5;
  const cy = (size - 1) * 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const core = Math.exp(-d * d * 4.5);
      const i = (y * size + x) * 4;
      const v = Math.min(255, Math.floor(core * 255));
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = v;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}
