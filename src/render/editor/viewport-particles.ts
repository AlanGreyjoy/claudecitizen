import type * as THREE from "three";
import type { ParticlePreviewControls } from "../../editor/panels/particle_fields";
import type { ParticleSystemHandle } from "../particles";

export interface ViewportParticles {
  preview: ParticlePreviewControls;
  register: (entityId: string, handle: ParticleSystemHandle) => void;
  disposeAll: () => void;
  update: (dt: number, camera: THREE.Camera) => void;
}

export function createViewportParticles(): ViewportParticles {
  const particleHandles = new Map<string, ParticleSystemHandle[]>();

  function disposeParticleHandles(): void {
    for (const handles of particleHandles.values()) {
      for (const handle of handles) handle.dispose();
    }
    particleHandles.clear();
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
    disposeAll: disposeParticleHandles,
    update(dt, camera) {
      for (const handles of particleHandles.values()) {
        for (const handle of handles) handle.update(dt, camera);
      }
    },
  };
}
