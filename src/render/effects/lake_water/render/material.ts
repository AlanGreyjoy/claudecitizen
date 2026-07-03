import * as THREE from 'three';

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>

varying vec2 vUv;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewDir = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

uniform float time;
uniform sampler2D normalMap;
uniform sampler2D waterMap;
uniform float waterMapStrength;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform vec3 waterColor;
uniform vec3 skyColor;

varying vec2 vUv;
varying vec3 vViewDir;

vec3 sampleWaveNormal(vec2 uv) {
  vec2 uv0 = uv * 14.0 + vec2(time * 0.045, time * 0.032);
  vec2 uv1 = uv * 21.0 - vec2(time * 0.038, time * 0.027);
  vec4 sample0 = texture2D(normalMap, uv0);
  vec4 sample1 = texture2D(normalMap, uv1);
  vec3 perturbed = vec3(
    (sample0.r + sample1.r) - 1.0,
    (sample0.g + sample1.g) - 1.0,
    0.55
  );
  return normalize(perturbed);
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 viewDir = normalize(vViewDir);
  vec3 normal = sampleWaveNormal(vUv);
  float facing = max(dot(viewDir, normal), 0.0);
  float fresnel = pow(1.0 - facing, 3.0);

  vec2 mapUv = vUv * 7.0 + vec2(time * 0.02, -time * 0.015);
  vec3 mapColor = texture2D(waterMap, mapUv).rgb;
  vec3 baseWaterColor = mix(waterColor, mapColor, waterMapStrength);

  float diffuse = max(dot(sunDirection, normal), 0.0);
  vec3 scatter = baseWaterColor * (0.5 + diffuse * 0.5);

  vec3 halfDir = normalize(sunDirection + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), 96.0);

  vec3 color = mix(scatter, skyColor, fresnel * 0.7);
  color += sunColor * spec * 0.4;

  float alpha = mix(0.84, 0.95, fresnel);
  gl_FragColor = vec4(color, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createWaterNormalTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx =
        Math.sin(x * 0.09) * 0.35 +
        Math.sin(x * 0.021 + y * 0.017) * 0.35 +
        Math.cos(y * 0.08) * 0.2;
      const ny =
        Math.cos(x * 0.07 + y * 0.05) * 0.35 +
        Math.sin(y * 0.023) * 0.35 +
        Math.sin(x * 0.031) * 0.2;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createLakeWaterMaterial(normalMap: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    fog: true,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    uniforms: {
      // fog: true pulls in the fog shader chunks, which read these uniforms
      // whenever scene.fog is a THREE.Fog (true at orbital altitudes where the
      // volumetric fog pass hands back to classic fog). Without them three
      // crashes in refreshFogUniforms.
      fogColor: { value: new THREE.Color(0xffffff) },
      fogDensity: { value: 0.00025 },
      fogFar: { value: 2000 },
      fogNear: { value: 1 },
      normalMap: { value: normalMap },
      skyColor: { value: new THREE.Color(0x7eb8e8) },
      sunColor: { value: new THREE.Color(0xffffff) },
      sunDirection: { value: new THREE.Vector3(0.4, 0.85, 0.2).normalize() },
      time: { value: 0 },
      waterColor: { value: new THREE.Color(0x1a5578) },
      waterMap: { value: normalMap },
      waterMapStrength: { value: 0 },
    },
    vertexShader,
  });
}

const WATER_NORMAL_URL = new URL(
  '../../../../assets/textures/Water/1/1+_normal.bmp',
  import.meta.url,
).href;
const WATER_DIFFUSE_URL = new URL(
  '../../../../assets/textures/Water/1/1+_diffuseOriginal.bmp',
  import.meta.url,
).href;

export interface LakeWaterTextureHandle {
  dispose: () => void;
}

// Swaps the procedural placeholder maps for the authored Water textures once
// they finish loading; until then the material keeps its fallback look.
export function loadLakeWaterTextures(material: THREE.ShaderMaterial): LakeWaterTextureHandle {
  const loader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  let disposed = false;

  loader.load(WATER_NORMAL_URL, (texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    if (disposed) {
      texture.dispose();
      return;
    }
    textures.push(texture);
    material.uniforms.normalMap.value = texture;
  });

  loader.load(WATER_DIFFUSE_URL, (texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    if (disposed) {
      texture.dispose();
      return;
    }
    textures.push(texture);
    material.uniforms.waterMap.value = texture;
    material.uniforms.waterMapStrength.value = 0.45;
  });

  return {
    dispose() {
      disposed = true;
      for (const texture of textures) texture.dispose();
      textures.length = 0;
    },
  };
}
