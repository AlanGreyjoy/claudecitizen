import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

const MotionBlurShader = `
  uniform mat4 uPrevProjectionViewMatrix;
  uniform mat4 uProjectionMatrixInverse;
  uniform mat4 uCameraMatrixWorld;
  uniform vec3 uOriginShift;
  uniform float uRenderScale;
  uniform float uIntensity;
  uniform float uMaxVelocity;

  vec3 viewPosFromDepth(vec2 uv, float d) {
    float viewZ = getViewZ(d);
    float ndcX = uv.x * 2.0 - 1.0;
    float ndcY = uv.y * 2.0 - 1.0;
    return vec3(
      ndcX * -viewZ * uProjectionMatrixInverse[0][0],
      ndcY * -viewZ * uProjectionMatrixInverse[1][1],
      viewZ
    );
  }

  vec3 worldPosFromView(vec3 viewPos) {
    return (uCameraMatrixWorld * vec4(viewPos, 1.0)).xyz;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    // The scene background does not write depth. Reconstructing a position from
    // its far-plane clear value produces an undefined reprojection (and, on
    // some GPUs, a NaN texture coordinate), which can smear one planet pixel
    // across the entire sky while the camera moves.
    if (depth >= 0.999999) {
      outputColor = inputColor;
      return;
    }

    vec3 viewPos = viewPosFromDepth(uv, depth);
    vec3 worldPos = worldPosFromView(viewPos);
    
    // Convert view-space depth to meters to ignore translation-induced blur for near-field objects
    float depthMeters = -viewPos.z / max(uRenderScale, 0.000001);
    float shiftWeight = smoothstep(150.0, 300.0, depthMeters);
    
    vec3 worldPosPrev = worldPos + uOriginShift * shiftWeight;
    
    vec4 prevClipPos = uPrevProjectionViewMatrix * vec4(worldPosPrev, 1.0);
    vec3 prevNdcPos = prevClipPos.xyz / max(prevClipPos.w, 0.00001);
    vec2 prevUv = prevNdcPos.xy * 0.5 + 0.5;
    
    vec2 velocity = (uv - prevUv) * uIntensity;
    
    float speed = length(velocity);
    if (speed > uMaxVelocity) {
      velocity = (velocity / speed) * uMaxVelocity;
    }
    
    if (speed < 0.0001) {
      outputColor = inputColor;
      return;
    }
    
    vec4 accumColor = vec4(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      float t = float(i) / float(SAMPLES - 1) - 0.5;
      vec2 sampleUv = uv + velocity * t;
      sampleUv = clamp(sampleUv, 0.0, 1.0);
      accumColor += texture2D(inputBuffer, sampleUv);
    }
    
    outputColor = accumColor / float(SAMPLES);
  }
`;

export interface MotionBlurOptions {
  useLogarithmicDepth?: boolean;
  samples?: number;
}

export class MotionBlurEffect extends Effect {
  private prevProjViewMatrix = new THREE.Matrix4();
  private prevFocusPosition = new THREE.Vector3();
  private isFirstFrame = true;

  constructor(
    camera: THREE.PerspectiveCamera | null | undefined,
    renderScale: number,
    options: MotionBlurOptions = {}
  ) {
    const defines = new Map<string, string>();
    if (options.useLogarithmicDepth) {
      defines.set('LOG_DEPTH', '1');
    }
    defines.set('SAMPLES', String(Math.max(2, Math.min(32, options.samples ?? 8))));

    super('MotionBlurEffect', MotionBlurShader, {
      attributes: EffectAttribute.DEPTH,
      defines,
      uniforms: new Map<string, THREE.Uniform>([
        ['uPrevProjectionViewMatrix', new THREE.Uniform(new THREE.Matrix4())],
        ['uProjectionMatrixInverse', new THREE.Uniform(new THREE.Matrix4())],
        ['uCameraMatrixWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uOriginShift', new THREE.Uniform(new THREE.Vector3())],
        ['uRenderScale', new THREE.Uniform(renderScale)],
        ['uIntensity', new THREE.Uniform(1.0)],
        ['uMaxVelocity', new THREE.Uniform(0.05)],
      ]),
    });

    if (camera) {
      this.uniforms.get('uProjectionMatrixInverse')!.value.copy(camera.projectionMatrixInverse);
      this.uniforms.get('uCameraMatrixWorld')!.value.copy(camera.matrixWorld);
    }
  }

  updateCamera(
    camera: THREE.PerspectiveCamera,
    focusPosition: THREE.Vector3,
    renderScale: number,
  ): void {
    // 1. Update current camera matrix uniforms
    this.uniforms.get('uProjectionMatrixInverse')!.value.copy(camera.projectionMatrixInverse);
    this.uniforms.get('uCameraMatrixWorld')!.value.copy(camera.matrixWorld);
    this.uniforms.get('uRenderScale')!.value = renderScale;

    // 2. Compute view-projection matrix for the current frame
    const viewMatrix = new THREE.Matrix4().copy(camera.matrixWorld).invert();
    const projViewMatrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, viewMatrix);

    if (this.isFirstFrame || focusPosition.distanceTo(this.prevFocusPosition) > 1000) {
      this.prevProjViewMatrix.copy(projViewMatrix);
      this.prevFocusPosition.copy(focusPosition);
      this.isFirstFrame = false;
    }

    // 3. Compute origin shift: focusPosition_current - focusPosition_prev, scaled by renderScale
    const originShift = new THREE.Vector3()
      .subVectors(focusPosition, this.prevFocusPosition)
      .multiplyScalar(renderScale);
    this.uniforms.get('uOriginShift')!.value.copy(originShift);

    // 4. Set uPrevProjectionViewMatrix uniform
    this.uniforms.get('uPrevProjectionViewMatrix')!.value.copy(this.prevProjViewMatrix);

    // 5. Store state for the next frame
    this.prevProjViewMatrix.copy(projViewMatrix);
    this.prevFocusPosition.copy(focusPosition);
  }

  setIntensity(value: number): void {
    this.uniforms.get('uIntensity')!.value = value;
  }

  setMaxVelocity(value: number): void {
    this.uniforms.get('uMaxVelocity')!.value = value;
  }

  reset(): void {
    this.isFirstFrame = true;
  }
}
