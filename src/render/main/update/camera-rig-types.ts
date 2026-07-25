import type { StationFrame } from '../../../world/station';

export interface StationCameraContext {
  frame: StationFrame;
  roomId: string | null;
}
