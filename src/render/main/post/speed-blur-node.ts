import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  convertToTexture,
  float,
  int,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';

const SAMPLE_COUNT = 8;

export interface MainSpeedBlurNode {
  node: Node;
  dispose: () => void;
  resize: (width: number, height: number, pixelRatio: number) => void;
  setCenter: (x: number, y: number) => void;
  setStrength: (strength: number) => void;
}

/**
 * TSL port of the current radial `SpeedBlurEffect`.
 *
 * The convolution needs a texture input, so `convertToTexture()` inserts one
 * renderer-owned RTT before the sampling loop. The handle owns that RTT only
 * when Three actually had to allocate one.
 *
 * ## Why the idle-frame RTT is not bypassed
 *
 * The input here is `volumetricFog.node.add(bloomNode)` — arithmetic, not a
 * texture node — so an RTT *is* allocated, and it renders full-res every frame
 * even at strength 0. That cost is real, and three known fixes all fail:
 *
 * - **Read `inputNode` directly on the idle path.** Tried; it black-screens.
 *   `RTTNode.setup()` builds its node under `builder.getSharedContext()`, so
 *   naming the same node again inside this `Fn` builds that subgraph in a
 *   second scope and re-emits every `.toVar()`. The result is a WGSL
 *   `redeclaration of 'cameraPositionUnit'` / `'atmosphereParameters'` in
 *   `fragment_RTT` and an invalid pipeline. Do not retry this.
 * - **Stop the RTT with `autoUpdate = false` when idle.** The shader still
 *   samples that texture at `screenUv` on the idle path, so the frame freezes
 *   on stale contents. Gating the render requires also not reading it.
 * - **Swap the graph when strength crosses zero.** Correct, and what a
 *   `PassNode` swap would mean in practice: `postStack.rebuild()`, which
 *   recompiles the post pipelines. That is a far longer stall than the RTT it
 *   saves, and it would land exactly on quantum entry and exit.
 *
 * Sampling a shrunken RTT while idle was also considered and rejected: it
 * changes what is on screen, which is not a performance decision to make here.
 */
export function createMainSpeedBlurNode(inputNode: Node): MainSpeedBlurNode {
  const inputTexture = convertToTexture(inputNode);
  const strength = uniform(0);
  const center = uniform(new THREE.Vector2(0.5, 0.5));

  const node = Fn(() => {
    const screenUv = uv();
    const output = vec4(inputTexture.sample(screenUv)).toVar();

    If(strength.greaterThan(0), () => {
      const toCenter = center.sub(screenUv);
      const accumulated = vec4(0).toVar();
      const totalWeight = float(0).toVar();

      Loop(
        {
          start: int(0),
          end: int(SAMPLE_COUNT),
          type: 'int',
          condition: '<',
        },
        ({ i }) => {
          const t = float(i).div(SAMPLE_COUNT - 1);
          const sampleUv = vec2(
            screenUv.add(toCenter.mul(strength).mul(t)),
          ).clamp(0, 1);
          const weight = float(1).sub(t.mul(0.5));
          accumulated.addAssign(inputTexture.sample(sampleUv).mul(weight));
          totalWeight.addAssign(weight);
        },
      );

      output.assign(accumulated.div(totalWeight));
    });

    return output;
  })();

  return {
    node,
    dispose() {
      if (inputTexture.isRTTNode) {
        inputTexture.renderTarget?.dispose();
      }
    },
    resize(width, height, pixelRatio) {
      if (!inputTexture.isRTTNode) return;
      inputTexture.setSize(width, height);
      inputTexture.setPixelRatio(pixelRatio);
    },
    setCenter(x, y) {
      center.value.set(x, y);
    },
    setStrength(value) {
      strength.value = Math.max(0, value);
    },
  };
}
