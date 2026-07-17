import * as THREE from "three";
import {
  CSS3DObject,
  CSS3DRenderer,
} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import type { EntertainmentSystemSpec } from "../../player/ship_layout";

/**
 * In-world bunk Entertainment System panel via CSS3D.
 * Ship group axes from updateShipPlacement: x = -right, y = up, z = forward.
 *
 * While interactive (ES open), the bezel is reparented to a flat screen-space
 * host. CSS3D perspective hit-testing is unreliable for the tile grid even when
 * header buttons appear to work — flat DOM clicks are deterministic.
 */

/** CSS pixel width of `.sc-es-bezel` — keep in sync with sc-ui.css. */
export const ES_PANEL_CSS_WIDTH_PX = 960;
/** CSS pixel height of `.sc-es-bezel`. */
export const ES_PANEL_CSS_HEIGHT_PX = 540;

export interface EntertainmentScreenOptions {
  /** Bezel / panel element mounted into CSS3D (e.g. `#es-bezel`). */
  panelEl: HTMLElement;
  /** Parent for the CSS3D overlay (defaults to `document.body`). */
  overlayParent?: HTMLElement;
}

export interface EntertainmentScreenHandle {
  attachTo(shipGroup: THREE.Object3D): void;
  setPowered(powered: boolean): void;
  setInteractive(interactive: boolean): void;
  setSpec(spec: EntertainmentSystemSpec | null): void;
  /** Copy ship-local anchor → CSS3D world transform. Call after ship placement. */
  sync(): void;
  /** Draw the CSS3D layer with the active WebGL camera. */
  render(camera: THREE.Camera): void;
  resize(width?: number, height?: number): void;
  dispose(): void;
}

export function createEntertainmentScreen(
  options: EntertainmentScreenOptions,
): EntertainmentScreenHandle {
  const panelEl = options.panelEl;
  const overlayParent = options.overlayParent ?? document.body;

  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  const overlay = cssRenderer.domElement;
  overlay.className = "sc-es-css3d";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "186";
  overlayParent.appendChild(overlay);

  // Flat interaction host — used while ES is open (reliable pointer events).
  const flatHost = document.createElement("div");
  flatHost.className = "sc-es-flat-host";
  flatHost.setAttribute("aria-hidden", "true");
  overlayParent.appendChild(flatHost);

  const cssScene = new THREE.Scene();
  const cssObject = new CSS3DObject(panelEl);
  cssObject.visible = false;
  cssScene.add(cssObject);

  // WebGL-space anchor parented to the ship for world-matrix sync.
  const anchor = new THREE.Object3D();
  anchor.frustumCulled = false;

  // Dark glass standby when powered off but authored (optional visual).
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0x05080e,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glassMat);
  glass.visible = false;
  glass.renderOrder = 1;
  glass.frustumCulled = false;
  anchor.add(glass);

  let parent: THREE.Object3D | null = null;
  let currentSpec: EntertainmentSystemSpec | null = null;
  let powered = false;
  let interactive = false;
  let flatMounted = false;
  const _scale = new THREE.Vector3();

  function clearCss3dInlineStyles(): void {
    // CSS3DRenderer writes transform/display on the element; strip them for 2D.
    panelEl.style.transform = "";
    panelEl.style.display = "";
  }

  function mountFlat(): void {
    if (flatMounted) return;
    flatMounted = true;
    // Hide from CSS3D so render() does not reparent / set display:none.
    cssObject.visible = false;
    clearCss3dInlineStyles();
    flatHost.appendChild(panelEl);
    flatHost.classList.add("is-active");
    flatHost.setAttribute("aria-hidden", "false");
    panelEl.classList.add("is-flat-interactive");
    panelEl.style.pointerEvents = "auto";
  }

  function unmountFlat(): void {
    if (!flatMounted) return;
    flatMounted = false;
    panelEl.classList.remove("is-flat-interactive");
    flatHost.classList.remove("is-active");
    flatHost.setAttribute("aria-hidden", "true");
    // Park under the CSS3D root; the next visible render re-appends into the camera layer.
    if (panelEl.parentElement === flatHost) {
      overlay.appendChild(panelEl);
    }
    panelEl.style.pointerEvents = "none";
    cssObject.visible = powered;
  }

  function applyInteractionMode(): void {
    const wantFlat = interactive && powered;
    if (wantFlat) {
      mountFlat();
      overlay.style.zIndex = "186";
      overlay.classList.remove("is-interactive");
      return;
    }
    unmountFlat();
    overlay.style.zIndex = "186";
    overlay.classList.remove("is-interactive");
    panelEl.style.pointerEvents = "none";
    cssObject.visible = powered;
  }

  function applySpec(spec: EntertainmentSystemSpec): void {
    currentSpec = spec;
    panelEl.style.width = `${ES_PANEL_CSS_WIDTH_PX}px`;
    panelEl.style.height = `${ES_PANEL_CSS_HEIGHT_PX}px`;

    const metersPerPx = spec.screenWidth / ES_PANEL_CSS_WIDTH_PX;
    cssObject.scale.setScalar(metersPerPx);

    // Prefab scene x → ship -right; y → up; z → forward.
    anchor.position.set(-spec.position.right, spec.position.up, spec.position.forward);
    anchor.quaternion.set(
      spec.rotation.x,
      spec.rotation.y,
      spec.rotation.z,
      spec.rotation.w,
    );

    glass.scale.set(spec.screenWidth, spec.screenHeight, 1);
  }

  function syncCssFromAnchor(): void {
    if (!currentSpec || flatMounted) return;
    anchor.updateWorldMatrix(true, false);
    anchor.matrixWorld.decompose(cssObject.position, cssObject.quaternion, _scale);
    const metersPerPx = currentSpec.screenWidth / ES_PANEL_CSS_WIDTH_PX;
    cssObject.scale.setScalar(metersPerPx);
  }

  return {
    attachTo(shipGroup: THREE.Object3D) {
      if (parent === shipGroup) return;
      parent?.remove(anchor);
      shipGroup.add(anchor);
      parent = shipGroup;
    },
    setPowered(next: boolean) {
      powered = next && currentSpec != null;
      glass.visible = !powered && currentSpec != null;
      panelEl.classList.toggle("is-powered", powered);
      applyInteractionMode();
    },
    setInteractive(next: boolean) {
      interactive = next;
      applyInteractionMode();
    },
    setSpec(spec: EntertainmentSystemSpec | null) {
      if (!spec) {
        currentSpec = null;
        glass.visible = false;
        powered = false;
        applyInteractionMode();
        return;
      }
      applySpec(spec);
      glass.visible = !powered;
      applyInteractionMode();
    },
    sync() {
      if (!currentSpec || !parent || flatMounted) return;
      syncCssFromAnchor();
    },
    render(camera: THREE.Camera) {
      if (flatMounted) {
        // Interactive UI is screen-space; skip CSS3D so it cannot steal the node.
        return;
      }
      if (!powered && !glass.visible) return;
      if (powered) syncCssFromAnchor();
      cssRenderer.render(cssScene, camera);
    },
    resize(width = window.innerWidth, height = window.innerHeight) {
      cssRenderer.setSize(width, height);
    },
    dispose() {
      unmountFlat();
      parent?.remove(anchor);
      parent = null;
      cssScene.remove(cssObject);
      const host = document.getElementById("entertainment-system");
      if (host && panelEl.parentElement !== host) {
        host.appendChild(panelEl);
      }
      flatHost.remove();
      overlay.remove();
      glass.geometry.dispose();
      glassMat.dispose();
    },
  };
}
