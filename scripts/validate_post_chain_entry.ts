/**
 * Browser-side half of the post-chain bisect. Bundled by
 * scripts/validate_post_chain.mjs.
 *
 * `validate_atmosphere_sky.mjs` proved the atmosphere hands a bright sky
 * (~1.25e4 physical radiance) to the post stack, and that the depth at sky
 * pixels is exactly 1.0. Yet the shipped frame is black there while lit terrain
 * — same chain, different depth — survives.
 *
 * So this feeds that exact constant through the gameplay post nodes in the
 * gameplay order, at `depth = 1`, reporting the value after each. The first
 * stage that collapses it is the bug.
 */
import * as THREE from 'three';
import { PostProcessing, WebGPURenderer, type Node } from 'three/webgpu';
import {
  float,
  toneMapping,
  toneMappingExposure,
  vec4,
  workingToColorSpace,
} from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';
import { createMainColorCorrectionNode } from '../src/render/main/post/color-correction-node';
import { createMainSpeedBlurNode } from '../src/render/main/post/speed-blur-node';
import { createMainVignetteNode } from '../src/render/main/post/vignette-node';
import { createMainVolumetricFogNode } from '../src/render/main/post/volumetric-fog-node';
import type { Planet } from '../src/types';

/** Measured sky radiance out of the atmosphere, from validate_atmosphere_sky. */
const SKY_RADIANCE = new THREE.Vector3(12503.63, 12550.1, 12256.23);
const PLANET_RENDER_SCALE = 1 / 500;
const SIZE = 64;

const PLANET: Planet = {
  atmosphereHeightMeters: 110_000,
  radiusMeters: 6_371_000,
  terrainAmplitudeMeters: 7_500,
};

export interface ChainStage {
  name: string;
  r: number;
  g: number;
  b: number;
  luminance: number;
  collapsed: boolean;
}

export interface PostChainResult {
  ok: boolean;
  error?: string;
  adapter?: string;
  stages?: ChainStage[];
}

interface Disposable {
  dispose?: () => void;
}

/**
 * Builds the chain up to and including `upto`, mirroring webgpu-post-stack.ts.
 * Rebuilt per stage rather than tapped mid-graph because TSL nodes cache their
 * built form, and reusing one across stages would measure the wrong thing.
 */
function buildChain(upto: number): { node: Node; dispose: () => void } {
  const disposables: Disposable[] = [];
  const depth = float(1);
  let color: Node = vec4(SKY_RADIANCE.x, SKY_RADIANCE.y, SKY_RADIANCE.z, 1);
  if (upto === 0) return { node: color, dispose: () => undefined };

  const fog = createMainVolumetricFogNode(color, depth, PLANET, PLANET_RENDER_SCALE);
  disposables.push(fog as Disposable);
  if (upto >= 1) color = fog.node;
  if (upto === 1) return finish(color, disposables);

  const bloomNode = bloom(color, 0.6, 0.4, 0.85);
  disposables.push(bloomNode as unknown as Disposable);
  if (upto >= 2) color = color.add(bloomNode);
  if (upto === 2) return finish(color, disposables);

  const speedBlur = createMainSpeedBlurNode(color);
  disposables.push(speedBlur as Disposable);
  if (upto >= 3) color = speedBlur.node;
  if (upto === 3) return finish(color, disposables);

  // Mirrors the real stack's ToneMappingNode workaround: take .rgb only, carry
  // alpha from a known-vec4 var.
  const preLens = vec4(color).toVar();
  const toneMapped = toneMapping(THREE.AgXToneMapping, toneMappingExposure, preLens);
  if (upto >= 4) color = vec4(toneMapped.rgb, preLens.a);
  if (upto === 4) return finish(color, disposables);

  const colorCorrection = createMainColorCorrectionNode(color);
  disposables.push(colorCorrection as Disposable);
  if (upto >= 5) color = colorCorrection.node;
  if (upto === 5) return finish(color, disposables);

  const vignette = createMainVignetteNode(color, { darkness: 0.28, offset: 0.3 });
  disposables.push(vignette as Disposable);
  if (upto >= 6) color = vignette.node;
  if (upto === 6) return finish(color, disposables);

  if (upto >= 7) color = workingToColorSpace(color, THREE.SRGBColorSpace);
  if (upto === 7) return finish(color, disposables);

  const smaaNode = smaa(color);
  disposables.push(smaaNode as unknown as Disposable);
  color = smaaNode;
  return finish(color, disposables);
}

function finish(
  node: Node,
  disposables: Disposable[],
): { node: Node; dispose: () => void } {
  return {
    node,
    dispose() {
      for (const entry of disposables) entry.dispose?.();
    },
  };
}

const STAGE_NAMES = [
  'atmosphere output (constant)',
  '+ volumetric fog',
  '+ bloom',
  '+ speed blur',
  '+ AgX tone mapping',
  '+ colour correction',
  '+ vignette',
  '+ working -> sRGB',
  '+ SMAA',
];

export async function run(): Promise<PostChainResult> {
  if (!navigator.gpu) return { ok: false, error: 'navigator.gpu undefined' };
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) return { ok: false, error: 'requestAdapter() returned null' };
  const info = adapter.info ?? ({} as Record<string, string>);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    logarithmicDepthBuffer: true,
  });
  await renderer.init();
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const target = new THREE.RenderTarget(SIZE, SIZE, { type: THREE.FloatType });
  const stages: ChainStage[] = [];

  try {
    for (let upto = 0; upto < STAGE_NAMES.length; upto += 1) {
      const chain = buildChain(upto);
      const postProcessing = new PostProcessing(renderer);
      postProcessing.outputColorTransform = false;
      postProcessing.outputNode = chain.node;

      renderer.setRenderTarget(target);
      for (let frame = 0; frame < 6; frame += 1) {
        postProcessing.render();
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      const pixels = (await renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        SIZE,
        SIZE,
      )) as unknown as Float32Array;
      renderer.setRenderTarget(null);

      // Centre pixel: vignette darkens the edges by design, so an edge sample
      // would look like a collapse when it is the intended effect.
      const index = (Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2)) * 4;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      stages.push({
        b,
        collapsed: luminance < 1e-4,
        g,
        luminance,
        name: STAGE_NAMES[upto],
        r,
      });

      postProcessing.dispose();
      chain.dispose();
    }
  } catch (error) {
    return {
      ok: false,
      error: `${(error as Error).message} (completed ${stages.length} stages)`,
      stages,
    };
  } finally {
    target.dispose();
    renderer.dispose();
  }

  return {
    adapter: `${info.vendor ?? '?'}/${info.architecture ?? '?'}`,
    ok: true,
    stages,
  };
}
