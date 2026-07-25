/**
 * System Map canvas controller — top-down ecliptic authoring view.
 * Screen X = system `x`, screen Y = −system `z` (+z up on map).
 */
import {
  SYSTEM_MAP_PLANET_DISTANCE_METERS,
  SYSTEM_STAR_PARENT_ID,
  type SystemDocument,
  type SystemPlanetEntry,
  type SystemStationEntry,
} from '../../world/systems/schema';

export type SystemMapSelection =
  | { kind: 'none' }
  | { kind: 'planet'; id: string }
  | { kind: 'station'; id: string };

interface EclipticPos {
  x: number;
  z: number;
}

export interface SystemMapCanvasCallbacks {
  getDocument: () => SystemDocument;
  getSelection: () => SystemMapSelection;
  onSelectionChange: (selection: SystemMapSelection) => void;
  onDirty: () => void;
  onDragEnd: () => void;
}

export interface SystemMapCanvasController {
  activate: () => void;
  deactivate: () => void;
  dispose: () => void;
  requestRedraw: () => void;
  fitView: () => void;
}

function planetWorldPos(planet: SystemPlanetEntry): EclipticPos {
  return { ...planet.positionMeters };
}

function stationWorldPos(doc: SystemDocument, station: SystemStationEntry): EclipticPos {
  if (station.parentBodyId === SYSTEM_STAR_PARENT_ID) {
    return { ...station.offsetMeters };
  }
  const parent = doc.planets.find((planet) => planet.id === station.parentBodyId);
  if (!parent) return { ...station.offsetMeters };
  return {
    x: parent.positionMeters.x + station.offsetMeters.x,
    z: parent.positionMeters.z + station.offsetMeters.z,
  };
}

function niceGridStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  if (n < 1.5) return pow;
  if (n < 3.5) return 2 * pow;
  if (n < 7.5) return 5 * pow;
  return 10 * pow;
}

export function createSystemMapCanvas(
  mapHost: HTMLElement,
  callbacks: SystemMapCanvasCallbacks,
): SystemMapCanvasController {
  let active = false;
  let raf = 0;
  let needsRedraw = true;

  let viewCenterX = SYSTEM_MAP_PLANET_DISTANCE_METERS * 0.5;
  let viewCenterZ = 0;
  let metersPerPixel = SYSTEM_MAP_PLANET_DISTANCE_METERS / 280;
  let panning = false;
  let panLastX = 0;
  let panLastY = 0;
  let dragging: SystemMapSelection = { kind: 'none' };

  const hint = document.createElement('div');
  hint.className = 'ed-system-map-hint';
  hint.textContent = 'LMB select/drag · MMB pan · wheel zoom · +z up on map';

  const canvas = document.createElement('canvas');
  canvas.className = 'ed-system-canvas';
  const mapCtxOrNull = canvas.getContext('2d');
  if (!mapCtxOrNull) throw new Error('System Map requires a 2D canvas context');
  const mapCtx: CanvasRenderingContext2D = mapCtxOrNull;
  mapHost.replaceChildren(canvas, hint);

  function worldToScreen(wx: number, wz: number): { x: number; y: number } {
    const ppm = 1 / metersPerPixel;
    return {
      x: (wx - viewCenterX) * ppm + canvas.width / 2,
      y: -(wz - viewCenterZ) * ppm + canvas.height / 2,
    };
  }

  function screenToWorld(sx: number, sy: number): EclipticPos {
    const ppm = 1 / metersPerPixel;
    return {
      x: (sx - canvas.width / 2) / ppm + viewCenterX,
      z: -((sy - canvas.height / 2) / ppm) + viewCenterZ,
    };
  }

  function hitTest(sx: number, sy: number): SystemMapSelection {
    const documentState = callbacks.getDocument();
    const hitRadius = 22;
    for (const station of documentState.stations) {
      const pos = stationWorldPos(documentState, station);
      const screen = worldToScreen(pos.x, pos.z);
      if (Math.hypot(screen.x - sx, screen.y - sy) <= hitRadius) {
        return { kind: 'station', id: station.id };
      }
    }
    for (const planet of documentState.planets) {
      const pos = planetWorldPos(planet);
      const screen = worldToScreen(pos.x, pos.z);
      if (Math.hypot(screen.x - sx, screen.y - sy) <= hitRadius) {
        return { kind: 'planet', id: planet.id };
      }
    }
    return { kind: 'none' };
  }

  function fitView(): void {
    const documentState = callbacks.getDocument();
    const points: EclipticPos[] = [{ x: 0, z: 0 }];
    for (const planet of documentState.planets) points.push(planetWorldPos(planet));
    for (const station of documentState.stations) {
      points.push(stationWorldPos(documentState, station));
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    viewCenterX = (minX + maxX) * 0.5;
    viewCenterZ = (minZ + maxZ) * 0.5;
    const span = Math.max(maxX - minX, maxZ - minZ, SYSTEM_MAP_PLANET_DISTANCE_METERS * 0.2);
    const size = Math.max(canvas.clientWidth, canvas.clientHeight, 1);
    metersPerPixel = (span * 1.35) / size;
    needsRedraw = true;
  }

  function resizeCanvas(): void {
    const width = Math.max(1, Math.floor(mapHost.clientWidth));
    const height = Math.max(1, Math.floor(mapHost.clientHeight));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      needsRedraw = true;
    }
  }

  function drawMapGrid(width: number, height: number): void {
    const gridStep = niceGridStep(metersPerPixel * 80);
    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(width, height);
    const minX = Math.min(topLeft.x, bottomRight.x);
    const maxX = Math.max(topLeft.x, bottomRight.x);
    const minZ = Math.min(topLeft.z, bottomRight.z);
    const maxZ = Math.max(topLeft.z, bottomRight.z);
    mapCtx.strokeStyle = 'rgba(90, 190, 255, 0.08)';
    mapCtx.lineWidth = 1;
    mapCtx.beginPath();
    for (let x = Math.floor(minX / gridStep) * gridStep; x <= maxX; x += gridStep) {
      const a = worldToScreen(x, minZ);
      const b = worldToScreen(x, maxZ);
      mapCtx.moveTo(a.x, a.y);
      mapCtx.lineTo(b.x, b.y);
    }
    for (let z = Math.floor(minZ / gridStep) * gridStep; z <= maxZ; z += gridStep) {
      const a = worldToScreen(minX, z);
      const b = worldToScreen(maxX, z);
      mapCtx.moveTo(a.x, a.y);
      mapCtx.lineTo(b.x, b.y);
    }
    mapCtx.stroke();
  }

  function drawStationParentLines(documentState: SystemDocument): void {
    for (const station of documentState.stations) {
      const parentPos =
        station.parentBodyId === SYSTEM_STAR_PARENT_ID
          ? { x: 0, z: 0 }
          : documentState.planets.find((planet) => planet.id === station.parentBodyId)
              ?.positionMeters ?? { x: 0, z: 0 };
      const world = stationWorldPos(documentState, station);
      const from = worldToScreen(parentPos.x, parentPos.z);
      const to = worldToScreen(world.x, world.z);
      mapCtx.strokeStyle = 'rgba(255, 180, 90, 0.35)';
      mapCtx.setLineDash([4, 4]);
      mapCtx.beginPath();
      mapCtx.moveTo(from.x, from.y);
      mapCtx.lineTo(to.x, to.y);
      mapCtx.stroke();
      mapCtx.setLineDash([]);
    }
  }

  function drawStar(documentState: SystemDocument): void {
    const star = worldToScreen(0, 0);
    mapCtx.fillStyle = '#ffd27a';
    mapCtx.beginPath();
    mapCtx.arc(star.x, star.y, 10, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = '#ffe9b8';
    mapCtx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    mapCtx.fillText(documentState.star.name, star.x + 14, star.y + 4);
  }

  function drawPlanets(documentState: SystemDocument, selection: SystemMapSelection): void {
    for (const planet of documentState.planets) {
      const pos = planetWorldPos(planet);
      const screen = worldToScreen(pos.x, pos.z);
      const selected = selection.kind === 'planet' && selection.id === planet.id;
      mapCtx.fillStyle = selected ? '#7ad0ff' : '#3f9ae8';
      mapCtx.strokeStyle = selected ? '#dff4ff' : 'rgba(180, 220, 255, 0.7)';
      mapCtx.lineWidth = selected ? 2.5 : 1.5;
      mapCtx.beginPath();
      mapCtx.arc(screen.x, screen.y, selected ? 16 : 13, 0, Math.PI * 2);
      mapCtx.fill();
      mapCtx.stroke();
      mapCtx.fillStyle = '#cfe9ff';
      mapCtx.fillText(planet.name ?? planet.planetId, screen.x + 18, screen.y + 4);
    }
  }

  function drawStations(documentState: SystemDocument, selection: SystemMapSelection): void {
    for (const station of documentState.stations) {
      const pos = stationWorldPos(documentState, station);
      const screen = worldToScreen(pos.x, pos.z);
      const selected = selection.kind === 'station' && selection.id === station.id;
      const size = selected ? 9 : 7;
      mapCtx.fillStyle = selected ? '#ffc27a' : '#e09845';
      mapCtx.strokeStyle = selected ? '#ffe6c4' : 'rgba(255, 210, 160, 0.75)';
      mapCtx.lineWidth = selected ? 2.5 : 1.5;
      mapCtx.beginPath();
      mapCtx.moveTo(screen.x, screen.y - size);
      mapCtx.lineTo(screen.x + size, screen.y);
      mapCtx.lineTo(screen.x, screen.y + size);
      mapCtx.lineTo(screen.x - size, screen.y);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.stroke();
      mapCtx.fillStyle = '#ffe6c4';
      mapCtx.fillText(station.name, screen.x + 12, screen.y + 4);
    }
  }

  function draw(): void {
    resizeCanvas();
    const documentState = callbacks.getDocument();
    const selection = callbacks.getSelection();
    const width = canvas.width;
    const height = canvas.height;
    mapCtx.fillStyle = '#050b14';
    mapCtx.fillRect(0, 0, width, height);
    drawMapGrid(width, height);
    drawStationParentLines(documentState);
    drawStar(documentState);
    drawPlanets(documentState, selection);
    drawStations(documentState, selection);
    needsRedraw = false;
  }

  function tick(): void {
    if (!active) return;
    if (needsRedraw) draw();
    raf = requestAnimationFrame(tick);
  }

  function applyDragWorld(world: EclipticPos): void {
    const documentState = callbacks.getDocument();
    const drag = dragging;
    if (drag.kind === 'planet') {
      const planet = documentState.planets.find((entry) => entry.id === drag.id);
      if (!planet) return;
      planet.positionMeters = { x: world.x, z: world.z };
      callbacks.onDirty();
      return;
    }
    if (drag.kind === 'station') {
      const station = documentState.stations.find((entry) => entry.id === drag.id);
      if (!station) return;
      const parentPos =
        station.parentBodyId === SYSTEM_STAR_PARENT_ID
          ? { x: 0, z: 0 }
          : documentState.planets.find((planet) => planet.id === station.parentBodyId)
              ?.positionMeters ?? { x: 0, z: 0 };
      station.offsetMeters = {
        x: world.x - parentPos.x,
        z: world.z - parentPos.z,
      };
      callbacks.onDirty();
    }
  }

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    if (event.button === 1) {
      panning = true;
      panLastX = event.clientX;
      panLastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const hit = hitTest(sx, sy);
    callbacks.onSelectionChange(hit);
    if (hit.kind !== 'none') {
      dragging = hit;
      canvas.setPointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (panning) {
      const dx = event.clientX - panLastX;
      const dy = event.clientY - panLastY;
      panLastX = event.clientX;
      panLastY = event.clientY;
      viewCenterX -= dx * metersPerPixel;
      viewCenterZ += dy * metersPerPixel;
      needsRedraw = true;
      return;
    }
    if (dragging.kind === 'none') return;
    const rect = canvas.getBoundingClientRect();
    applyDragWorld(screenToWorld(event.clientX - rect.left, event.clientY - rect.top));
    needsRedraw = true;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 1) panning = false;
    if (event.button === 0 && dragging.kind !== 'none') {
      dragging = { kind: 'none' };
      callbacks.onDragEnd();
    }
  });
  canvas.addEventListener('pointercancel', () => {
    panning = false;
    dragging = { kind: 'none' };
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const before = screenToWorld(sx, sy);
      const factor = Math.pow(1.12, event.deltaY > 0 ? 1 : -1);
      metersPerPixel = Math.min(
        SYSTEM_MAP_PLANET_DISTANCE_METERS / 40,
        Math.max(SYSTEM_MAP_PLANET_DISTANCE_METERS / 200_000, metersPerPixel * factor),
      );
      const after = screenToWorld(sx, sy);
      viewCenterX += before.x - after.x;
      viewCenterZ += before.z - after.z;
      needsRedraw = true;
    },
    { passive: false },
  );

  return {
    activate: () => {
      active = true;
      needsRedraw = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    },
    deactivate: () => {
      active = false;
      cancelAnimationFrame(raf);
    },
    dispose: () => {
      cancelAnimationFrame(raf);
    },
    requestRedraw: () => {
      needsRedraw = true;
    },
    fitView,
  };
}

export { stationWorldPos };
