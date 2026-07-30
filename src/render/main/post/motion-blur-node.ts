import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  cameraFar,
  cameraNear,
  convertToTexture,
  float,
  int,
  logarithmicDepthToViewZ,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

const SAMPLES = 8;
/**
 * A jump this large is a floating-origin rebase or a quantum hop, not motion.
 * Reprojecting across it would smear the whole frame.
 */
const TELEPORT_METERS = 1000;

export interface MainMotionBlurNode {
  node: Node;
  dispose: () => void;
  resize: (width: number, height: number, pixelRatio: number) => void;
  setIntensity: (value: number) => void;
  setMaxVelocity: (value: number) => void;
  updateCamera: (
    camera: THREE.PerspectiveCamera,
    focusPosition: THREE.Vector3,
    renderScale: number,
  ) => void;
  reset: () => void;
}

/**
 * TSL port of `MotionBlurEffect`, including its floating-origin handling.
 *
 * Three's stock velocity blur reprojects against the previous view-projection
 * alone, which is wrong for this engine: the camera sits at the origin and the
 * *world* is shifted underneath it every frame. Without `originShift` the
 * rebase reads as camera motion and the entire frame smears. So this keeps the
 * original's two-part reprojection — matrix delta plus an explicit world shift,
 * faded in past 150 m so near-field geometry is not dragged by the rebase.
 *
 * Depth is linearized with `logarithmicDepthToViewZ` because the gameplay
 * renderer enables `logarithmicDepthBuffer`. The WebGL original selected the
 * same path through its `LOG_DEPTH` define.
 */
export function createMainMotionBlurNode(
  inputNode: Node,
  depthNode: Node,
  renderScale: number,
): MainMotionBlurNode {
  const inputTexture = convertToTexture(inputNode);
  const prevProjectionViewMatrix = uniform(new THREE.Matrix4());
  const projectionMatrixInverse = uniform(new THREE.Matrix4());
  const cameraMatrixWorld = uniform(new THREE.Matrix4());
  const originShift = uniform(new THREE.Vector3());
  const renderScaleUniform = uniform(renderScale);
  const intensity = uniform(1);
  const maxVelocity = uniform(0.05);

  const prevProjView = new THREE.Matrix4();
  const prevFocusPosition = new THREE.Vector3();
  const viewMatrix = new THREE.Matrix4();
  const projViewMatrix = new THREE.Matrix4();
  const shift = new THREE.Vector3();
  let isFirstFrame = true;

  const node = Fn(() => {
    const screenUv = uv();
    const output = vec4(inputTexture.sample(screenUv)).toVar();
    const depth = float(depthNode).toVar();

    // The background does not write depth. Reconstructing a position from the
    // far-plane clear value yields an undefined reprojection — and NaN texture
    // coordinates on some GPUs — which smears one planet pixel across the sky.
    If(depth.lessThan(0.999999), () => {
      const viewZ = logarithmicDepthToViewZ(
        depth,
        cameraNear,
        cameraFar,
      ).toVar();
      const ndc = screenUv.mul(2).sub(1).toVar();
      const viewPos = vec3(
        ndc.x.mul(viewZ.negate()).mul(projectionMatrixInverse[0].x),
        ndc.y.mul(viewZ.negate()).mul(projectionMatrixInverse[1].y),
        viewZ,
      ).toVar();
      const worldPos = cameraMatrixWorld.mul(vec4(viewPos, 1)).xyz.toVar();

      // View depth in metres, so the origin shift only applies to far geometry.
      const depthMeters = viewZ
        .negate()
        .div(renderScaleUniform.max(0.000001))
        .toVar();
      const shiftWeight = smoothstep(150, 300, depthMeters).toVar();
      const worldPosPrev = worldPos.add(originShift.mul(shiftWeight)).toVar();

      const prevClip = prevProjectionViewMatrix
        .mul(vec4(worldPosPrev, 1))
        .toVar();
      const prevNdc = prevClip.xyz.div(prevClip.w.max(0.00001)).toVar();
      const prevUv = prevNdc.xy.mul(0.5).add(0.5).toVar();

      const velocity = screenUv.sub(prevUv).mul(intensity).toVar();
      const speed = velocity.length().toVar();
      If(speed.greaterThan(maxVelocity), () => {
        velocity.assign(velocity.div(speed).mul(maxVelocity));
      });

      If(speed.greaterThanEqual(0.0001), () => {
        const accumulated = vec4(0).toVar();
        Loop(
          { start: int(0), end: int(SAMPLES), type: 'int', condition: '<' },
          ({ i }) => {
            const t = float(i)
              .div(float(SAMPLES - 1))
              .sub(0.5);
            const sampleUv = vec2(screenUv.add(velocity.mul(t))).clamp(0, 1);
            accumulated.addAssign(inputTexture.sample(sampleUv));
          },
        );
        output.assign(accumulated.div(float(SAMPLES)));
      });
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
    setIntensity(value) {
      intensity.value = value;
    },
    setMaxVelocity(value) {
      maxVelocity.value = value;
    },
    updateCamera(camera, focusPosition, nextRenderScale) {
      projectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      cameraMatrixWorld.value.copy(camera.matrixWorld);
      renderScaleUniform.value = nextRenderScale;

      viewMatrix.copy(camera.matrixWorld).invert();
      projViewMatrix.multiplyMatrices(camera.projectionMatrix, viewMatrix);

      if (
        isFirstFrame ||
        focusPosition.distanceTo(prevFocusPosition) > TELEPORT_METERS
      ) {
        prevProjView.copy(projViewMatrix);
        prevFocusPosition.copy(focusPosition);
        isFirstFrame = false;
      }

      shift
        .subVectors(focusPosition, prevFocusPosition)
        .multiplyScalar(nextRenderScale);
      originShift.value.copy(shift);
      prevProjectionViewMatrix.value.copy(prevProjView);

      prevProjView.copy(projViewMatrix);
      prevFocusPosition.copy(focusPosition);
    },
    reset() {
      isFirstFrame = true;
    },
  };
}
