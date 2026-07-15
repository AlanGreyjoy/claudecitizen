/** Soft global live-particle budget across all prefab emitters. */
const GLOBAL_LIVE_PARTICLE_BUDGET = 4096;

let globalLiveParticles = 0;

export function getGlobalLiveParticles(): number {
  return globalLiveParticles;
}

export function getGlobalParticleBudget(): number {
  return GLOBAL_LIVE_PARTICLE_BUDGET;
}

export function reserveParticleSlots(count: number): number {
  if (count <= 0) return 0;
  const available = Math.max(0, GLOBAL_LIVE_PARTICLE_BUDGET - globalLiveParticles);
  const granted = Math.min(count, available);
  globalLiveParticles += granted;
  return granted;
}

export function releaseParticleSlots(count: number): void {
  if (count <= 0) return;
  globalLiveParticles = Math.max(0, globalLiveParticles - count);
}

/** Spawn scale 0..1 when the global budget is under pressure. */
export function globalSpawnScale(): number {
  const used = globalLiveParticles / GLOBAL_LIVE_PARTICLE_BUDGET;
  if (used < 0.75) return 1;
  if (used >= 1) return 0;
  return 1 - (used - 0.75) / 0.25;
}
