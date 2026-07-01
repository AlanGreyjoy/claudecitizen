import * as THREE from 'three';
import type { CloudLayerConfig, Planet, Vec3 } from '../../../types';
import { CLOUD_LAYER_CONFIGS, sampleCloudAlpha } from '../../../world/clouds';

interface CloudLayer {
  config: CloudLayerConfig;
  material: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
}

export interface CloudShell {
  dispose: () => void;
  update: (
    bodyPosition: Vec3,
    nowSeconds: number,
    spaceFactor: number,
    altitudeMeters?: number,
  ) => void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number, edge0: number, edge1: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 0.000001));
  return t * t * (3 - 2 * t);
}

function buildCloudTexture(seed: number, layerIndex: number): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const imageData = context.createImageData(width, height);
  const data = imageData.data;

  let ptr = 0;
  for (let y = 0; y < height; y += 1) {
    const latRadians = ((y + 0.5) / height - 0.5) * Math.PI;
    for (let x = 0; x < width; x += 1) {
      const lonRadians = ((x + 0.5) / width - 0.5) * Math.PI * 2;
      const alpha = sampleCloudAlpha(seed, lonRadians, latRadians, layerIndex);
      const shade = 210 + Math.round(alpha * 40);
      data[ptr] = shade;
      data[ptr + 1] = shade;
      data[ptr + 2] = shade + 8;
      data[ptr + 3] = Math.round(alpha * 255);
      ptr += 4;
    }
  }

  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createCloudShell(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
  renderScale: number,
): CloudShell {
  const group = new THREE.Group();
  const layers: CloudLayer[] = [];

  CLOUD_LAYER_CONFIGS.forEach((config, layerIndex) => {
    const texture = buildCloudTexture(seed, layerIndex);
    const material = new THREE.MeshBasicMaterial({
      alphaMap: texture,
      alphaTest: 0.08,
      color: 0xffffff,
      depthWrite: false,
      fog: false,
      opacity: config.opacity,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(
        (planet.radiusMeters + config.altitudeMeters + config.radiusOffsetMeters) * renderScale,
        96,
        64,
      ),
      material,
    );
    mesh.rotation.y = layerIndex * 0.7;
    group.add(mesh);
    layers.push({
      config,
      material,
      mesh,
      texture,
    });
  });

  scene.add(group);

  function update(
    bodyPosition: Vec3,
    nowSeconds: number,
    spaceFactor: number,
    altitudeMeters = 0,
  ): void {
    group.position.set(
      -bodyPosition.x * renderScale,
      -bodyPosition.y * renderScale,
      -bodyPosition.z * renderScale,
    );
    const planetShellStrength = 1.0 - smoothstep01(spaceFactor, 0.55, 0.95);
    const lowAltitudeBoost = 1.0 - smoothstep01(altitudeMeters, 8_000, 24_000);
    const shellStrength = clamp01(planetShellStrength * (0.35 + lowAltitudeBoost * 0.65));
    for (const layer of layers) {
      layer.mesh.rotation.y = nowSeconds * layer.config.rotationRate;
      layer.material.opacity = layer.config.opacity * shellStrength;
    }
  }

  function dispose(): void {
    for (const layer of layers) {
      layer.texture.dispose();
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
    scene.remove(group);
  }

  return {
    dispose,
    update,
  };
}
