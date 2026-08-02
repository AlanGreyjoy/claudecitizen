import * as THREE from 'three';
import type { PlanetMoonRecipe } from '../../../world/planets/sky-schema';

/**
 * Procedural equirectangular moon albedo map.
 *
 * Takram's `MoonNode` samples `colorNode` with `equirectUV(normalMoonFixed)`
 * and shades it with an Oren–Nayar term against the sun, so the phase, the
 * terminator, and the limb all come out of the atmosphere solver — all this
 * texture has to supply is believable ground: bright highlands, dark maria,
 * and craters.
 *
 * Craters are placed as unit directions and then projected, so the ellipse is
 * stretched by 1/cos(latitude) and the field stays uniform instead of piling
 * up at the poles the way naive UV-space placement does.
 */

const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 512;
/**
 * Maria are generated at a quarter resolution and scaled up.
 *
 * This runs on the main thread during renderer construction, and the per-pixel
 * fBm is ~32 hashes deep: at full size that is a visible hitch for detail the
 * upscale filter reproduces anyway, because maria are low-frequency by nature.
 * Craters still draw at full resolution, so rims stay crisp.
 */
const MARIA_WIDTH = 256;
const MARIA_HEIGHT = 128;
const CRATER_BUDGET = 420;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = (h ^ Math.imul(z | 0, 2147483647) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Trilinear value noise — enough structure for maria without a full simplex. */
function valueNoise3(
  x: number,
  y: number,
  z: number,
  seed: number,
): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const fz = smoothstep(z - iz);
  let result = 0;
  for (let dz = 0; dz <= 1; dz += 1) {
    const wz = dz === 0 ? 1 - fz : fz;
    for (let dy = 0; dy <= 1; dy += 1) {
      const wy = dy === 0 ? 1 - fy : fy;
      for (let dx = 0; dx <= 1; dx += 1) {
        const wx = dx === 0 ? 1 - fx : fx;
        result += hash3(ix + dx, iy + dy, iz + dz, seed) * wx * wy * wz;
      }
    }
  }
  return result;
}

function fbm3(x: number, y: number, z: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    sum +=
      valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave) *
      amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum;
}

function buildMariaImage(recipe: PlanetMoonRecipe): ImageData {
  // Read as raw sRGB, not converted to the working space: these bytes go
  // straight into a canvas that is tagged `SRGBColorSpace`, so three does the
  // conversion at sample time. Using linear values here would render a moon
  // roughly half as bright as the authored color.
  const highland = new THREE.Color().setStyle(
    recipe.color,
    THREE.LinearSRGBColorSpace,
  );
  const maria = new THREE.Color().setStyle(
    recipe.mariaColor,
    THREE.LinearSRGBColorSpace,
  );
  const image = new ImageData(MARIA_WIDTH, MARIA_HEIGHT);
  const { data } = image;
  const blend = new THREE.Color();
  // Coverage picks the noise threshold: 0 leaves pure highland, 1 floods maria.
  const threshold = 1 - recipe.mariaCoverage;
  for (let py = 0; py < MARIA_HEIGHT; py += 1) {
    const latitude = (0.5 - (py + 0.5) / MARIA_HEIGHT) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    const dy = Math.sin(latitude);
    for (let px = 0; px < MARIA_WIDTH; px += 1) {
      const longitude = ((px + 0.5) / MARIA_WIDTH) * Math.PI * 2;
      const dx = cosLatitude * Math.cos(longitude);
      const dz = cosLatitude * Math.sin(longitude);
      const broad = fbm3(dx * 1.9, dy * 1.9, dz * 1.9, recipe.surfaceSeed);
      const grain = fbm3(dx * 11, dy * 11, dz * 11, recipe.surfaceSeed + 91);
      const mariaMask = Math.max(
        0,
        Math.min(1, (broad - threshold * 0.62) / 0.16),
      );
      blend.copy(highland).lerp(maria, mariaMask);
      // Regolith mottling keeps the highlands from reading as flat plastic.
      const mottle = 0.88 + grain * 0.24;
      const offset = (py * MARIA_WIDTH + px) * 4;
      data[offset] = Math.min(255, blend.r * mottle * 255);
      data[offset + 1] = Math.min(255, blend.g * mottle * 255);
      data[offset + 2] = Math.min(255, blend.b * mottle * 255);
      data[offset + 3] = 255;
    }
  }
  return image;
}

function paintMaria(
  context: CanvasRenderingContext2D,
  recipe: PlanetMoonRecipe,
): void {
  const source = document.createElement('canvas');
  source.width = MARIA_WIDTH;
  source.height = MARIA_HEIGHT;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) return;
  sourceContext.putImageData(buildMariaImage(recipe), 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
}

function paintCrater(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  strength: number,
): void {
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${0.26 * strength})`);
  gradient.addColorStop(0.62, `rgba(0, 0, 0, ${0.16 * strength})`);
  gradient.addColorStop(0.82, `rgba(255, 255, 255, ${0.2 * strength})`);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.save();
  context.translate(centerX, centerY);
  context.scale(radiusX, radiusY);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function paintCraters(
  context: CanvasRenderingContext2D,
  recipe: PlanetMoonRecipe,
): void {
  const random = mulberry32(recipe.surfaceSeed * 2654435761);
  const count = Math.round(CRATER_BUDGET * recipe.crateredness);
  for (let i = 0; i < count; i += 1) {
    // Uniform on the sphere: latitude from asin, not a flat UV pick.
    const latitude = Math.asin(random() * 2 - 1);
    const longitude = random() * Math.PI * 2;
    // Power law: many small craters, a handful of basins.
    const size = 0.0035 + Math.pow(random(), 3.4) * 0.075;
    const radiusY = size * TEXTURE_HEIGHT;
    const cosLatitude = Math.max(Math.cos(latitude), 0.08);
    const radiusX = (size * TEXTURE_WIDTH) / (2 * cosLatitude);
    const centerX = (longitude / (Math.PI * 2)) * TEXTURE_WIDTH;
    const centerY = (0.5 - latitude / Math.PI) * TEXTURE_HEIGHT;
    const strength = 0.5 + random() * 0.5;
    paintCrater(context, centerX, centerY, radiusX, radiusY, strength);
    // Wrap the seam so craters straddling u=0 are not cut in half.
    if (centerX < radiusX) {
      paintCrater(context, centerX + TEXTURE_WIDTH, centerY, radiusX, radiusY, strength);
    } else if (centerX > TEXTURE_WIDTH - radiusX) {
      paintCrater(context, centerX - TEXTURE_WIDTH, centerY, radiusX, radiusY, strength);
    }
  }
}

/** Builds the moon albedo map for `recipe`. Callers own `dispose()`. */
export function createMoonSurfaceTexture(
  recipe: PlanetMoonRecipe,
): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) {
    // Headless or a lost 2D context: a flat disc still beats no moon at all.
    const fallback = new THREE.DataTexture(
      new Uint8Array([220, 216, 204, 255]),
      1,
      1,
    );
    fallback.colorSpace = THREE.SRGBColorSpace;
    fallback.needsUpdate = true;
    return fallback;
  }
  // Base fill first: `paintMaria` bails if the offscreen 2D context is lost,
  // and a transparent canvas would read as a hole in the sky.
  context.fillStyle = recipe.color;
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  paintMaria(context, recipe);
  paintCraters(context, recipe);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Moon Surface';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}
