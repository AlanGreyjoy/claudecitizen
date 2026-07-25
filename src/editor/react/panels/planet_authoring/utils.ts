import type { PlanetDocument } from '../../../../world/planets/schema';
import type { PlanetSpawnEntry, VegetationLayerSettings } from '../../../../types';

export function cloneDocument(doc: PlanetDocument): PlanetDocument {
  return structuredClone(doc);
}

export function documentsEqual(
  a: PlanetDocument | null,
  b: PlanetDocument | null,
): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isModelAssetUrl(url: string): boolean {
  return /\.(glb|gltf)(\?|$)/i.test(url);
}

const GRASS_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export function isGrassImageAssetUrl(url: string): boolean {
  const pathname = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  return GRASS_IMAGE_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

export function ensureVegetationLayer(layer: VegetationLayerSettings): void {
  if (!Array.isArray(layer.assetUrls)) {
    layer.assetUrls = [];
  }
}

export function ensureGrassColor(layer: VegetationLayerSettings): void {
  if (
    typeof layer.color !== 'string' ||
    !/^#[0-9a-fA-F]{6}$/.test(layer.color)
  ) {
    layer.color = '#7a9f42';
  }
}

export function nextSpawnLayerId(layers: readonly PlanetSpawnEntry[]): string {
  let n = layers.length + 1;
  const used = new Set(layers.map((layer) => layer.id));
  while (used.has(`spawn-${n}`)) n += 1;
  return `spawn-${n}`;
}
