export type { ParticleSystemHandle } from "./system";
export { createParticleSystem } from "./system";
export type {
  ParticleMaterialFactory,
  ParticleMaterialHandle,
  ParticleMaterialOptions,
} from "./material";
export {
  getGlobalLiveParticles,
  getGlobalParticleBudget,
} from "./budget";
export { createParticleShapeHelper } from "./shape-helper";
export {
  setupUpdateParticles,
  attachParticleSystemToEntity,
  updateNestedParticleSystems,
  disposeNestedParticleSystems,
} from "./setup";
export { attachPrefabParticleSystems } from "./prefab-attach";
