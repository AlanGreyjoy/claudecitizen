import type { Planet } from './planet';
import type { TileInfo } from './terrain';
import type { VegetationSettings } from './vegetation';
import type { PlanetDocument } from '../world/planets/schema';
import type { VegetationAssetCatalog } from '../render/vegetation/domain/asset-catalog';
import type { PackedVegetationInstances } from '../render/vegetation/domain/packed-instances';

/**
 * Per-worker copy of the quality budgets that `configureVegetationDensity`
 * installs on the main thread. Workers get their own module instance, so the
 * counts have to ride along with the job.
 */
export interface VegetationDensityBudgets {
  grassSampleCount: number;
  treeSampleCount: number;
  vegetationTileDistanceMeters: number;
}

export interface VegetationWorkerInMessage {
  assets: VegetationAssetCatalog;
  buildId: number;
  density: VegetationDensityBudgets;
  info: TileInfo;
  key: string;
  planet: Planet;
  planetDocument: PlanetDocument;
  seed: number;
  settings: VegetationSettings;
}

export interface VegetationWorkerSuccessMessage {
  anchor: { x: number; y: number; z: number };
  buildId: number;
  grass: PackedVegetationInstances;
  key: string;
  trees: PackedVegetationInstances;
}

export interface VegetationWorkerErrorMessage {
  buildId: number;
  error: string;
  key: string;
}

export interface VegetationWorkerReadyMessage {
  ready: true;
}

export type VegetationWorkerOutMessage =
  | VegetationWorkerReadyMessage
  | VegetationWorkerSuccessMessage
  | VegetationWorkerErrorMessage;
