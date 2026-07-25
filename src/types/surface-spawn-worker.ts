import type { Planet } from './planet';
import type { PlanetSpawnCatalog, SurfaceSpawnInstance } from './surface_spawn';
import type { TileInfo } from './terrain';
import type { PlanetDocument } from '../world/planets/schema';

export interface SurfaceSpawnWorkerInMessage {
  buildId: number;
  key: string;
  info: TileInfo;
  planet: Planet;
  planetDocument: PlanetDocument;
  seed: number;
  catalog: PlanetSpawnCatalog;
}

export interface SurfaceSpawnWorkerSuccessMessage {
  buildId: number;
  key: string;
  instances: SurfaceSpawnInstance[];
}

export interface SurfaceSpawnWorkerErrorMessage {
  buildId: number;
  key: string;
  error: string;
}

export interface SurfaceSpawnWorkerReadyMessage {
  ready: true;
}

export type SurfaceSpawnWorkerOutMessage =
  | SurfaceSpawnWorkerReadyMessage
  | SurfaceSpawnWorkerSuccessMessage
  | SurfaceSpawnWorkerErrorMessage;
