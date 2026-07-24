import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import { setupUpdateObjectAnimations } from "../prefabs/object_animation";

export interface ViewportScene {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  entityRoot: THREE.Group;
  orbit: OrbitControls;
  gizmo: TransformControls;
  resize: () => void;
  dispose: () => void;
}

/** Renderer, lights, grid, camera, orbit, and gizmo — no entity logic. */
export function createViewportScene(container: HTMLElement): ViewportScene {
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a101d);
  scene.fog = new THREE.Fog(0x0a101d, 260, 620);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 10_000);
  camera.position.set(20, 16, 20);

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x121725, 0.82));
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
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x7db8ff, 0.42);
  fill.position.set(-32, 18, -42);
  scene.add(fill);

  const grid = new THREE.GridHelper(400, 400, 0x33507a, 0x18243c);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.6;
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
    scene,
    camera,
    entityRoot,
    orbit,
    gizmo,
    resize,
    dispose() {
      gizmo.detach();
      gizmo.dispose();
      orbit.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
