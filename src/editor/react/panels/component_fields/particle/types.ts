import type { PrefabComponent } from '../../../../../world/prefabs/schema';

export type ParticleComponent = Extract<PrefabComponent, { type: 'particle-system' }>;

export type ParticleModuleProps = {
  component: ParticleComponent;
  update: (next: ParticleComponent) => void;
};
