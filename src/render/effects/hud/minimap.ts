import { cross, dot, normalize, vec3 } from '../../../math/vec3';
import {
  cartesianFromLatLonAlt,
  eastVector,
  radialUp,
} from '../../../world/coordinates';
import { resolveLandingSite } from '../../../world/landing_sites';
import { sampleRenderablePlanetSurface } from '../../../world/planet_surface';
import type { Biome, Planet, Vec3 } from '../../../types';

const GRID_SIZE = 48;
const RANGE_METERS = 520;
const TERRAIN_REFRESH_MS = 250;
const TERRAIN_MOVE_THRESHOLD = 50;

export interface MinimapUpdateParams {
  planet: Planet;
  seed: number;
  focusPosition: Vec3;
  focusForward: Vec3;
  shipPosition: Vec3;
  shipForward: Vec3;
  characterPosition: Vec3;
  showCharacter: boolean;
  nowMs: number;
}

function biomeColor(biome: Biome): string {
  switch (biome) {
    case 'forest':
      return '#2d5a38';
    case 'plains':
      return '#4a7044';
    case 'lake':
      return '#2a5a7a';
    case 'river':
      return '#33688a';
    case 'ocean':
      return '#1a3a5a';
    case 'beach':
      return '#8a9070';
    case 'desert':
      return '#8a7548';
    case 'tundra':
      return '#6a7880';
    case 'highlands':
      return '#5a5850';
    case 'peak':
      return '#707068';
    case 'rock':
    default:
      return '#555560';
  }
}

function worldToLocalEastNorth(
  position: Vec3,
  origin: Vec3,
  east: Vec3,
  north: Vec3,
): { east: number; north: number } {
  const dx = position.x - origin.x;
  const dy = position.y - origin.y;
  const dz = position.z - origin.z;
  return {
    east: dx * east.x + dy * east.y + dz * east.z,
    north: dx * north.x + dy * north.y + dz * north.z,
  };
}

function localToWorld(
  eastMeters: number,
  northMeters: number,
  origin: Vec3,
  east: Vec3,
  north: Vec3,
): Vec3 {
  return vec3(
    origin.x + east.x * eastMeters + north.x * northMeters,
    origin.y + east.y * eastMeters + north.y * northMeters,
    origin.z + east.z * eastMeters + north.z * northMeters,
  );
}

function headingRadians(forward: Vec3, east: Vec3, north: Vec3): number {
  return Math.atan2(dot(forward, north), dot(forward, east));
}

export function createMinimap(canvas: HTMLCanvasElement, planet: Planet, seed: number) {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Minimap canvas 2d context unavailable.');
  }
  const ctx = context;

  const landingSite = resolveLandingSite(planet, seed);
  const originProbe = cartesianFromLatLonAlt(
    landingSite.latRadians,
    landingSite.lonRadians,
    0,
    planet.radiusMeters,
  );
  const originSurface = sampleRenderablePlanetSurface(planet, seed, originProbe);
  const origin = cartesianFromLatLonAlt(
    landingSite.latRadians,
    landingSite.lonRadians,
    originSurface.heightMeters,
    planet.radiusMeters,
  );
  const up = radialUp(origin);
  const east = eastVector(origin);
  const north = normalize(cross(up, east));

  let terrainCanvas: HTMLCanvasElement | null = null;
  let lastTerrainMs = 0;
  let lastTerrainEast = Number.NaN;
  let lastTerrainNorth = Number.NaN;
  let displaySize = 0;

  function mapScale(): number {
    return displaySize * 0.5;
  }

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(1, Math.round(Math.min(rect.width, rect.height)));
    if (size === displaySize) return;
    displaySize = size;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    terrainCanvas = null;
  }

  function rebuildTerrain(focusEast: number, focusNorth: number): void {
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = GRID_SIZE;
    gridCanvas.height = GRID_SIZE;
    const gridCtx = gridCanvas.getContext('2d');
    if (!gridCtx) return;

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const eastMeters = focusEast + ((x / (GRID_SIZE - 1)) * 2 - 1) * RANGE_METERS;
        const northMeters = focusNorth + ((y / (GRID_SIZE - 1)) * 2 - 1) * RANGE_METERS;
        const samplePosition = localToWorld(eastMeters, northMeters, origin, east, north);
        const surface = sampleRenderablePlanetSurface(planet, seed, samplePosition);
        gridCtx.fillStyle = biomeColor(surface.biome);
        gridCtx.fillRect(x, y, 1, 1);
      }
    }

    terrainCanvas = gridCanvas;
  }

  function drawMarker(
    localEast: number,
    localNorth: number,
    focusEast: number,
    focusNorth: number,
    radius: number,
    fill: string,
    stroke: string,
  ): void {
    const px = ((localEast - focusEast) / RANGE_METERS) * mapScale();
    const py = -((localNorth - focusNorth) / RANGE_METERS) * mapScale();
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawShipMarker(
    localEast: number,
    localNorth: number,
    focusEast: number,
    focusNorth: number,
    heading: number,
  ): void {
    const px = ((localEast - focusEast) / RANGE_METERS) * mapScale();
    const py = -((localNorth - focusNorth) / RANGE_METERS) * mapScale();
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-heading);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 206, 111, 0.95)';
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.9)';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  function drawBracketFrame(): void {
    const inset = 1;
    const len = 12;
    const half = displaySize / 2;

    ctx.strokeStyle = 'rgba(90, 190, 255, 0.55)';
    ctx.lineWidth = 1.5;
    const corners = [
      [-half + inset, -half + inset],
      [half - inset, -half + inset],
      [half - inset, half - inset],
      [-half + inset, half - inset],
    ];
    for (const [cx, cy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + (cy < 0 ? len : -len));
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + (cx < 0 ? len : -len), cy);
      ctx.stroke();
    }
  }

  function drawNorthTick(heading: number): void {
    const half = displaySize / 2;
    const radius = half - 3;
    const nx = Math.sin(heading) * radius;
    const ny = -Math.cos(heading) * radius;
    ctx.strokeStyle = 'rgba(139, 216, 255, 0.85)';
    ctx.fillStyle = 'rgba(139, 216, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(nx - Math.sin(heading) * 6, ny + Math.cos(heading) * 6);
    ctx.stroke();
    ctx.font = '9px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx - Math.sin(heading) * 12, ny + Math.cos(heading) * 12);
  }

  function update({
    focusPosition,
    focusForward,
    shipPosition,
    shipForward,
    characterPosition,
    showCharacter,
    nowMs,
  }: MinimapUpdateParams): void {
    resize();
    if (displaySize <= 0) return;

    const focusLocal = worldToLocalEastNorth(focusPosition, origin, east, north);
    const shipLocal = worldToLocalEastNorth(shipPosition, origin, east, north);
    const characterLocal = worldToLocalEastNorth(characterPosition, origin, east, north);
    const heading = headingRadians(focusForward, east, north);

    const movedEnough =
      Number.isNaN(lastTerrainEast) ||
      Number.isNaN(lastTerrainNorth) ||
      Math.hypot(focusLocal.east - lastTerrainEast, focusLocal.north - lastTerrainNorth) >
        TERRAIN_MOVE_THRESHOLD;
    if (
      !terrainCanvas ||
      nowMs - lastTerrainMs > TERRAIN_REFRESH_MS ||
      movedEnough
    ) {
      rebuildTerrain(focusLocal.east, focusLocal.north);
      lastTerrainMs = nowMs;
      lastTerrainEast = focusLocal.east;
      lastTerrainNorth = focusLocal.north;
    }

    const half = displaySize / 2;
    ctx.clearRect(0, 0, displaySize, displaySize);
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(-heading);

    if (terrainCanvas) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(terrainCanvas, -half, -half, displaySize, displaySize);
    }

    drawShipMarker(
      shipLocal.east,
      shipLocal.north,
      focusLocal.east,
      focusLocal.north,
      headingRadians(shipForward, east, north) - heading,
    );

    if (showCharacter) {
      drawMarker(
        characterLocal.east,
        characterLocal.north,
        focusLocal.east,
        focusLocal.north,
        4,
        'rgba(139, 216, 255, 0.95)',
        'rgba(220, 240, 255, 0.9)',
      );
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = 'rgba(200, 230, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(4, 4);
    ctx.lineTo(0, 1);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    drawNorthTick(heading);
    drawBracketFrame();
  }

  return { update, resize };
}
