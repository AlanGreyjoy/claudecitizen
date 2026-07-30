import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import { setupUpdateObjectAnimations } from "../prefabs/object-animation";
import { createViewportProceduralSky } from "./viewport-procedural-sky";
import { setKtx2SupportRenderer } from "../assets/ktx2";
import { initRequiredWebGpu } from "../webgpu-required";
import { ensureNodeRectAreaLights } from "../node-lights";
import { createSpaceSkybox } from "../main/scene/space-skybox";
import {
  DEFAULT_SCENE_ENVIRONMENT,
  type SceneEnvironmentConfig,
} from "../../world/scenes/scene-runtime";

const STUDIO_BACKGROUND = 0x0a101d;

export interface ViewportScene {
  canvas: HTMLCanvasElement;
  renderer: WebGPURenderer;
  /**
   * Resolves once the renderer backend is live. `render()` before this settles
   * still draws — it forwards to `renderAsync()` — but logs a warning every
   * frame, so render loops should gate their first frame on this.
   */
  ready: Promise<void>;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  entityRoot: THREE.Group;
  orbit: OrbitControls;
  gizmo: TransformControls;
  /** Editor fill lighting (hemi + sun + fill). Off = authored local lights only. */
  setEnvironmentLights: (enabled: boolean) => void;
  /** Unreal-style procedural sky dome + sun disk (tracks env sun). */
  setProceduralSky: (enabled: boolean) => void;
  /** Floor GridHelper visibility (default off). */
  setGridVisible: (enabled: boolean) => void;
  /** Apply authored `scene-environment` (or defaults when null / prefab docs). */
  setSceneEnvironment: (config: SceneEnvironmentConfig | null) => void;
  /** Advance the procedural sky's cloud drift. No-op while the sky is off. */
  updateSky: (dt: number) => void;
  resize: () => void;
  dispose: () => void;
}

/** Renderer, lights, grid, camera, orbit, and gizmo — no entity logic. */
export function createViewportScene(container: HTMLElement): ViewportScene {
  ensureNodeRectAreaLights();
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  container.appendChild(canvas);

  // WebGPU backend, with three's automatic WebGL2 fallback stripped —
  // `initRequiredWebGpu` rejects rather than degrading. WebGPU is a hard engine
  // requirement; see src/render/webgpu-required.ts for why.
  const renderer = new WebGPURenderer({ canvas, antialias: true });
  // KTX2 detection reads GPU features synchronously, which needs a live backend —
  // so unlike the old WebGLRenderer path this cannot run at construction time.
  // The viewport is usually the first renderer in the editor, so it still seeds
  // format detection for loads that happen before Play, just one tick later.
  let disposed = false;
  let rendererInitialized = false;
  let rendererDisposed = false;
  const disposeRenderer = (): void => {
    if (!rendererInitialized || rendererDisposed) return;
    rendererDisposed = true;
    renderer.dispose();
  };
  const ready = initRequiredWebGpu(renderer).then(() => {
    rendererInitialized = true;
    if (disposed) {
      disposeRenderer();
      return;
    }
    setKtx2SupportRenderer(renderer);
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STUDIO_BACKGROUND);
  scene.fog = new THREE.Fog(STUDIO_BACKGROUND, 260, 620);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 10_000);
  camera.position.set(20, 16, 20);

  const envLights = new THREE.Group();
  envLights.name = "editor-env-lights";
  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x121725, 0.82);
  envLights.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.45);
  sun.position.set(36, 62, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00035;
  sun.shadow.radius = 2;
  envLights.add(sun);
  const fill = new THREE.DirectionalLight(0x7db8ff, 0.42);
  fill.position.set(-32, 18, -42);
  envLights.add(fill);
  scene.add(envLights);

  const defaultHemiIntensity = hemi.intensity;
  const defaultSunIntensity = sun.intensity;
  const defaultFillIntensity = fill.intensity;
  const defaultHemiSky = hemi.color.clone();
  const defaultHemiGround = hemi.groundColor.clone();

  const proceduralSky = createViewportProceduralSky(scene, renderer, sun);
  const spaceSkybox = createSpaceSkybox();
  void spaceSkybox.initPromise.then(() => {
    if (!disposed) applySceneEnvironmentVisuals();
  });

  // Studio: dark lines on dark bg. Daylight sky: mid blue-gray so lines
  // stay visible against a bright Preetham horizon without silhouetting.
  const GRID_STUDIO = { center: 0x33507a, grid: 0x18243c, opacity: 0.6 } as const;
  const GRID_SKY = { center: 0x4a5f78, grid: 0x8a9bb0, opacity: 0.55 } as const;

  let grid = createEditorGrid(GRID_STUDIO);
  let gridVisible = false;
  grid.visible = false;
  scene.add(grid);
  scene.add(new THREE.AxesHelper(3));

  const entityRoot = new THREE.Group();
  entityRoot.name = "editor-entities";
  scene.add(entityRoot);
  setupUpdateObjectAnimations(entityRoot);

  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.target.set(0, 2, 0);
  // Right mouse is reserved for Unity-style flythrough; pan lives on middle mouse.
  orbit.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: null as unknown as THREE.MOUSE,
  };

  const gizmo = new TransformControls(camera, canvas);
  scene.add(gizmo.getHelper());

  let toolbarEnvLightsEnabled = true;
  let proceduralSkyEnabled = false;
  let sceneEnvironment: SceneEnvironmentConfig = { ...DEFAULT_SCENE_ENVIRONMENT };
  const solidFallback = new THREE.Color(STUDIO_BACKGROUND);

  function applySceneEnvironmentVisuals(): void {
    if (sceneEnvironment.lightingMode === "off") {
      envLights.visible = false;
    } else {
      envLights.visible = toolbarEnvLightsEnabled;
      if (sceneEnvironment.lightingMode === "interior") {
        sun.intensity = 0;
        fill.intensity = 0;
        hemi.intensity = 0.48 * sceneEnvironment.ambientIntensityScale;
      } else {
        sun.intensity = defaultSunIntensity;
        fill.intensity = defaultFillIntensity;
        hemi.intensity = defaultHemiIntensity * sceneEnvironment.ambientIntensityScale;
      }
      if (sceneEnvironment.ambientSkyColor) {
        hemi.color.set(sceneEnvironment.ambientSkyColor);
      } else {
        hemi.color.copy(defaultHemiSky);
      }
      if (sceneEnvironment.ambientGroundColor) {
        hemi.groundColor.set(sceneEnvironment.ambientGroundColor);
      } else {
        hemi.groundColor.copy(defaultHemiGround);
      }
    }

    // Procedural sky owns background while the toolbar toggle is on.
    if (proceduralSkyEnabled) return;

    if (sceneEnvironment.backgroundMode === "solid") {
      solidFallback.set(sceneEnvironment.backgroundColor);
      scene.background = solidFallback;
      scene.fog = null;
      return;
    }
    if (sceneEnvironment.backgroundMode === "space-skybox") {
      solidFallback.set(STUDIO_BACKGROUND);
      scene.background = spaceSkybox.getBackground(solidFallback);
      scene.fog = null;
      return;
    }
    scene.background = new THREE.Color(STUDIO_BACKGROUND);
    scene.fog = new THREE.Fog(STUDIO_BACKGROUND, 260, 620);
  }

  function resize(): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return {
    canvas,
    renderer,
    ready,
    scene,
    camera,
    entityRoot,
    orbit,
    gizmo,
    setEnvironmentLights(enabled: boolean) {
      toolbarEnvLightsEnabled = enabled;
      applySceneEnvironmentVisuals();
    },
    setProceduralSky(enabled: boolean) {
      proceduralSkyEnabled = enabled;
      proceduralSky.setEnabled(enabled);
      const next = createEditorGrid(enabled ? GRID_SKY : GRID_STUDIO);
      next.visible = gridVisible;
      scene.remove(grid);
      disposeEditorGrid(grid);
      grid = next;
      scene.add(grid);
      applySceneEnvironmentVisuals();
    },
    setGridVisible(enabled: boolean) {
      gridVisible = enabled;
      grid.visible = enabled;
    },
    setSceneEnvironment(config: SceneEnvironmentConfig | null) {
      sceneEnvironment = config ? { ...config } : { ...DEFAULT_SCENE_ENVIRONMENT };
      applySceneEnvironmentVisuals();
    },
    updateSky: proceduralSky.update,
    resize,
    dispose() {
      disposed = true;
      proceduralSky.dispose();
      spaceSkybox.dispose();
      disposeEditorGrid(grid);
      gizmo.detach();
      gizmo.dispose();
      orbit.dispose();
      disposeRenderer();
      canvas.remove();
    },
  };
}

function createEditorGrid(theme: {
  center: number;
  grid: number;
  opacity: number;
}): THREE.GridHelper {
  const grid = new THREE.GridHelper(400, 400, theme.center, theme.grid);
  const material = grid.material as THREE.Material;
  material.transparent = true;
  material.opacity = theme.opacity;
  // Keep lines readable over bright sky without depth fighting the floor.
  material.depthWrite = false;
  return grid;
}

function disposeEditorGrid(grid: THREE.GridHelper): void {
  grid.geometry.dispose();
  const material = grid.material;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}
