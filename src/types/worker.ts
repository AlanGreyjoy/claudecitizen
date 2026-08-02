import type { Planet } from './planet';
import type { SurfaceWaterBuffers, TileInfo } from './terrain';
import type { PlanetDocument } from '../world/planets/schema';
import type { TileHeightRaster } from '../world/terrain-raster';

export interface TileWorkerInMessage {
  buildId: number;
  key: string;
  info: TileInfo;
  planet: Planet;
  /** Full planet document so the worker activates the same generation knobs. */
  planetDocument: PlanetDocument;
  seed: number;
}

export interface TileWorkerSuccessMessage {
  /** Wall-clock cost of generation inside the worker, for the stats panel. */
  buildMs: number;
  buildId: number;
  key: string;
  /**
   * Band-limited height field on the shared renderable grid.
   *
   * This and `gridColors` are the whole tile now — the shared grid displaces one
   * geometry from them, foot placement samples them through the page table, and
   * they are what gets persisted. A tile used to also ship ~110 KB of positions,
   * normals and vertex colours on top of this; dropping them cuts the transfer
   * and the structured clone to roughly a third.
   */
  raster: TileHeightRaster;
  /** Per-grid-corner RGB for the shared-grid renderer's colour atlas. */
  gridColors: Float32Array;
}

export interface TileWorkerErrorMessage {
  buildId: number;
  key: string;
  error: string;
}

/** Startup handshake proving the worker script actually executes. */
export interface TileWorkerReadyMessage {
  ready: true;
}

export type TileWorkerOutMessage =
  | TileWorkerReadyMessage
  | TileWorkerSuccessMessage
  | TileWorkerErrorMessage;

export type WaterWorkerInMessage = TileWorkerInMessage;

export interface WaterWorkerSuccessMessage {
  buildId: number;
  key: string;
  buffers: SurfaceWaterBuffers | null;
}

export type WaterWorkerErrorMessage = TileWorkerErrorMessage;

export type WaterWorkerOutMessage =
  | TileWorkerReadyMessage
  | WaterWorkerSuccessMessage
  | WaterWorkerErrorMessage;
