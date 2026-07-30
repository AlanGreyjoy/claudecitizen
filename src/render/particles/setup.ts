import type * as THREE from "three";
import { createParticleSystem } from "./system";
import type { ParticleSystemHandle } from "./system";
import type { ParticleMaterialFactory } from "./material";

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

/** Advances every prefab particle host nested anywhere under a preview root. */
export function updateNestedParticleSystems(
  root: THREE.Object3D,
  dt: number,
  camera?: THREE.Camera,
): void {
  root.traverse((object) => {
    object.userData.updateParticles?.(dt, camera);
  });
}

/** Disposes every prefab particle host before its owning scene graph is cleared. */
export function disposeNestedParticleSystems(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.userData.disposeParticleSystems?.();
  });
}

export function attachParticleSystemToEntity(
  root: THREE.Group | undefined,
  entityGroup: THREE.Object3D,
  component: Parameters<typeof createParticleSystem>[0],
  options: { materialFactory?: ParticleMaterialFactory } = {},
): ParticleSystemHandle {
  const handle = createParticleSystem(component, {
    materialFactory: options.materialFactory,
  });
  entityGroup.add(handle.object3d);
  if (root?.userData.registerParticleSystem) {
    root.userData.registerParticleSystem(handle);
  }
  return handle;
}
