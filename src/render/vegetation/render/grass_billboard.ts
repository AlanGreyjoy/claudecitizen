import * as THREE from 'three';
import { applyWindToMaterial } from './wind';
import { DEFAULT_GRASS_COLOR } from '../settings';

/**
 * Grass as surface-aligned crossed alpha-cutout cards.
 *
 * Uses the same InstancedMesh transform path as trees (modelViewMatrix *
 * instanceMatrix * position). Custom camera-facing billboard shaders fought the
 * floating-origin renderScale and floated cards into the sky — crossed quads
 * stay planted because Three.js applies the instance matrix normally.
 *
 * Procedural cards paint grayscale blades; authored PNGs are typically white
 * silhouettes. Planet-authored `vegetation.grass.color` tints via material.color.
 */

export interface GrassBillboardVariant {
  height: number;
  width: number;
  bladeCount: number;
  /** Relative shade of white blades for within-card depth (1 = full white). */
  shade: number;
}

const GRASS_VARIANTS: GrassBillboardVariant[] = [
  { height: 0.55, width: 0.45, bladeCount: 5, shade: 0.92 },
  { height: 0.85, width: 0.5, bladeCount: 6, shade: 1 },
  { height: 0.45, width: 0.4, bladeCount: 4, shade: 0.88 },
  { height: 0.95, width: 0.55, bladeCount: 7, shade: 0.96 },
];

function paintGrassCard(
  ctx: CanvasRenderingContext2D,
  size: number,
  variant: GrassBillboardVariant,
): void {
  ctx.clearRect(0, 0, size, size);
  const baseX = size * 0.5;
  const baseY = size * 0.96;
  const tipY = size * (0.96 - variant.height * 0.82);

  for (let i = 0; i < variant.bladeCount; i += 1) {
    const t = (i + 0.5) / variant.bladeCount - 0.5;
    const lean = t * variant.width * size * 0.7;
    const bladeWidth = size * (0.055 + (1 - Math.abs(t)) * 0.04);
    const shade = Math.min(
      1,
      variant.shade * (0.9 + Math.abs(t) * 0.15),
    );
    const channel = Math.round(shade * 255);
    ctx.beginPath();
    ctx.moveTo(baseX + lean * 0.1 - bladeWidth, baseY);
    ctx.quadraticCurveTo(
      baseX + lean * 0.55,
      (baseY + tipY) * 0.55,
      baseX + lean,
      tipY + Math.abs(t) * size * 0.03,
    );
    ctx.quadraticCurveTo(
      baseX + lean * 0.55,
      (baseY + tipY) * 0.55,
      baseX + lean * 0.1 + bladeWidth,
      baseY,
    );
    ctx.closePath();
    ctx.fillStyle = `rgb(${channel},${channel},${channel})`;
    ctx.fill();
  }
}

function createGrassTexture(variant: GrassBillboardVariant): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) paintGrassCard(ctx, size, variant);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

/** Two vertical cards crossed at 90°; pivot at the ground. */
function createCrossedGrassGeometry(width: number, height: number): THREE.BufferGeometry {
  const hw = width * 0.5;
  const positions = new Float32Array([
    // Card in local XY (faces ±Z)
    -hw, 0, 0,
    hw, 0, 0,
    hw, height, 0,
    -hw, height, 0,
    // Card in local ZY (faces ±X)
    0, 0, -hw,
    0, 0, hw,
    0, height, hw,
    0, height, -hw,
  ]);
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Author color pickers allow bright mint/neon hexes. White silhouette maps ×
 * those tints become near-emissive under night ambient + moonlight + bloom.
 * Cap luminance so grass tracks terrain brightness instead of glowing.
 */
const GRASS_ALBEDO_MAX_LUMINANCE = 0.35;

function grassAlbedoFromTint(tintHex: string): THREE.Color {
  const color = new THREE.Color(tintHex);
  const luminance =
    0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  if (luminance > GRASS_ALBEDO_MAX_LUMINANCE && luminance > 1e-6) {
    color.multiplyScalar(GRASS_ALBEDO_MAX_LUMINANCE / luminance);
  }
  return color;
}

function createGrassBillboardMaterial(
  texture: THREE.Texture,
  height: number,
  tintHex: string,
): THREE.MeshLambertMaterial {
  // Lambert (not Basic): unlit cards stayed neon at dusk/night. Standard
  // went near-black outdoors; Lambert follows ambient + sun/moon like terrain.
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    alphaTest: 0.35,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    color: grassAlbedoFromTint(tintHex),
  });
  applyWindToMaterial(material, {
    referenceHeight: height,
    strength: height * 0.12,
    speed: 1.6,
  });
  return material;
}

/** Crossed alpha-cutout cards textured with an authored PNG (or procedural canvas). */
export function createGrassBillboardFromTexture(
  texture: THREE.Texture,
  options?: { height?: number; width?: number; color?: string },
): {
  baseOffsetY: number;
  parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>;
} {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  const image = texture.image as { width?: number; height?: number } | undefined;
  const aspect =
    image?.width && image?.height && image.height > 0
      ? image.width / image.height
      : 0.65;
  const height = options?.height ?? 1.15;
  const width = options?.width ?? Math.max(0.35, height * aspect);
  const tint = options?.color ?? DEFAULT_GRASS_COLOR;
  const geometry = createCrossedGrassGeometry(width, height);
  const material = createGrassBillboardMaterial(texture, height, tint);
  return {
    baseOffsetY: 0,
    parts: [{ geometry, material }],
  };
}

export function createGrassBillboardAssets(color = DEFAULT_GRASS_COLOR): Array<{
  baseOffsetY: number;
  parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>;
}> {
  return GRASS_VARIANTS.map((variant) => {
    // Slightly larger cards so a 1× carpet reads as ground cover, not confetti.
    const height = 0.7 + variant.height * 0.55;
    const width = 0.45 + variant.width * 0.3;
    const texture = createGrassTexture(variant);
    return createGrassBillboardFromTexture(texture, { height, width, color });
  });
}
