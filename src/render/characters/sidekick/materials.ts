import * as THREE from 'three';
import type { SidekickCatalog } from '../../../player/character_creator/sidekick_manifest';
import { resolveSidekickUrl } from '../../../player/character_creator/sidekick_manifest';
import {
  DEFAULT_SIDEKICK_MATERIAL_EFFECTS,
  type SidekickSerializedColorRow,
  type SidekickSerializedMaterialEffects,
} from '../../../player/character_creator/sidekick_definition';

interface SidekickMaterialConfig {
  maps?: Record<string, string>;
}

interface MutableAtlas {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

export interface SidekickMaterialResources {
  material: THREE.MeshPhysicalMaterial;
  setColors: (rows: readonly SidekickSerializedColorRow[]) => void;
  setMaterialEffects: (effects: SidekickSerializedMaterialEffects) => void;
  getAtlasCellCount: () => number;
  dispose: () => void;
}

export interface SidekickMaterialPixel {
  r: number;
  g: number;
  b: number;
}

const fallbackColor = 0xc8d0dc;

// Retained for definition/config compatibility and diagnostics. Unity's live
// Sidekick graph does not connect its metallic/smoothness atlases to the Lit
// outputs, so the Unity-parity web material deliberately does not use them.
export const SIDEKICK_MAX_METALNESS = 0.72;
export const SIDEKICK_MIN_ROUGHNESS = 0.28;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load Sidekick texture: ${url}`));
    image.src = url;
  });
}

async function loadConfig(url: string): Promise<SidekickMaterialConfig> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to load Sidekick material config (${response.status})`);
  const raw = await response.json() as unknown;
  if (!raw || typeof raw !== 'object')
    throw new Error('Sidekick material config is invalid.');
  return raw as SidekickMaterialConfig;
}

function createAtlas(image: HTMLImageElement | null): MutableAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = image?.naturalWidth || 32;
  canvas.height = image?.naturalHeight || 32;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context)
    throw new Error('Canvas 2D is unavailable for Sidekick atlas colors.');
  context.imageSmoothingEnabled = false;
  if (image) context.drawImage(image, 0, 0, canvas.width, canvas.height);
  else {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, context, texture };
}

function imagePixels(
  image: HTMLImageElement | null,
  width: number,
  height: number,
): Uint8ClampedArray {
  if (!image) return new Uint8ClampedArray(width * height * 4);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context)
    throw new Error('Canvas 2D is unavailable for Sidekick mask textures.');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

function normalizeHex(value: string, fallback: string): string {
  const cleaned = value.replace(/^#/, '').trim();
  return /^[0-9a-f]{6}$/i.test(cleaned) ? cleaned.toUpperCase() : fallback;
}

function hexPixel(value: string): SidekickMaterialPixel {
  const normalized = normalizeHex(value, '000000');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function blendChannel(source: number, target: number, amount: number): number {
  return Math.round(source + ((target - source) * clampUnit(amount)));
}

/** CPU equivalent of the authored Sidekick color-mask stack. */
export function applySidekickMaterialEffectsToPixel(
  base: SidekickMaterialPixel,
  masks: { dark: number; dirt: number; skin: number; eyeEdge: number },
  effects: SidekickSerializedMaterialEffects,
): SidekickMaterialPixel {
  const dark = clampUnit(masks.dark / 255) * clampUnit(effects.darkAmount);
  let result: SidekickMaterialPixel = {
    r: blendChannel(base.r, 0, dark),
    g: blendChannel(base.g, 0, dark),
    b: blendChannel(base.b, 0, dark),
  };

  const dirt = hexPixel(effects.dirtColor);
  const dirtAmount = clampUnit(masks.dirt / 255) * clampUnit(effects.dirtAmount);
  result = {
    r: blendChannel(result.r, dirt.r, dirtAmount),
    g: blendChannel(result.g, dirt.g, dirtAmount),
    b: blendChannel(result.b, dirt.b, dirtAmount),
  };

  const skin = hexPixel(effects.skinColor);
  const skinAmount = clampUnit(masks.skin / 255) * clampUnit(effects.skinColorAmount);
  result = {
    r: blendChannel(result.r, skin.r, skinAmount),
    g: blendChannel(result.g, skin.g, skinAmount),
    b: blendChannel(result.b, skin.b, skinAmount),
  };

  const eyelinerAmount = clampUnit(masks.eyeEdge / 255) * clampUnit(effects.eyelinerAmount);
  return {
    r: blendChannel(result.r, 0, eyelinerAmount),
    g: blendChannel(result.g, 0, eyelinerAmount),
    b: blendChannel(result.b, 0, eyelinerAmount),
  };
}

export function getSidekickAtlasCellRect(
  u: number,
  v: number,
  atlasHeight: number,
): { x: number; y: number; width: 2; height: 2 } {
  return { x: u * 2, y: atlasHeight - (v * 2) - 2, width: 2, height: 2 };
}

function writeCell(atlas: MutableAtlas, u: number, v: number, hex: string): void {
  atlas.context.fillStyle = `#${hex}`;
  const cell = getSidekickAtlasCellRect(u, v, atlas.canvas.height);
  atlas.context.fillRect(cell.x, cell.y, cell.width, cell.height);
}

function unitInterval(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : fallback;
}

export function getSidekickRoughnessByte(
  smoothness: number,
  minRoughness = SIDEKICK_MIN_ROUGHNESS,
): number {
  const source = Math.max(0, Math.min(255, smoothness));
  const floor = unitInterval(minRoughness, SIDEKICK_MIN_ROUGHNESS);
  const minimum = floor * 255;
  return Math.round(minimum + ((255 - source) * (1 - floor)));
}

/**
 * Loads one mutable color atlas per avatar. Unity's active Sidekick graph uses
 * color plus four authored masks; its exported PBR atlases remain available to
 * diagnostics but are intentionally not interpreted as standard Lit maps.
 */
export async function loadSidekickMaterialResources(
  catalog: SidekickCatalog,
): Promise<SidekickMaterialResources> {
  const configUrl = resolveSidekickUrl(
    catalog.assets?.materialConfigUrl ?? 'materials/base-material.json',
  );

  try {
    const config = await loadConfig(configUrl);
    const maps = config.maps ?? {};
    const names = ['color', 'darkMask', 'dirtMask', 'skinMask', 'eyeEdgeMask'] as const;
    const images = await Promise.all(names.map(async (name) => (
      maps[name] ? loadImage(resolveSidekickUrl(maps[name] as string)) : null
    )));
    const sourceAtlas = createAtlas(images[0]);
    const displayAtlas = createAtlas(images[0]);
    const masks = {
      dark: imagePixels(images[1], sourceAtlas.canvas.width, sourceAtlas.canvas.height),
      dirt: imagePixels(images[2], sourceAtlas.canvas.width, sourceAtlas.canvas.height),
      skin: imagePixels(images[3], sourceAtlas.canvas.width, sourceAtlas.canvas.height),
      eyeEdge: imagePixels(images[4], sourceAtlas.canvas.width, sourceAtlas.canvas.height),
    };
    let effects = { ...DEFAULT_SIDEKICK_MATERIAL_EFFECTS };
    let atlasCellCount = 0;

    const material = new THREE.MeshPhysicalMaterial({
      name: 'SidekickUnityMaskMaterial',
      map: displayAtlas.texture,
      metalness: 0,
      roughness: 0.86,
      specularIntensity: 0.35,
    });

    const compose = (): void => {
      const source = sourceAtlas.context.getImageData(
        0,
        0,
        sourceAtlas.canvas.width,
        sourceAtlas.canvas.height,
      );
      const output = new ImageData(
        new Uint8ClampedArray(source.data),
        source.width,
        source.height,
      );
      for (let index = 0; index < source.data.length; index += 4) {
        const pixel = applySidekickMaterialEffectsToPixel({
          r: source.data[index] ?? 0,
          g: source.data[index + 1] ?? 0,
          b: source.data[index + 2] ?? 0,
        }, {
          dark: masks.dark[index] ?? 0,
          dirt: masks.dirt[index] ?? 0,
          skin: masks.skin[index] ?? 0,
          eyeEdge: masks.eyeEdge[index] ?? 0,
        }, effects);
        output.data[index] = pixel.r;
        output.data[index + 1] = pixel.g;
        output.data[index + 2] = pixel.b;
      }
      displayAtlas.context.putImageData(output, 0, 0);
      displayAtlas.texture.needsUpdate = true;
    };

    const propertyById = new Map(catalog.colorProperties.map((property) => [property.id, property]));
    const setColors = (rows: readonly SidekickSerializedColorRow[]): void => {
      atlasCellCount = 0;
      for (const row of rows) {
        const property = propertyById.get(row.colorPropertyId);
        if (!property) continue;
        writeCell(
          sourceAtlas,
          property.u,
          property.v,
          normalizeHex(row.color, 'FFFFFF'),
        );
        atlasCellCount += 1;
      }
      compose();
    };
    const setMaterialEffects = (next: SidekickSerializedMaterialEffects): void => {
      effects = { ...next };
      compose();
    };
    compose();

    return {
      material,
      setColors,
      setMaterialEffects,
      getAtlasCellCount: () => atlasCellCount,
      dispose: () => {
        material.dispose();
        sourceAtlas.texture.dispose();
        displayAtlas.texture.dispose();
      },
    };
  } catch (error) {
    console.warn('[sidekick] Atlas material load failed; using fallback material.', error);
    const material = new THREE.MeshPhysicalMaterial({
      name: 'SidekickFallbackMaterial',
      color: fallbackColor,
      metalness: 0,
      roughness: 0.86,
    });
    return {
      material,
      setColors: () => undefined,
      setMaterialEffects: () => undefined,
      getAtlasCellCount: () => 0,
      dispose: () => material.dispose(),
    };
  }
}
