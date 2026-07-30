import type * as THREE from "three";
import type { ParticlePreviewControls } from "../../editor/panels/particle-preview";
import { disposeOwnedGpuResources } from "../assets/gpu-dispose";
import type { ParticleSystemHandle } from "../particles";

export interface ViewportParticles {
  preview: ParticlePreviewControls;
  register: (entityId: string, handle: ParticleSystemHandle) => void;
  registerPrefabRoot: (entityId: string, root: THREE.Group) => void;
  disposeForEntity: (entityId: string) => void;
  disposePrefabRootsForEntity: (entityId: string) => void;
  discardPrefabRoot: (root: THREE.Group) => void;
  disposeAll: () => void;
  update: (dt: number, camera: THREE.Camera) => void;
}

export function createViewportParticles(): ViewportParticles {
  const particleHandles = new Map<string, ParticleSystemHandle[]>();
  const prefabRoots = new Map<string, Set<THREE.Group>>();

  function disposePrefabRoot(root: THREE.Group): void {
    root.userData.disposeParticleSystems?.();
    disposeOwnedGpuResources(root);
  }

  function disposePrefabRootsForEntity(entityId: string): void {
    const roots = prefabRoots.get(entityId);
    if (!roots) return;
    for (const root of roots) disposePrefabRoot(root);
    prefabRoots.delete(entityId);
  }

  function disposeParticleHandles(): void {
    for (const handles of particleHandles.values()) {
      for (const handle of handles) handle.dispose();
    }
    particleHandles.clear();
    for (const entityId of [...prefabRoots.keys()]) {
      disposePrefabRootsForEntity(entityId);
    }
  }

  function disposeParticleHandlesForEntity(entityId: string): void {
    const handles = particleHandles.get(entityId);
    if (!handles) return;
    for (const handle of handles) handle.dispose();
    particleHandles.delete(entityId);
  }

  function registerParticleHandle(
    entityId: string,
    handle: ParticleSystemHandle,
  ): void {
    const list = particleHandles.get(entityId) ?? [];
    list.push(handle);
    particleHandles.set(entityId, list);
  }

  const particlePreview: ParticlePreviewControls = {
    restart(entityId) {
      for (const handle of particleHandles.get(entityId) ?? []) handle.restart();
    },
    setPlaying(entityId, playing) {
      for (const handle of particleHandles.get(entityId) ?? []) {
        handle.setPlaying(playing);
      }
    },
    isPlaying(entityId) {
      const handles = particleHandles.get(entityId) ?? [];
      if (handles.length === 0) return true;
      return handles.some((handle) => handle.isPlaying());
    },
  };

  return {
    preview: particlePreview,
    register: registerParticleHandle,
    registerPrefabRoot(entityId, root) {
      const roots = prefabRoots.get(entityId) ?? new Set<THREE.Group>();
      roots.add(root);
      prefabRoots.set(entityId, roots);
    },
    disposeForEntity: disposeParticleHandlesForEntity,
    disposePrefabRootsForEntity,
    discardPrefabRoot(root) {
      for (const [entityId, roots] of prefabRoots) {
        if (!roots.delete(root)) continue;
        if (roots.size === 0) prefabRoots.delete(entityId);
        break;
      }
      disposePrefabRoot(root);
    },
    disposeAll: disposeParticleHandles,
    update(dt, camera) {
      for (const handles of particleHandles.values()) {
        for (const handle of handles) handle.update(dt, camera);
      }
      for (const roots of prefabRoots.values()) {
        for (const root of roots) root.userData.updateParticles?.(dt, camera);
      }
    },
  };
}
