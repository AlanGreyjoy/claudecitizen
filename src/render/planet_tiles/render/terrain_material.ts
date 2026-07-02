import * as THREE from 'three';
import { TERRAIN_TEXTURE_LAYER_COUNT } from '../domain/texture_layers';

// Distances are in render units (PLANET_RENDER_SCALE = 1/500), so 4..24 units
// is 2..12 km. Beyond the fade the shader falls back to the baked vertex
// colors, which also sidesteps Float32 UV precision limits on coarse tiles.
const TEXTURE_FADE_START_UNITS = 4.0;
const TEXTURE_FADE_END_UNITS = 24.0;

const vertexDeclarations = /* glsl */ `
attribute vec2 terrainUv;
attribute vec4 terrainWeights0;
attribute vec4 terrainWeights1;
varying vec2 vTerrainUv;
varying vec4 vTerrainW0;
varying vec4 vTerrainW1;
varying float vTerrainFade;
`;

const vertexMain = /* glsl */ `
vTerrainUv = terrainUv;
vTerrainW0 = terrainWeights0;
vTerrainW1 = terrainWeights1;
vTerrainFade = clamp(
  (-mvPosition.z - ${TEXTURE_FADE_START_UNITS.toFixed(1)}) /
    (${TEXTURE_FADE_END_UNITS.toFixed(1)} - ${TEXTURE_FADE_START_UNITS.toFixed(1)}),
  0.0,
  1.0
);
`;

const fragmentDeclarations = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray terrainTextures;
varying vec2 vTerrainUv;
varying vec4 vTerrainW0;
varying vec4 vTerrainW1;
varying float vTerrainFade;
`;

const fragmentMain = /* glsl */ `
{
  float terrainLayerWeights[${TERRAIN_TEXTURE_LAYER_COUNT}];
  terrainLayerWeights[0] = vTerrainW0.x;
  terrainLayerWeights[1] = vTerrainW0.y;
  terrainLayerWeights[2] = vTerrainW0.z;
  terrainLayerWeights[3] = vTerrainW0.w;
  terrainLayerWeights[4] = vTerrainW1.x;
  terrainLayerWeights[5] = vTerrainW1.y;
  terrainLayerWeights[6] = vTerrainW1.z;
  terrainLayerWeights[7] = vTerrainW1.w;

  vec3 terrainAlbedo = vec3(0.0);
  float terrainWeightTotal = 0.0;
  for (int layer = 0; layer < ${TERRAIN_TEXTURE_LAYER_COUNT}; layer += 1) {
    float layerWeight = terrainLayerWeights[layer];
    if (layerWeight > 0.003) {
      terrainAlbedo += texture(terrainTextures, vec3(vTerrainUv, float(layer))).rgb * layerWeight;
      terrainWeightTotal += layerWeight;
    }
  }
  if (terrainWeightTotal > 0.0) {
    terrainAlbedo /= terrainWeightTotal;
    diffuseColor.rgb = mix(terrainAlbedo, vColor.rgb, vTerrainFade);
  }
}
`;

export function createTerrainMaterial(textures: THREE.DataArrayTexture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    flatShading: false,
    metalness: 0,
    roughness: 1,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainTextures = { value: textures };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexDeclarations}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${vertexMain}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${fragmentDeclarations}\n#include <common>`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragmentMain}`);
  };
  material.customProgramCacheKey = () => 'claudecitizen-terrain-splat';

  return material;
}
