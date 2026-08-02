import * as THREE from 'three';
import { add, normalize, scale } from '../../math/vec3';
import type { Vec3 } from '../../types';

const HIT_DECAL_POOL_SIZE = 48;
const HIT_DECAL_OFFSET_METERS = 0.008;
/**
 * A 14cm decal is sub-pixel long before 2km, so the old distance only bought
 * overdraw. Decals also age out instead of hanging around until the pool wraps
 * and pops them mid-frame.
 */
const HIT_DECAL_VISIBLE_DISTANCE_METERS = 140;
const HIT_DECAL_HOLD_SECONDS = 22;
const HIT_DECAL_FADE_SECONDS = 4;

interface HitDecalEntry {
  active: boolean;
  ageSeconds: number;
  material: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  worldPosition: Vec3;
}

export interface HitDecalSpawn {
  normal: Vec3;
  point: Vec3;
  textureUrl: string | null;
}

export interface HitDecalRenderer {
  dispose(): void;
  spawn(decal: HitDecalSpawn): void;
  update(dt: number, focusPosition: Vec3, visible: boolean): void;
}

export function createHitDecalRenderer(
  scene: THREE.Scene,
  renderScale: number,
): HitDecalRenderer {
  const geometry = new THREE.PlaneGeometry(0.14, 0.14);
  const textureLoader = new THREE.TextureLoader();
  const textures = new Map<string, THREE.Texture>();
  const normal = new THREE.Vector3();
  const planeNormal = new THREE.Vector3(0, 0, 1);
  const entries: HitDecalEntry[] = [];
  let cursor = 0;

  for (let index = 0; index < HIT_DECAL_POOL_SIZE; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 12;
    mesh.scale.setScalar(renderScale);
    mesh.visible = false;
    scene.add(mesh);
    entries.push({
      active: false,
      ageSeconds: 0,
      material,
      mesh,
      worldPosition: { x: 0, y: 0, z: 0 },
    });
  }

  function textureFor(url: string): THREE.Texture {
    let texture = textures.get(url);
    if (!texture) {
      texture = textureLoader.load(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      textures.set(url, texture);
    }
    return texture;
  }

  function spawn(decal: HitDecalSpawn): void {
    if (!decal.textureUrl) return;
    const entry = entries[cursor]!;
    cursor = (cursor + 1) % entries.length;
    normal.set(decal.normal.x, decal.normal.y, decal.normal.z).normalize();
    entry.active = true;
    entry.ageSeconds = 0;
    entry.worldPosition = add(
      decal.point,
      scale(normalize(decal.normal), HIT_DECAL_OFFSET_METERS),
    );
    entry.material.map = textureFor(decal.textureUrl);
    entry.material.opacity = 1;
    entry.material.needsUpdate = true;
    entry.mesh.quaternion.setFromUnitVectors(planeNormal, normal);
    // Full roll plus a size jitter, so a burst into one wall is not a stack of
    // identical stamps.
    entry.mesh.rotateOnAxis(planeNormal, Math.random() * Math.PI * 2);
    entry.mesh.scale.setScalar(renderScale * (0.82 + Math.random() * 0.46));
    entry.mesh.visible = true;
  }

  function update(dt: number, focusPosition: Vec3, visible: boolean): void {
    const maxDistanceSquared =
      HIT_DECAL_VISIBLE_DISTANCE_METERS * HIT_DECAL_VISIBLE_DISTANCE_METERS;
    const step = Math.max(0, dt);
    for (const entry of entries) {
      if (!entry.active) continue;
      entry.ageSeconds += step;
      if (entry.ageSeconds >= HIT_DECAL_HOLD_SECONDS + HIT_DECAL_FADE_SECONDS) {
        entry.active = false;
        entry.mesh.visible = false;
        continue;
      }
      const dx = entry.worldPosition.x - focusPosition.x;
      const dy = entry.worldPosition.y - focusPosition.y;
      const dz = entry.worldPosition.z - focusPosition.z;
      entry.mesh.visible = visible && dx * dx + dy * dy + dz * dz <= maxDistanceSquared;
      if (!entry.mesh.visible) continue;
      entry.material.opacity =
        entry.ageSeconds <= HIT_DECAL_HOLD_SECONDS
          ? 1
          : 1 - (entry.ageSeconds - HIT_DECAL_HOLD_SECONDS) / HIT_DECAL_FADE_SECONDS;
      entry.mesh.position.set(dx * renderScale, dy * renderScale, dz * renderScale);
    }
  }

  return {
    dispose() {
      for (const entry of entries) {
        entry.mesh.removeFromParent();
        entry.material.dispose();
      }
      for (const texture of textures.values()) texture.dispose();
      textures.clear();
      geometry.dispose();
    },
    spawn,
    update,
  };
}
