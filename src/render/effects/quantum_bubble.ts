import * as THREE from 'three';
import type { QuantumTravelState } from '../../flight/quantum_travel';
import type { Vec3 } from '../../types';

const BUBBLE_RADIUS_METERS = 22;
const MARKER_LABEL = 'Asteron OP-1';

export interface QuantumBubbleUpdateParams {
  quantum: QuantumTravelState;
  flightMode: string;
  focusPosition: Vec3;
  destinationPosition: Vec3 | null;
  destinationHighlighted: boolean;
  timeSeconds: number;
}

export interface QuantumBubbleHandle {
  attachToShip: (shipGroup: THREE.Group) => void;
  update: (params: QuantumBubbleUpdateParams) => void;
  dispose: () => void;
}

function makeLabelSprite(text: string, renderScale: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(8, 18, 32, 0.72)';
    ctx.strokeStyle = 'rgba(120, 210, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.fillRect(8, 10, 240, 44);
    ctx.strokeRect(8, 10, 240, 44);
    ctx.fillStyle = 'rgba(210, 240, 255, 0.95)';
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
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(48 * renderScale, 12 * renderScale, 1);
  sprite.renderOrder = 12;
  return sprite;
}

export function createQuantumBubble(
  scene: THREE.Scene,
  renderScale: number,
): QuantumBubbleHandle {
  const root = new THREE.Group();
  root.name = 'quantum-bubble-root';
  root.frustumCulled = false;

  const outerGeometry = new THREE.SphereGeometry(BUBBLE_RADIUS_METERS * renderScale, 36, 24);
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0x7ec8ff,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const outerBubble = new THREE.Mesh(outerGeometry, outerMaterial);
  outerBubble.renderOrder = 8;

  const innerGeometry = new THREE.SphereGeometry(BUBBLE_RADIUS_METERS * 0.82 * renderScale, 28, 18);
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xd8f2ff,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    wireframe: true,
  });
  const innerBubble = new THREE.Mesh(innerGeometry, innerMaterial);
  innerBubble.renderOrder = 9;

  root.add(outerBubble, innerBubble);
  root.visible = false;

  const markerRoot = new THREE.Group();
  markerRoot.name = 'quantum-destination-marker';
  markerRoot.visible = false;
  const markerDiamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(5 * renderScale),
    new THREE.MeshBasicMaterial({
      color: 0x5ce0ff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  markerDiamond.renderOrder = 11;
  const markerLabel = makeLabelSprite(MARKER_LABEL, renderScale);
  markerLabel.position.y = 14 * renderScale;
  markerRoot.add(markerDiamond, markerLabel);
  scene.add(markerRoot);

  let shipAttached = false;

  return {
    attachToShip(shipGroup: THREE.Group) {
      if (shipAttached) return;
      shipGroup.add(root);
      shipAttached = true;
    },
    update({
      quantum,
      flightMode,
      focusPosition,
      destinationPosition,
      destinationHighlighted,
      timeSeconds,
    }: QuantumBubbleUpdateParams) {
      const active =
        quantum.phase === 'spooling' ||
        quantum.phase === 'traveling' ||
        quantum.phase === 'dropOut';
      root.visible = active;

      if (active) {
        const pulse = 1 + Math.sin(timeSeconds * 8) * 0.04;
        const travelPulse = quantum.phase === 'traveling' ? 1.08 : 1;
        root.scale.setScalar(pulse * travelPulse);
        outerMaterial.opacity =
          quantum.phase === 'traveling'
            ? 0.1 + Math.sin(timeSeconds * 12) * 0.03
            : 0.08 + (quantum.spoolElapsed / Math.max(quantum.spoolDuration, 0.001)) * 0.08;
        innerMaterial.opacity = quantum.phase === 'traveling' ? 0.2 : 0.12;
      }

      const showMarker = flightMode === 'nav' && destinationPosition !== null;
      markerRoot.visible = showMarker;
      if (showMarker && destinationPosition) {
        markerRoot.position.set(
          (destinationPosition.x - focusPosition.x) * renderScale,
          (destinationPosition.y - focusPosition.y) * renderScale,
          (destinationPosition.z - focusPosition.z) * renderScale,
        );
        const markerMat = markerDiamond.material as THREE.MeshBasicMaterial;
        markerMat.color.setHex(destinationHighlighted ? 0x9ff7ff : 0x3a9ec0);
        markerMat.opacity = destinationHighlighted ? 0.95 : 0.55;
        markerDiamond.rotation.y = timeSeconds * 0.8;
        markerDiamond.rotation.x = 0.6;
      }
    },
    dispose() {
      scene.remove(markerRoot);
      root.removeFromParent();
      outerGeometry.dispose();
      innerGeometry.dispose();
      outerMaterial.dispose();
      innerMaterial.dispose();
      (markerDiamond.material as THREE.Material).dispose();
      (markerDiamond.geometry as THREE.BufferGeometry).dispose();
      (markerLabel.material as THREE.SpriteMaterial).dispose();
      (markerLabel.material.map as THREE.Texture)?.dispose();
    },
  };
}
