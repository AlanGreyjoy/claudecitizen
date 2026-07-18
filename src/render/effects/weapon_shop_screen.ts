import * as THREE from "three";
import {
  CSS3DObject,
  CSS3DRenderer,
} from "three/examples/jsm/renderers/CSS3DRenderer.js";
import type { StationWeaponShopMarker } from "../../world/station";

/**
 * In-world station weapon-shop panel via CSS3D.
 * Station group axes: x = -right, y = up, z = forward (same as ship).
 *
 * While interactive (shop open), the bezel is reparented to a flat screen-space
 * host for reliable pointer hits.
 */

/** CSS pixel width of `.sc-weapon-shop-bezel` — keep in sync with sc-ui.css. */
export const WEAPON_SHOP_PANEL_CSS_WIDTH_PX = 960;
/** CSS pixel height of `.sc-weapon-shop-bezel`. */
export const WEAPON_SHOP_PANEL_CSS_HEIGHT_PX = 540;

export interface WeaponShopScreenOptions {
  panelEl: HTMLElement;
  overlayParent?: HTMLElement;
}

export interface WeaponShopScreenHandle {
  attachTo(stationGroup: THREE.Object3D): void;
  setPowered(powered: boolean): void;
  setInteractive(interactive: boolean): void;
  setSpec(spec: StationWeaponShopMarker | null): void;
  sync(): void;
  render(camera: THREE.Camera): void;
  resize(width?: number, height?: number): void;
  dispose(): void;
}

export function createWeaponShopScreen(
  options: WeaponShopScreenOptions,
): WeaponShopScreenHandle {
  const panelEl = options.panelEl;
  const overlayParent = options.overlayParent ?? document.body;

  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  const overlay = cssRenderer.domElement;
  overlay.className = "sc-weapon-shop-css3d";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "186";
  overlayParent.appendChild(overlay);

  const flatHost = document.createElement("div");
  flatHost.className = "sc-weapon-shop-flat-host";
  flatHost.setAttribute("aria-hidden", "true");
  overlayParent.appendChild(flatHost);

  const cssScene = new THREE.Scene();
  const cssObject = new CSS3DObject(panelEl);
  cssObject.visible = false;
  cssScene.add(cssObject);

  const anchor = new THREE.Object3D();
  anchor.frustumCulled = false;

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
  glass.geometry.computeBoundingSphere();
  anchor.add(glass);

  let parent: THREE.Object3D | null = null;
  let currentSpec: StationWeaponShopMarker | null = null;
  let powered = false;
  let interactive = false;
  let flatMounted = false;
  const _scale = new THREE.Vector3();

  function clearCss3dInlineStyles(): void {
    panelEl.style.transform = "";
    panelEl.style.display = "";
  }

  function mountFlat(): void {
    if (flatMounted) return;
    flatMounted = true;
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

  function applySpec(spec: StationWeaponShopMarker): void {
    currentSpec = spec;
    panelEl.style.width = `${WEAPON_SHOP_PANEL_CSS_WIDTH_PX}px`;
    panelEl.style.height = `${WEAPON_SHOP_PANEL_CSS_HEIGHT_PX}px`;

    const metersPerPx = spec.screenWidth / WEAPON_SHOP_PANEL_CSS_WIDTH_PX;
    cssObject.scale.setScalar(metersPerPx);

    anchor.position.set(-spec.right, spec.up, spec.forward);
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
    const metersPerPx = currentSpec.screenWidth / WEAPON_SHOP_PANEL_CSS_WIDTH_PX;
    cssObject.scale.setScalar(metersPerPx);
  }

  return {
    attachTo(stationGroup: THREE.Object3D) {
      if (parent === stationGroup) return;
      parent?.remove(anchor);
      stationGroup.add(anchor);
      parent = stationGroup;
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
    setSpec(spec: StationWeaponShopMarker | null) {
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
      if (flatMounted) return;
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
      const host = document.getElementById("weapon-shop");
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
