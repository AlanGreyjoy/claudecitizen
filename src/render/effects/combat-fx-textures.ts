import * as THREE from 'three';

/**
 * Procedural combat-FX textures.
 *
 * Muzzle flashes, tracers and impacts used untextured additive quads, which
 * read as glowing rectangles. These are canvas-generated instead of shipped
 * art so the effects work in every project, including ones that authored no
 * combat assets, and cost a few KB of VRAM each.
 *
 * Every generator is deterministic (fixed LCG, no `Math.random`) so a texture
 * looks identical across sessions and machines.
 */

const WHITE = 'rgba(255, 255, 255, 1)';
const OPAQUE_MASK = 'rgba(0, 0, 0, 1)';

function createContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('combat-fx textures need a 2D canvas context');
  return context;
}

function finishTexture(context: CanvasRenderingContext2D): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Deterministic 0..1 sequence so generated shapes never shimmer per session. */
function createNoise(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
}

function radialStops(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  stops: readonly [number, string][],
): CanvasGradient {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

/**
 * Cone of flame anchored at the bottom edge (v=0 is the barrel, v=1 the tip),
 * matching the base-anchored plane the muzzle-flash renderer builds.
 */
export function createMuzzleFlashTexture(): THREE.CanvasTexture {
  const size = 128;
  const context = createContext(size, size);
  const baseX = size * 0.5;
  const baseY = size * 0.94;
  const random = createNoise(0x5eed);

  context.globalCompositeOperation = 'lighter';
  // Spikes first so the core burns them out near the barrel.
  context.fillStyle = 'rgba(255, 205, 120, 0.5)';
  for (let index = 0; index < 7; index += 1) {
    const angle = (-Math.PI / 2) + (random() - 0.5) * 2.1;
    const length = size * (0.42 + random() * 0.5);
    const halfWidth = size * (0.02 + random() * 0.035);
    context.beginPath();
    context.moveTo(baseX + Math.cos(angle + Math.PI / 2) * halfWidth,
      baseY + Math.sin(angle + Math.PI / 2) * halfWidth);
    context.lineTo(baseX + Math.cos(angle) * length, baseY + Math.sin(angle) * length);
    context.lineTo(baseX + Math.cos(angle - Math.PI / 2) * halfWidth,
      baseY + Math.sin(angle - Math.PI / 2) * halfWidth);
    context.closePath();
    context.fill();
  }

  // Tapered body: a vertically stretched radial lobe reads as a cone.
  context.save();
  context.translate(baseX, baseY);
  context.scale(0.62, 1);
  context.fillStyle = radialStops(context, 0, 0, size * 0.72, [
    [0, WHITE],
    [0.16, 'rgba(255, 248, 214, 0.95)'],
    [0.42, 'rgba(255, 196, 96, 0.55)'],
    [0.72, 'rgba(255, 130, 40, 0.18)'],
    [1, 'rgba(255, 96, 20, 0)'],
  ]);
  context.fillRect(-size, -size, size * 2, size * 2);
  context.restore();

  // White-hot bloom right at the barrel.
  context.fillStyle = radialStops(context, baseX, baseY, size * 0.2, [
    [0, WHITE],
    [0.5, 'rgba(255, 252, 232, 0.6)'],
    [1, 'rgba(255, 240, 190, 0)'],
  ]);
  context.fillRect(0, 0, size, size);
  return finishTexture(context);
}

/** Soft round falloff. Used for muzzle bloom, tracer heads and hot cores. */
export function createSoftGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const context = createContext(size, size);
  const half = size * 0.5;
  context.fillStyle = radialStops(context, half, half, half, [
    [0, WHITE],
    [0.22, 'rgba(255, 250, 228, 0.82)'],
    [0.5, 'rgba(255, 216, 150, 0.28)'],
    [0.78, 'rgba(255, 170, 80, 0.07)'],
    [1, 'rgba(255, 150, 60, 0)'],
  ]);
  context.fillRect(0, 0, size, size);
  return finishTexture(context);
}

/**
 * Bullet streak: bright at the head (v=1), fading to nothing at the tail
 * (v=0), with soft horizontal edges so the quad never shows a hard border.
 */
export function createTracerStreakTexture(): THREE.CanvasTexture {
  const width = 16;
  const height = 256;
  const context = createContext(width, height);

  const along = context.createLinearGradient(0, 0, 0, height);
  along.addColorStop(0, WHITE);
  along.addColorStop(0.06, 'rgba(255, 244, 206, 0.96)');
  along.addColorStop(0.28, 'rgba(255, 196, 104, 0.5)');
  along.addColorStop(0.62, 'rgba(255, 150, 60, 0.16)');
  along.addColorStop(1, 'rgba(255, 130, 40, 0)');
  context.fillStyle = along;
  context.fillRect(0, 0, width, height);

  const across = context.createLinearGradient(0, 0, width, 0);
  across.addColorStop(0, 'rgba(0, 0, 0, 0)');
  across.addColorStop(0.5, OPAQUE_MASK);
  across.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = across;
  context.fillRect(0, 0, width, height);
  return finishTexture(context);
}

/** Impact spark star: hot core plus thin radiating shards. */
export function createSparkBurstTexture(): THREE.CanvasTexture {
  const size = 128;
  const context = createContext(size, size);
  const half = size * 0.5;
  const random = createNoise(0xb00b);

  context.globalCompositeOperation = 'lighter';
  context.strokeStyle = 'rgba(255, 226, 160, 0.75)';
  context.lineCap = 'round';
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2 + random() * 0.35;
    const length = half * (0.45 + random() * 0.55);
    context.lineWidth = 1 + random() * 2.2;
    context.beginPath();
    context.moveTo(half, half);
    context.lineTo(half + Math.cos(angle) * length, half + Math.sin(angle) * length);
    context.stroke();
  }

  context.fillStyle = radialStops(context, half, half, half * 0.55, [
    [0, WHITE],
    [0.35, 'rgba(255, 246, 214, 0.7)'],
    [1, 'rgba(255, 190, 110, 0)'],
  ]);
  context.fillRect(0, 0, size, size);
  return finishTexture(context);
}

/** Cloudy debris puff, alpha-blended rather than additive. */
export function createSmokePuffTexture(): THREE.CanvasTexture {
  const size = 128;
  const context = createContext(size, size);
  const half = size * 0.5;
  const random = createNoise(0xd0c5);

  for (let index = 0; index < 9; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * half * 0.42;
    const x = half + Math.cos(angle) * distance;
    const y = half + Math.sin(angle) * distance;
    const radius = half * (0.28 + random() * 0.3);
    context.fillStyle = radialStops(context, x, y, radius, [
      [0, 'rgba(255, 255, 255, 0.42)'],
      [0.55, 'rgba(240, 240, 240, 0.2)'],
      [1, 'rgba(220, 220, 220, 0)'],
    ]);
    context.fillRect(0, 0, size, size);
  }

  // Trim to a disc so the quad corners never show.
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = radialStops(context, half, half, half, [
    [0, OPAQUE_MASK],
    [0.68, OPAQUE_MASK],
    [1, 'rgba(0, 0, 0, 0)'],
  ]);
  context.fillRect(0, 0, size, size);
  return finishTexture(context);
}
