import * as THREE from 'three';
import type { Vec3 } from '../../types';

const TRACER_POOL_SIZE = 20;
const TRACER_LIFETIME_SECONDS = 0.08;
const TRACER_WIDTH_METERS = 0.035;
const TRACER_MIN_LENGTH_METERS = 0.08;
/** Cosmetic cadence: 1 = every shot; 3 ≈ classic tracer belts. */
const TRACER_EVERY_N_SHOTS = 1;

interface TracerEntry {
  group: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  remainingSeconds: number;
  worldEnd: Vec3;
  worldStart: Vec3;
}

export interface TracerSpawn {
  end: Vec3;
  start: Vec3;
}

export interface TracerRenderer {
  dispose(): void;
  spawn(tracer: TracerSpawn): void;
  update(dt: number, focusPosition: Vec3, visible: boolean): void;
}

export function createTracerRenderer(
  scene: THREE.Scene,
  renderScale: number,
): TracerRenderer {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const lengthAxis = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const entries: TracerEntry[] = [];
  let cursor = 0;
  let shotCounter = 0;

  for (let index = 0; index < TRACER_POOL_SIZE; index += 1) {
    const group = new THREE.Group();
    const materials: THREE.MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index % 2 === 0 ? 0xffe08a : 0xff9a3c,
        depthWrite: false,
        opacity: 0,
        side: THREE.DoubleSide,
        transparent: true,
      });
      const plane = new THREE.Mesh(geometry, material);
      plane.rotation.y = rotation;
      group.add(plane);
      materials.push(material);
    }
    group.visible = false;
    scene.add(group);
    entries.push({
      group,
      materials,
      remainingSeconds: 0,
      worldEnd: { x: 0, y: 0, z: 0 },
      worldStart: { x: 0, y: 0, z: 0 },
    });
  }

  function spawn(tracer: TracerSpawn): void {
    shotCounter += 1;
    if (shotCounter % TRACER_EVERY_N_SHOTS !== 0) return;

    const dx = tracer.end.x - tracer.start.x;
    const dy = tracer.end.y - tracer.start.y;
    const dz = tracer.end.z - tracer.start.z;
    const lengthMeters = Math.hypot(dx, dy, dz);
    if (lengthMeters < TRACER_MIN_LENGTH_METERS) return;

    const entry = entries[cursor]!;
    cursor = (cursor + 1) % entries.length;
    entry.worldStart = { ...tracer.start };
    entry.worldEnd = { ...tracer.end };
    entry.remainingSeconds = TRACER_LIFETIME_SECONDS;
    entry.group.visible = true;
    for (const material of entry.materials) material.opacity = 1;
  }

  function update(dt: number, focusPosition: Vec3, visible: boolean): void {
    for (const entry of entries) {
      entry.remainingSeconds = Math.max(0, entry.remainingSeconds - Math.max(0, dt));
      const active = visible && entry.remainingSeconds > 0;
      entry.group.visible = active;
      if (!active) continue;

      direction
        .set(
          entry.worldEnd.x - entry.worldStart.x,
          entry.worldEnd.y - entry.worldStart.y,
          entry.worldEnd.z - entry.worldStart.z,
        );
      const lengthMeters = direction.length();
      if (lengthMeters < TRACER_MIN_LENGTH_METERS) {
        entry.group.visible = false;
        entry.remainingSeconds = 0;
        continue;
      }
      direction.multiplyScalar(1 / lengthMeters);
      midpoint.set(
        (entry.worldStart.x + entry.worldEnd.x) * 0.5,
        (entry.worldStart.y + entry.worldEnd.y) * 0.5,
        (entry.worldStart.z + entry.worldEnd.z) * 0.5,
      );
      entry.group.position.set(
        (midpoint.x - focusPosition.x) * renderScale,
        (midpoint.y - focusPosition.y) * renderScale,
        (midpoint.z - focusPosition.z) * renderScale,
      );
      entry.group.quaternion.setFromUnitVectors(lengthAxis, direction);
      entry.group.scale.set(
        TRACER_WIDTH_METERS * renderScale,
        lengthMeters * renderScale,
        1,
      );
      const opacity = Math.min(1, entry.remainingSeconds / (TRACER_LIFETIME_SECONDS * 0.55));
      for (const material of entry.materials) material.opacity = opacity;
    }
  }

  return {
    dispose() {
      for (const entry of entries) {
        entry.group.removeFromParent();
        for (const material of entry.materials) material.dispose();
      }
      geometry.dispose();
    },
    spawn,
    update,
  };
}
