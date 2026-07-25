import { RENDER_SURFACE_LEVEL } from './renderable_surface';

let footSurfaceSampleLevel = RENDER_SURFACE_LEVEL;

export function setFootSurfaceSampleLevel(level: number): void {
  footSurfaceSampleLevel = Math.max(0, Math.min(RENDER_SURFACE_LEVEL, level));
}

export function getFootSurfaceSampleLevel(): number {
  return footSurfaceSampleLevel;
}
