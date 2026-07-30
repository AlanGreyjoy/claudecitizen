import * as THREE from 'three';
import { PostProcessing, WebGPURenderer, type Node } from 'three/webgpu';
import { mrt, normalView, output, pass, vec4 } from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';
import { ensureNodeRectAreaLights } from '../../render/node-lights';
import { initRequiredWebGpu } from '../../render/webgpu-required';
import { resolveRenderQuality } from '../../render/main/domain/render-quality';
import { PAD_RADIUS_METERS } from './types';

/** AO radius the sandbox has always used — tighter than the planet default. */
const SANDBOX_AO_RADIUS_METERS = 0.2;

export interface ShipSandboxPost {
  render: () => void;
  resize: (width: number, height: number, pixelRatio: number) => void;
  dispose: () => void;
}

export interface ShipSandboxScene {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  post: ShipSandboxPost;
}

function disposeNode(node: unknown): void {
  (node as { dispose?: () => void }).dispose?.();
}

/**
 * The sandbox post stack: the `EffectComposer` + `N8AOPostPass` + `SMAAEffect`
 * chain rebuilt as a node graph. `GTAONode` carries no denoiser of its own — the
 * n8ao pass it replaces did — so the AO target runs through `denoise` before it
 * multiplies scene color, otherwise half-resolution AO reads as blotchy.
 */
function createShipSandboxPost(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): ShipSandboxPost {
  const renderQuality = resolveRenderQuality();
  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.name = 'ship-sandbox-scene';

  const aoEnabled = renderQuality.ambientOcclusionEnabled;
  if (aoEnabled) scenePass.setMRT(mrt({ output, normal: normalView }));

  const sceneColor = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  const sceneNormal = aoEnabled ? scenePass.getTextureNode('normal') : null;

  let color: Node = sceneColor;
  const gtaoNode =
    aoEnabled && sceneNormal ? ao(sceneDepth, sceneNormal, camera) : null;
  if (gtaoNode && sceneNormal) {
    gtaoNode.resolutionScale = renderQuality.ambientOcclusionResolutionScale;
    gtaoNode.samples.value = renderQuality.ambientOcclusionSamples;
    gtaoNode.scale.value = renderQuality.ambientOcclusionIntensity * 1.35;
    gtaoNode.distanceFallOff.value = 1;
    gtaoNode.radius.value = SANDBOX_AO_RADIUS_METERS;
    gtaoNode.thickness.value = SANDBOX_AO_RADIUS_METERS * 4;
    // `.r`, not the whole node: these post getters are vec4 with occlusion in
    // the red channel, and using one as a scalar multiplier tints the frame.
    const occlusion = denoise(
      gtaoNode.getTextureNode(),
      sceneDepth,
      sceneNormal,
      camera,
    ).r;
    // n8ao ran with `colorMultiply: true`, so occlusion scales scene color.
    color = vec4(sceneColor.rgb.mul(occlusion), sceneColor.a);
  }

  const smaaNode = renderQuality.useSmaa ? smaa(color) : null;
  const postProcessing = new PostProcessing(renderer);
  // Left at the default: the sandbox never tone-mapped, so the output pass only
  // has to do the working-to-sRGB conversion the old composer did inline.
  postProcessing.outputNode = smaaNode ?? color;

  return {
    render() {
      postProcessing.render();
    },
    resize(width, height, pixelRatio) {
      scenePass.setPixelRatio(pixelRatio);
      scenePass.setSize(width, height);
      const drawingWidth = Math.max(1, Math.floor(width * pixelRatio));
      const drawingHeight = Math.max(1, Math.floor(height * pixelRatio));
      gtaoNode?.setSize(drawingWidth, drawingHeight);
      smaaNode?.setSize(drawingWidth, drawingHeight);
    },
    dispose() {
      postProcessing.dispose();
      scenePass.dispose();
      disposeNode(gtaoNode);
      disposeNode(smaaNode);
    },
  };
}

/**
 * Builds the ship sandbox stage. Async because `WebGPURenderer.init()` is —
 * initialization completes before this returns so the caller can render and
 * load content immediately, and a WebGPU failure rejects rather than silently
 * degrading to WebGL (see `render/webgpu-required.ts`).
 */
export async function createShipSandboxScene(
  canvas: HTMLCanvasElement,
): Promise<ShipSandboxScene> {
  // Ship prefabs can carry `area-light` components, and the node lighting path
  // needs its LTC tables installed separately from the WebGL one.
  ensureNodeRectAreaLights();

  const renderer = new WebGPURenderer({ antialias: true, canvas });
  // Do not dispose a rejected pre-init renderer: three's pre-init disposal path
  // can re-enter init(). The boot gate owns failure presentation.
  await initRequiredWebGpu(renderer);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a121f);
  scene.fog = new THREE.Fog(0x0a121f, 160, 420);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2_000);
  camera.position.set(14, 8, 14);
  camera.userData.baseFovDeg = 60;
  const cameraTarget = new THREE.Vector3();

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2030, 1.0));
  const sun = new THREE.DirectionalLight(0xfff2df, 2.2);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(PAD_RADIUS_METERS, PAD_RADIUS_METERS, 0.5, 64),
    new THREE.MeshStandardMaterial({
      color: 0x2a3242,
      metalness: 0.15,
      roughness: 0.85,
    }),
  );
  pad.position.y = -0.25;
  pad.receiveShadow = true;
  scene.add(pad);
  const grid = new THREE.GridHelper(PAD_RADIUS_METERS * 2, 42, 0x33507a, 0x18243c);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = 0.01;
  scene.add(grid);

  const post = createShipSandboxPost(renderer, scene, camera);
  return { renderer, scene, camera, cameraTarget, post };
}

/**
 * Releases the GPU resources this stage owns. In-editor the sandbox starts and
 * stops repeatedly, so a leaked post stack / renderer costs a device context per
 * playtest and the browser hard-caps how many exist at once.
 */
export function disposeShipSandboxScene(sandbox: ShipSandboxScene): void {
  sandbox.post.dispose();
  sandbox.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const entry of material) entry.dispose();
    else material?.dispose();
  });
  sandbox.scene.clear();
  sandbox.renderer.dispose();
}

export function resizeShipSandboxScene(scene: ShipSandboxScene): void {
  // In-editor the canvas fills `#editor-play-host`, which is inset below the
  // toolbar — sizing to the window instead stretches the render and cuts the
  // bottom off. Fall back to the window only before layout has run.
  const canvas = scene.renderer.domElement;
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  scene.renderer.setSize(width, height, false);
  scene.camera.aspect = width / height;
  scene.camera.updateProjectionMatrix();
  scene.post.resize(width, height, scene.renderer.getPixelRatio());
}
