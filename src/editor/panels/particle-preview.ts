/** Viewport particle preview controls (editor play / viewport). */
export interface ParticlePreviewControls {
  restart: (entityId: string) => void;
  setPlaying: (entityId: string, playing: boolean) => void;
  isPlaying: (entityId: string) => boolean;
}
