import * as THREE from 'three';
import {
  QUANTUM_DROP_OUT_SECONDS,
  type QuantumTravelState,
} from '../../flight/quantum-travel';
import type { Vec3 } from '../../types';

/**
 * The quantum bubble is also the frame budget's best friend: during a jump the
 * renderer draws *only* this and the hull (`renderQuantumIsolation`), so the
 * whole planet stack — terrain, vegetation, water, clouds, post — is culled.
 * Everything here must stay cheap enough to keep that promise: two open
 * cylinders, one procedural node material, no textures, no extra passes.
 */
/**
 * Both barrels must contain the camera, or the pilot watches the tunnel from
 * outside instead of flying down it. The external ship camera pulls back
 * `(58 + 180) * zoom` metres and up `(9 + 136) * zoom` at space altitude
 * (`camera-rig-modes.ts`), and ship zoom clamps at 2.2 — about 610 m from the
 * hull worst case. The old 42 m capsule was inside that, which is the other
 * half of why the effect never read as a tunnel.
 */
const HYPERSPACE_RADIUS_METERS = 900;
const HYPERSPACE_LENGTH_METERS = 5_200;
/** Inner barrel, counter-rotating, for parallax against the outer one. */
const HYPERSPACE_CORE_RADIUS_SCALE = 0.8;
const HYPERSPACE_CORE_LENGTH_SCALE = 0.8;
const HYPERSPACE_RADIAL_SEGMENTS = 48;
const MARKER_POOL_SIZE = 12;
/** Keep roughly constant angular size (~1.2°); clamps prevent huge/tiny extremes. */
const MARKER_ANGULAR_SCALE = 0.021;
const MARKER_MIN_METERS = 120;
const MARKER_MAX_METERS = 25_000;
/** Lift markers above the pad so they read against terrain from orbit. */
const MARKER_ALTITUDE_BOOST_METERS = 400;

export interface QuantumNavMarker {
  id: string;
  name: string;
  position: Vec3;
  highlighted: boolean;
}

export interface QuantumBubbleUpdateParams {
  quantum: QuantumTravelState;
  flightMode: string;
  focusPosition: Vec3;
  markers: QuantumNavMarker[];
  timeSeconds: number;
}

export interface QuantumBubbleHandle {
  attachToShip: (shipGroup: THREE.Group) => void;
  enableRenderLayer: (layer: number) => void;
  getRenderRoot: () => THREE.Object3D;
  update: (params: QuantumBubbleUpdateParams) => void;
  dispose: () => void;
}

export interface HyperspaceMaterialHandle {
  material: THREE.Material;
  setIntensity: (intensity: number) => void;
  setTime: (timeSeconds: number) => void;
  /** 0 = spool-up drift, 1 = full travel rush. Drives streak speed and stretch. */
  setWarp: (warp01: number) => void;
  /** Entry / exit blow-out, 0..1. Washes the tunnel to white. */
  setFlash: (flash01: number) => void;
  dispose: () => void;
}

export type HyperspaceMaterialFactory = () => HyperspaceMaterialHandle;

export interface QuantumBubbleOptions {
  /**
   * Required. `WebGPURenderer` only consumes node materials — there is no
   * WebGL path in this engine (`src/render/webgpu-required.ts`), and a raw
   * `ShaderMaterial` here would silently draw as a blank node material.
   */
  hyperspaceMaterialFactory: HyperspaceMaterialFactory;
}

function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(8, 18, 32, 0.78)';
    ctx.strokeStyle = 'rgba(120, 210, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.fillRect(8, 10, 240, 44);
    ctx.strokeRect(8, 10, 240, 44);
    ctx.fillStyle = 'rgba(210, 240, 255, 0.98)';
    ctx.font = '600 22px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 12;
  sprite.frustumCulled = false;
  return sprite;
}

interface MarkerSlot {
  root: THREE.Group;
  diamond: THREE.Mesh;
  label: THREE.Sprite | null;
  labelName: string | null;
}

function disposeLabel(label: THREE.Sprite | null): void {
  if (!label) return;
  label.removeFromParent();
  const material = label.material as THREE.SpriteMaterial;
  material.map?.dispose();
  material.dispose();
}

function length3(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

function markerVisibleFromFocus(
  focusX: number,
  focusY: number,
  focusZ: number,
  markerX: number,
  markerY: number,
  markerZ: number,
): boolean {
  const focusLen = length3(focusX, focusY, focusZ);
  const markerLen = length3(markerX, markerY, markerZ);
  if (focusLen < 1e-3 || markerLen < 1e-3) return true;
  // Hide far-side markers behind the planet limb.
  const cosHorizon = Math.min(0.999, markerLen / focusLen);
  const dot =
    (focusX * markerX + focusY * markerY + focusZ * markerZ) / (focusLen * markerLen);
  return dot >= cosHorizon - 0.02;
}

function markerWorldSizeMeters(distanceMeters: number): number {
  return Math.min(
    MARKER_MAX_METERS,
    Math.max(MARKER_MIN_METERS, distanceMeters * MARKER_ANGULAR_SCALE),
  );
}

function isQuantumBubbleActive(phase: QuantumTravelState['phase']): boolean {
  return phase === 'spooling' || phase === 'traveling' || phase === 'dropOut';
}

function spoolProgress(quantum: QuantumTravelState): number {
  return Math.min(1, quantum.spoolElapsed / Math.max(quantum.spoolDuration, 0.001));
}

function dropOutProgress(quantum: QuantumTravelState): number {
  return Math.min(1, quantum.dropOutElapsed / QUANTUM_DROP_OUT_SECONDS);
}

function quantumBubbleIntensity(quantum: QuantumTravelState): number {
  const dropT = dropOutProgress(quantum);
  if (quantum.phase === 'spooling') {
    return Math.max(0, (spoolProgress(quantum) - 0.55) / 0.45);
  }
  if (quantum.phase === 'dropOut') return 1 - dropT * dropT * (3 - 2 * dropT);
  return 1;
}

/**
 * How hard the streaks are being pulled: a slow swirl while the drive spools,
 * full stretch in the tunnel, relaxing again as it collapses.
 */
function quantumBubbleWarp(quantum: QuantumTravelState): number {
  if (quantum.phase === 'spooling') return spoolProgress(quantum) * 0.4;
  if (quantum.phase === 'dropOut') return 1 - dropOutProgress(quantum);
  return 1;
}

function quantumBubbleFlash(quantum: QuantumTravelState): number {
  return Math.min(1, Math.max(quantum.entryFlash, quantum.exitFlash));
}

function boostedMarkerPosition(marker: Vec3): Vec3 {
  const markerLen = length3(marker.x, marker.y, marker.z);
  const boost = markerLen > 1e-3 ? MARKER_ALTITUDE_BOOST_METERS / markerLen : 0;
  return {
    x: marker.x * (1 + boost),
    y: marker.y * (1 + boost),
    z: marker.z * (1 + boost),
  };
}

interface HyperspaceShell {
  root: THREE.Group;
  outerSpin: THREE.Group;
  innerSpin: THREE.Group;
  geometries: THREE.BufferGeometry[];
}

/**
 * Two open-ended barrels around the hull, sharing one material.
 *
 * Open-ended (not a capsule) because the pilot is *inside* it: capped ends
 * meant the shader's forward convergence was drawn on a dome right in front of
 * the camera instead of receding down a tunnel. The inner barrel is shorter,
 * narrower and counter-rotates, which is what gives the streaks depth — two
 * draw calls buy the parallax a single shell cannot fake.
 *
 * Local +Y is mapped to −Z so the shader's `uv.y = 1` end sits *ahead* of the
 * ship, where the throat glow belongs.
 */
function createHyperspaceShell(
  material: THREE.Material,
  renderScale: number,
): HyperspaceShell {
  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];

  const buildBarrel = (
    name: string,
    radiusScale: number,
    lengthScale: number,
  ): THREE.Group => {
    const geometry = new THREE.CylinderGeometry(
      HYPERSPACE_RADIUS_METERS * radiusScale * renderScale,
      HYPERSPACE_RADIUS_METERS * radiusScale * renderScale,
      HYPERSPACE_LENGTH_METERS * lengthScale * renderScale,
      HYPERSPACE_RADIAL_SEGMENTS,
      1,
      true,
    );
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.renderOrder = 8;
    mesh.frustumCulled = false;
    const spin = new THREE.Group();
    spin.add(mesh);
    root.add(spin);
    return spin;
  };

  const outerSpin = buildBarrel('quantum-hyperspace-barrel', 1, 1);
  const innerSpin = buildBarrel(
    'quantum-hyperspace-core',
    HYPERSPACE_CORE_RADIUS_SCALE,
    HYPERSPACE_CORE_LENGTH_SCALE,
  );
  return { root, outerSpin, innerSpin, geometries };
}

export function createQuantumBubble(
  scene: THREE.Scene,
  renderScale: number,
  options: QuantumBubbleOptions,
): QuantumBubbleHandle {
  const root = new THREE.Group();
  root.name = 'quantum-bubble-root';
  root.frustumCulled = false;

  const hyperspaceVisual = options.hyperspaceMaterialFactory();
  const shell = createHyperspaceShell(hyperspaceVisual.material, renderScale);
  root.add(shell.root);
  root.visible = false;

  const markerSlots: MarkerSlot[] = [];
  // Unit octahedron; scaled each frame in world meters → render units.
  const diamondGeometry = new THREE.OctahedronGeometry(1);
  diamondGeometry.computeBoundingSphere();
  for (let i = 0; i < MARKER_POOL_SIZE; i += 1) {
    const markerRoot = new THREE.Group();
    markerRoot.name = `quantum-destination-marker-${i}`;
    markerRoot.visible = false;
    markerRoot.frustumCulled = false;
    const diamond = new THREE.Mesh(
      diamondGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x5ce0ff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    diamond.renderOrder = 11;
    markerRoot.add(diamond);
    scene.add(markerRoot);
    markerSlots.push({ root: markerRoot, diamond, label: null, labelName: null });
  }

  let shipAttached = false;

  function updateBubbleVisuals(
    quantum: QuantumTravelState,
    timeSeconds: number,
  ): void {
    const intensity = quantumBubbleIntensity(quantum);
    const warp = quantumBubbleWarp(quantum);
    const pulse = 1 + Math.sin(timeSeconds * 7) * 0.012 * intensity;
    root.scale.setScalar(pulse);
    // Counter-rotation, and both spin harder the deeper into the jump you are.
    shell.outerSpin.rotation.z = timeSeconds * (0.1 + warp * 0.22);
    shell.innerSpin.rotation.z = timeSeconds * -(0.16 + warp * 0.4);
    const dropT = dropOutProgress(quantum);
    // Collapse: the barrel tears off forward as the drive lets go.
    const collapse =
      quantum.phase === 'dropOut'
        ? -dropT * HYPERSPACE_LENGTH_METERS * 0.62 * renderScale
        : 0;
    shell.outerSpin.position.z = collapse;
    shell.innerSpin.position.z = collapse * 1.35;
    hyperspaceVisual.setTime(timeSeconds);
    hyperspaceVisual.setIntensity(intensity);
    hyperspaceVisual.setWarp(warp);
    hyperspaceVisual.setFlash(quantumBubbleFlash(quantum));
  }

  function updateMarkerSlot(
    slot: MarkerSlot,
    marker: QuantumBubbleUpdateParams['markers'][number],
    focusPosition: Vec3,
    timeSeconds: number,
  ): void {
    const boosted = boostedMarkerPosition(marker.position);
    const distanceMeters = length3(
      marker.position.x - focusPosition.x,
      marker.position.y - focusPosition.y,
      marker.position.z - focusPosition.z,
    );
    const visible = markerVisibleFromFocus(
      focusPosition.x,
      focusPosition.y,
      focusPosition.z,
      boosted.x,
      boosted.y,
      boosted.z,
    );
    if (!visible) {
      slot.root.visible = false;
      return;
    }

    slot.root.visible = true;
    slot.root.position.set(
      (boosted.x - focusPosition.x) * renderScale,
      (boosted.y - focusPosition.y) * renderScale,
      (boosted.z - focusPosition.z) * renderScale,
    );

    const sizeMeters = markerWorldSizeMeters(distanceMeters);
    const sizeRender = sizeMeters * renderScale;
    slot.diamond.scale.setScalar(sizeRender * 0.5);
    slot.diamond.rotation.y = timeSeconds * 0.8;
    slot.diamond.rotation.x = 0.6;

    if (slot.labelName !== marker.name) {
      disposeLabel(slot.label);
      const label = makeLabelSprite(marker.name);
      slot.root.add(label);
      slot.label = label;
      slot.labelName = marker.name;
    }
    if (slot.label) {
      slot.label.scale.set(sizeRender * 4, sizeRender, 1);
      slot.label.position.y = sizeRender * 1.1;
    }

    const markerMat = slot.diamond.material as THREE.MeshBasicMaterial;
    markerMat.color.setHex(marker.highlighted ? 0x9ff7ff : 0x3a9ec0);
    markerMat.opacity = marker.highlighted ? 0.95 : 0.55;
  }

  return {
    attachToShip(shipGroup: THREE.Group) {
      if (shipAttached) return;
      shipGroup.add(root);
      shipAttached = true;
    },
    enableRenderLayer(layer: number) {
      root.traverse((object) => object.layers.enable(layer));
    },
    getRenderRoot() {
      return root;
    },
    update({
      quantum,
      flightMode,
      focusPosition,
      markers,
      timeSeconds,
    }: QuantumBubbleUpdateParams) {
      const active = isQuantumBubbleActive(quantum.phase);
      root.visible = active;
      if (active) updateBubbleVisuals(quantum, timeSeconds);

      const showMarkers = flightMode === 'nav';
      for (let i = 0; i < markerSlots.length; i += 1) {
        const slot = markerSlots[i];
        const marker = showMarkers ? markers[i] ?? null : null;
        if (!marker) {
          slot.root.visible = false;
          continue;
        }
        updateMarkerSlot(slot, marker, focusPosition, timeSeconds);
      }
    },
    dispose() {
      for (const slot of markerSlots) {
        scene.remove(slot.root);
        disposeLabel(slot.label);
        (slot.diamond.material as THREE.Material).dispose();
      }
      diamondGeometry.dispose();
      root.removeFromParent();
      for (const geometry of shell.geometries) geometry.dispose();
      hyperspaceVisual.dispose();
    },
  };
}
