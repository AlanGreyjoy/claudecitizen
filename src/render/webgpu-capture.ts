import * as THREE from 'three';
import { RenderTarget, type WebGPURenderer } from 'three/webgpu';

const RGBA_CHANNELS = 4;
const WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256;

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function tightlyPackWebGpuRgba(
  source: ArrayLike<number> & { readonly BYTES_PER_ELEMENT: number },
  width: number,
  height: number,
): Uint8ClampedArray {
  if (source.BYTES_PER_ELEMENT !== 1) {
    throw new Error('WebGPU image capture expected an 8-bit RGBA render target.');
  }

  const tightStride = width * RGBA_CHANNELS;
  const paddedStride = alignTo(tightStride, WEBGPU_BYTES_PER_ROW_ALIGNMENT);
  const tightLength = tightStride * height;
  const paddedLength = (height - 1) * paddedStride + tightStride;
  if (source.length !== tightLength && source.length !== paddedLength) {
    throw new Error(
      `Unexpected WebGPU readback length ${source.length}; expected ${tightLength} or ${paddedLength}.`,
    );
  }

  const sourceStride = source.length === tightLength ? tightStride : paddedStride;
  const output = new Uint8ClampedArray(tightLength);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * sourceStride;
    const outputOffset = y * tightStride;
    for (let x = 0; x < tightStride; x += 1) {
      output[outputOffset + x] = source[sourceOffset + x] ?? 0;
    }
  }
  return output;
}

function unpremultiplyRgba(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += RGBA_CHANNELS) {
    const alpha = pixels[offset + 3] ?? 0;
    if (alpha === 0) {
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      continue;
    }
    if (alpha === 255) continue;
    const scale = 255 / alpha;
    pixels[offset] = Math.round((pixels[offset] ?? 0) * scale);
    pixels[offset + 1] = Math.round((pixels[offset + 1] ?? 0) * scale);
    pixels[offset + 2] = Math.round((pixels[offset + 2] ?? 0) * scale);
  }
}

interface CaptureEncoding {
  mimeType: 'image/png' | 'image/webp' | 'image/jpeg';
  quality?: number;
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  encoding: CaptureEncoding,
): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, encoding.mimeType, encoding.quality);
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The browser returned an invalid image data URL.'));
    });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('The browser could not read the encoded image.'));
    });
    reader.readAsDataURL(blob);
  });
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  encodings: readonly CaptureEncoding[],
): Promise<string> {
  for (const encoding of encodings) {
    let blob: Blob | null = null;
    try {
      blob = await canvasToBlob(canvas, encoding);
    } catch {
      // Try the next explicitly configured encoding.
    }
    // Browsers may silently substitute PNG for an unsupported requested type.
    // Treat that as unsupported so the caller's explicit fallback runs.
    if (blob?.type.toLowerCase() === encoding.mimeType) {
      return blobToDataUrl(blob);
    }
  }
  throw new Error('The browser could not encode the WebGPU capture.');
}

function validateCaptureSize(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid WebGPU capture size ${width}x${height}.`);
  }
}

/**
 * Renders a color-managed WebGPU output target and encodes its readback. The
 * target is intentionally the renderer's output target so the normal
 * tone-mapping and output-color-space pass is included.
 */
async function captureWebGpuDataUrl(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  encodings: readonly CaptureEncoding[],
): Promise<string> {
  validateCaptureSize(width, height);
  const renderTarget = new RenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    // The renderer's output pass encodes sRGB into this byte target. Marking
    // the texture itself sRGB would make WebGPU apply a second conversion.
    colorSpace: THREE.NoColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
  });
  const previousOutputTarget = renderer.getOutputRenderTarget();
  const previousRenderTarget = renderer.getRenderTarget();
  const previousCubeFace = renderer.getActiveCubeFace();
  const previousMipmapLevel = renderer.getActiveMipmapLevel();
  const previousSize = renderer.getSize(new THREE.Vector2());
  const previousPixelRatio = renderer.getPixelRatio();
  const previousViewport = renderer.getViewport(new THREE.Vector4());
  const previousScissor = renderer.getScissor(new THREE.Vector4());
  const previousScissorTest = renderer.getScissorTest();

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissor(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.setRenderTarget(null);
    renderer.setOutputRenderTarget(renderTarget);
    await renderer.renderAsync(scene, camera);

    const readback = await renderer.readRenderTargetPixelsAsync(
      renderTarget,
      0,
      0,
      width,
      height,
    );
    const pixels = tightlyPackWebGpuRgba(readback, width, height);

    // WebGPU copyTextureToBuffer starts at the upper-left texture origin, which
    // already matches ImageData. Do not apply the WebGL readPixels Y-flip.
    // Transparent-target blending stores associated RGB, while ImageData and
    // browser image encoders consume straight alpha, so recover it first.
    unpremultiplyRgba(pixels);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('A 2D canvas is required to encode the WebGPU capture.');
    }
    context.putImageData(
      new ImageData(Uint8ClampedArray.from(pixels), width, height),
      0,
      0,
    );
    return await encodeCanvas(canvas, encodings);
  } finally {
    try {
      renderer.setOutputRenderTarget(previousOutputTarget);
      renderer.setRenderTarget(
        previousRenderTarget,
        previousCubeFace,
        previousMipmapLevel,
      );
      renderer.setPixelRatio(previousPixelRatio);
      renderer.setSize(previousSize.x, previousSize.y, false);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
    } finally {
      renderTarget.dispose();
    }
  }
}

/** Captures transparent prefab art without lossy compression. */
export function captureWebGpuPngDataUrl(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): Promise<string> {
  return captureWebGpuDataUrl(renderer, scene, camera, width, height, [
    { mimeType: 'image/png' },
  ]);
}

/** Matches the asset browser's compact WebP thumbnails, with JPEG fallback. */
export function captureWebGpuThumbnailDataUrl(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): Promise<string> {
  return captureWebGpuDataUrl(renderer, scene, camera, width, height, [
    { mimeType: 'image/webp', quality: 0.82 },
    { mimeType: 'image/jpeg', quality: 0.85 },
  ]);
}
