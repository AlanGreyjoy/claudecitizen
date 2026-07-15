import * as THREE from "three";
import { createParticleSystem } from "./system";
import type { ParticleSystemHandle } from "./system";

/** Register particle system updates on a prefab root group (mirrors updateAnimations). */
export function setupUpdateParticles(root: THREE.Group): void {
  const systems: ParticleSystemHandle[] = [];
  root.userData.particleSystems = systems;
  root.userData.registerParticleSystem = (handle: ParticleSystemHandle) => {
    systems.push(handle);
  };
  root.userData.updateParticles = (dt: number, camera?: THREE.Camera) => {
    for (const system of systems) system.update(dt, camera);
  };
  root.userData.disposeParticleSystems = () => {
    for (const system of systems) system.dispose();
    systems.length = 0;
  };
}

export function attachParticleSystemToEntity(
  root: THREE.Group | undefined,
  entityGroup: THREE.Object3D,
  component: Parameters<typeof createParticleSystem>[0],
): ParticleSystemHandle {
  const handle = createParticleSystem(component);
  entityGroup.add(handle.object3d);
  if (root?.userData.registerParticleSystem) {
    root.userData.registerParticleSystem(handle);
  }
  return handle;
}
