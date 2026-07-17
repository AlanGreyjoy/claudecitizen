import * as THREE from 'three';
import {
  QUANTUM_DROP_OUT_SECONDS,
  type QuantumTravelState,
} from '../../flight/quantum_travel';
import type { Vec3 } from '../../types';

const HYPERSPACE_RADIUS_METERS = 42;
const HYPERSPACE_LENGTH_METERS = 520;
const HYPERSPACE_FLOW_TEXTURE_URL =
  '/assets/protected/hyperspace/Hyperspace_Texture2.png';
const HYPERSPACE_OPACITY_TEXTURE_URL =
  '/assets/protected/hyperspace/Hyperspace_Texture4.png';
const MARKER_POOL_SIZE = 12;
/** Keep roughly constant angular size (~1.2°); clamps prevent huge/tiny extremes. */
const MARKER_ANGULAR_SCALE = 0.021;
const MARKER_MIN_METERS = 120;
const MARKER_MAX_METERS = 25_000;
/** Lift markers above the pad so they read against terrain from orbit. */
const MARKER_ALTITUDE_BOOST_METERS = 400;

const hyperspaceVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const hyperspaceFragmentShader = `
  uniform float uIntensity;
  uniform float uTime;
  uniform sampler2D uFlowTexture;
  uniform sampler2D uOpacityTexture;
  varying vec2 vUv;

  const float TAU = 6.28318530718;

  void main() {
    float angle = vUv.x * TAU;
    float axis = vUv.y;
    vec2 flowUv = vec2(
      fract(vUv.x * 2.0 + uTime * 0.025),
      fract(axis * 3.0 - uTime * 0.42)
    );
    vec2 opacityUv = vec2(
      fract(vUv.x * 1.5 - uTime * 0.018),
      fract(axis * 2.0 - uTime * 0.18)
    );
    float flowTexture = texture2D(uFlowTexture, flowUv).r;
    float opacityTexture = texture2D(uOpacityTexture, opacityUv).r;
    float axialPulse = 0.5 + 0.5 * sin(
      axis * 56.0 - uTime * 8.0 + angle * 2.0 + (flowTexture - 0.5) * 3.0
    );
    float spiral = 0.5 + 0.5 * sin(
      angle * 5.0 + axis * 14.0 - uTime * 2.5
    );
    float streak = smoothstep(
      0.46,
      0.84,
      mix(flowTexture, opacityTexture, 0.42)
    );
    float lightning = smoothstep(
      0.68,
      0.96,
      abs(flowTexture - opacityTexture) * 1.3 + axialPulse * 0.34
    );
    float ribbon = smoothstep(0.58, 0.92, streak * 0.72 + spiral * 0.34);

    vec3 violet = vec3(0.58, 0.08, 0.42);
    vec3 blue = vec3(0.05, 0.42, 0.95);
    vec3 cyan = vec3(0.32, 0.88, 1.0);
    vec3 plasma = mix(violet, blue, smoothstep(0.12, 0.78, axis));
    plasma = mix(plasma, cyan, streak * 0.52 + lightning * 0.38);

    float energy =
      0.2 +
      streak * 0.58 +
      lightning * 0.72 +
      ribbon * 0.22;
    vec3 color = vec3(0.003, 0.009, 0.035) + plasma * energy;
    float alpha = clamp(
      (0.82 + streak * 0.1 + lightning * 0.05) * uIntensity,
      0.0,
      0.98
    );
    gl_FragColor = vec4(color * uIntensity, alpha);
  }
`;

function createFallbackHyperspaceTexture(value: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([value, value, value, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  return texture;
}

function configureHyperspaceTexture(texture: THREE.Texture): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
}

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

export function createQuantumBubble(
  scene: THREE.Scene,
  renderScale: number,
): QuantumBubbleHandle {
  const root = new THREE.Group();
  root.name = 'quantum-bubble-root';
  root.frustumCulled = false;

  // The Unity reference is a single animated capsule. Rebuild its geometry
  // procedurally so travel remains one lightweight draw call. When the local
  // protected asset pack exists, its original flow maps add surface detail.
  const fallbackFlowTexture = createFallbackHyperspaceTexture(128);
  const fallbackOpacityTexture = createFallbackHyperspaceTexture(150);
  const hyperspaceUniforms = {
    uIntensity: new THREE.Uniform(0),
    uTime: new THREE.Uniform(0),
    uFlowTexture: new THREE.Uniform<THREE.Texture>(fallbackFlowTexture),
    uOpacityTexture: new THREE.Uniform<THREE.Texture>(fallbackOpacityTexture),
  };
  const hyperspaceGeometry = new THREE.CapsuleGeometry(
    HYPERSPACE_RADIUS_METERS * renderScale,
    HYPERSPACE_LENGTH_METERS * renderScale,
    5,
    16,
  );
  const hyperspaceMaterial = new THREE.ShaderMaterial({
    uniforms: hyperspaceUniforms,
    vertexShader: hyperspaceVertexShader,
    fragmentShader: hyperspaceFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const shellSpin = new THREE.Group();
  const hyperspaceShell = new THREE.Mesh(hyperspaceGeometry, hyperspaceMaterial);
  hyperspaceShell.name = 'quantum-hyperspace-capsule';
  hyperspaceShell.rotation.x = Math.PI * 0.5;
  hyperspaceShell.renderOrder = 8;
  hyperspaceShell.frustumCulled = false;
  shellSpin.add(hyperspaceShell);
  root.add(shellSpin);
  root.visible = false;

  let disposed = false;
  const ownedHyperspaceTextures = new Set<THREE.Texture>([
    fallbackFlowTexture,
    fallbackOpacityTexture,
  ]);
  const textureLoader = new THREE.TextureLoader();
  const loadTexture = (
    url: string,
    uniform: THREE.Uniform<THREE.Texture>,
  ): void => {
    textureLoader.load(
      url,
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        configureHyperspaceTexture(texture);
        const previous = uniform.value;
        uniform.value = texture;
        ownedHyperspaceTextures.delete(previous);
        previous.dispose();
        ownedHyperspaceTextures.add(texture);
      },
      undefined,
      () => {
        // Protected assets are intentionally absent from public builds. The
        // one-pixel procedural fallback keeps the same shader path working.
      },
    );
  };
  if (import.meta.env.DEV) {
    loadTexture(HYPERSPACE_FLOW_TEXTURE_URL, hyperspaceUniforms.uFlowTexture);
    loadTexture(HYPERSPACE_OPACITY_TEXTURE_URL, hyperspaceUniforms.uOpacityTexture);
  }

  const markerSlots: MarkerSlot[] = [];
  // Unit octahedron; scaled each frame in world meters → render units.
  const diamondGeometry = new THREE.OctahedronGeometry(1);
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
    diamond.frustumCulled = false;
    markerRoot.add(diamond);
    scene.add(markerRoot);
    markerSlots.push({ root: markerRoot, diamond, label: null, labelName: null });
  }

  let shipAttached = false;

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
      const active =
        quantum.phase === 'spooling' ||
        quantum.phase === 'traveling' ||
        quantum.phase === 'dropOut';
      root.visible = active;

      if (active) {
        const spoolT = Math.min(
          1,
          quantum.spoolElapsed / Math.max(quantum.spoolDuration, 0.001),
        );
        const dropT = Math.min(
          1,
          quantum.dropOutElapsed / QUANTUM_DROP_OUT_SECONDS,
        );
        const intensity =
          quantum.phase === 'spooling'
            ? Math.max(0, (spoolT - 0.55) / 0.45)
            : quantum.phase === 'dropOut'
              ? 1 - dropT * dropT * (3 - 2 * dropT)
              : 1;
        const pulse = 1 + Math.sin(timeSeconds * 7) * 0.012 * intensity;
        root.scale.setScalar(pulse);
        shellSpin.rotation.z = timeSeconds * 0.16;
        shellSpin.position.z =
          quantum.phase === 'dropOut'
            ? -dropT * HYPERSPACE_LENGTH_METERS * 0.62 * renderScale
            : 0;
        hyperspaceUniforms.uTime.value = timeSeconds;
        hyperspaceUniforms.uIntensity.value = intensity;
      }

      const showMarkers = flightMode === 'nav';
      for (let i = 0; i < markerSlots.length; i += 1) {
        const slot = markerSlots[i];
        const marker = showMarkers ? markers[i] ?? null : null;
        if (!marker) {
          slot.root.visible = false;
          continue;
        }

        const dx = marker.position.x - focusPosition.x;
        const dy = marker.position.y - focusPosition.y;
        const dz = marker.position.z - focusPosition.z;
        const distanceMeters = length3(dx, dy, dz);

        // Radial boost so the icon sits above the terrain pad.
        const markerLen = length3(marker.position.x, marker.position.y, marker.position.z);
        const boost =
          markerLen > 1e-3 ? MARKER_ALTITUDE_BOOST_METERS / markerLen : 0;
        const boostedX = marker.position.x * (1 + boost);
        const boostedY = marker.position.y * (1 + boost);
        const boostedZ = marker.position.z * (1 + boost);

        const visible = markerVisibleFromFocus(
          focusPosition.x,
          focusPosition.y,
          focusPosition.z,
          boostedX,
          boostedY,
          boostedZ,
        );
        if (!visible) {
          slot.root.visible = false;
          continue;
        }

        slot.root.visible = true;
        slot.root.position.set(
          (boostedX - focusPosition.x) * renderScale,
          (boostedY - focusPosition.y) * renderScale,
          (boostedZ - focusPosition.z) * renderScale,
        );

        const sizeMeters = markerWorldSizeMeters(distanceMeters);
        const sizeRender = sizeMeters * renderScale;
        // Octahedron radius 1 → scale to half of desired world size for a readable diamond.
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
          // Label width ~4× diamond, height ~1×; offset above diamond.
          slot.label.scale.set(sizeRender * 4, sizeRender, 1);
          slot.label.position.y = sizeRender * 1.1;
        }

        const markerMat = slot.diamond.material as THREE.MeshBasicMaterial;
        markerMat.color.setHex(marker.highlighted ? 0x9ff7ff : 0x3a9ec0);
        markerMat.opacity = marker.highlighted ? 0.95 : 0.55;
      }
    },
    dispose() {
      disposed = true;
      for (const slot of markerSlots) {
        scene.remove(slot.root);
        disposeLabel(slot.label);
        (slot.diamond.material as THREE.Material).dispose();
      }
      diamondGeometry.dispose();
      root.removeFromParent();
      hyperspaceGeometry.dispose();
      hyperspaceMaterial.dispose();
      for (const texture of ownedHyperspaceTextures) texture.dispose();
      ownedHyperspaceTextures.clear();
    },
  };
}
