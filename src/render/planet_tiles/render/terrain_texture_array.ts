import * as THREE from 'three';
import { TERRAIN_TEXTURE_LAYER_COUNT } from '../domain/texture_layers';

const LAYER_SIZE = 512;

// Layer order must match TerrainTextureLayer in domain/texture_layers.ts.
const LAYER_SOURCES: { fallbackSrgbHex: number; url: string }[] = [
  {
    fallbackSrgbHex: 0x28639e,
    url: new URL('../../../assets/textures/Water/1/1+_diffuseOriginal.bmp', import.meta.url).href,
  },
  {
    fallbackSrgbHex: 0xd6c697,
    url: new URL('../../../assets/textures/Beach/7/7_diffuseOriginal.bmp', import.meta.url).href,
  },
  {
    fallbackSrgbHex: 0xc2b280,
    url: new URL('../../../assets/textures/Mud/4/4_diffuseOriginal.bmp', import.meta.url).href,
  },
  {
    fallbackSrgbHex: 0x608038,
    url: new URL('../../../assets/textures/Grass/2/2_diffuseOriginal.png', import.meta.url).href,
  },
  {
    fallbackSrgbHex: 0x2d5a27,
    url: new URL('../../../assets/textures/Grass/9/9_diffuseOriginal.bmp', import.meta.url).href,
  },
  {
    fallbackSrgbHex: 0x7f725f,
    url: new URL('../../../assets/textures/Mud/1/1_diffuseOriginal.bmp', import.meta.url).href,
  },
  {
    fallbackSrgbHex: 0xaabcb8,
    url: new URL('../../../assets/textures/Snowy Grass/1/1_diffuseOriginal.bmp', import.meta.url).href,
  },
  {
    fallbackSrgbHex: 0xf2f6f8,
    url: new URL('../../../assets/textures/Snow/1/1_diffuseOriginal.bmp', import.meta.url).href,
  },
];

const srgbToLinearLut = buildSrgbToLinearLut();

function buildSrgbToLinearLut(): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    const linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    lut[i] = Math.round(linear * 255);
  }
  return lut;
}

function fillLayerWithColor(data: Uint8Array, layer: number, srgbHex: number): void {
  const r = srgbToLinearLut[(srgbHex >> 16) & 255];
  const g = srgbToLinearLut[(srgbHex >> 8) & 255];
  const b = srgbToLinearLut[srgbHex & 255];
  const layerOffset = layer * LAYER_SIZE * LAYER_SIZE * 4;
  for (let i = 0; i < LAYER_SIZE * LAYER_SIZE; i += 1) {
    const offset = layerOffset + i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }
}

async function loadLayerPixels(url: string): Promise<Uint8ClampedArray> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch terrain texture ${url}: ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, {
    resizeHeight: LAYER_SIZE,
    resizeQuality: 'high',
    resizeWidth: LAYER_SIZE,
  });
  const canvas = document.createElement('canvas');
  canvas.width = LAYER_SIZE;
  canvas.height = LAYER_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Failed to create 2d context for terrain texture decode');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, LAYER_SIZE, LAYER_SIZE).data;
}

function copyLayerPixels(data: Uint8Array, layer: number, pixels: Uint8ClampedArray): void {
  const layerOffset = layer * LAYER_SIZE * LAYER_SIZE * 4;
  for (let i = 0; i < LAYER_SIZE * LAYER_SIZE; i += 1) {
    const src = i * 4;
    const dst = layerOffset + src;
    // Diffuse maps are authored in sRGB; the array texture is sampled as
    // linear data, so decode on the CPU once.
    data[dst] = srgbToLinearLut[pixels[src]];
    data[dst + 1] = srgbToLinearLut[pixels[src + 1]];
    data[dst + 2] = srgbToLinearLut[pixels[src + 2]];
    data[dst + 3] = 255;
  }
}

// Builds an array texture with one diffuse layer per terrain texture layer.
// Layers start as flat biome colors and are replaced as the images decode.
export function createTerrainTextureArray(): THREE.DataArrayTexture {
  const data = new Uint8Array(LAYER_SIZE * LAYER_SIZE * 4 * TERRAIN_TEXTURE_LAYER_COUNT);
  for (let layer = 0; layer < TERRAIN_TEXTURE_LAYER_COUNT; layer += 1) {
    fillLayerWithColor(data, layer, LAYER_SOURCES[layer].fallbackSrgbHex);
  }

  const texture = new THREE.DataArrayTexture(
    data,
    LAYER_SIZE,
    LAYER_SIZE,
    TERRAIN_TEXTURE_LAYER_COUNT,
  );
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  for (let layer = 0; layer < TERRAIN_TEXTURE_LAYER_COUNT; layer += 1) {
    void loadLayerPixels(LAYER_SOURCES[layer].url)
      .then((pixels) => {
        copyLayerPixels(data, layer, pixels);
        texture.needsUpdate = true;
      })
      .catch((error) => {
        console.error('ClaudeCitizen terrain texture layer failed to load:', error);
      });
  }

  return texture;
}
