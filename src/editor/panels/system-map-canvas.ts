/**
 * System Map canvas controller — top-down ecliptic authoring view.
 * Screen X = system `x`, screen Y = −system `z` (+z up on map).
 */
import { MIN_QUANTUM_DISTANCE_METERS, quantumTripSeconds } from '../../flight/quantum-travel';
import { createSystemMapLegend } from './system-map-legend';
import {
  DEFAULT_STATION_ALTITUDE_METERS,
  SYSTEM_MAP_PLANET_DISTANCE_METERS,
  SYSTEM_STAR_PARENT_ID,
  type SystemDocument,
  type SystemPlanetEntry,
  type SystemStationEntry,
} from '../../world/systems/schema';
import { minimumOrbitRadiusMeters } from '../../world/systems/placement';

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
  /**
   * True surface radius of a planet document, or null when not loaded yet.
   * Without it the map draws planets as fixed-size icons, and a station dragged
   * "just above" one lands kilometres inside the crust — where play silently
   * relocates it to the minimum orbit shell.
   */
  getPlanetRadiusMeters?: (planetId: string) => number | null;
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

/** Map meters are play meters; label them at a readable magnitude. */
function formatMapDistance(meters: number): string {
  const abs = Math.abs(meters);
  if (abs < 1_000) return `${abs.toFixed(0)} m`;
  if (abs < 1e6) return `${(abs / 1e3).toPrecision(3)} km`;
  if (abs < 1e9) return `${(abs / 1e6).toPrecision(3)} Mm`;
  return `${(abs / 1e9).toPrecision(3)} Gm`;
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return `${seconds.toFixed(0)}s`;
  if (seconds < 5_400) return `${(seconds / 60).toPrecision(2)} min`;
  if (seconds < 172_800) return `${(seconds / 3_600).toPrecision(2)} hr`;
  return `${(seconds / 86_400).toPrecision(2)} days`;
}

/** Distance is meaningless without ship time — show both rulers. */
function formatMapLink(meters: number, referenceSpeedMps: number): string {
  const abs = Math.abs(meters);
  const cruise = formatDuration(abs / Math.max(referenceSpeedMps, 1));
  if (abs < MIN_QUANTUM_DISTANCE_METERS) return `${formatMapDistance(abs)} · ${cruise} cruise`;
  return `${formatMapDistance(abs)} · ${cruise} cruise · ${formatDuration(
    quantumTripSeconds(abs),
  )} quantum`;
}

function niceGridStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  if (n < 1.5) return pow;
  if (n < 3.5) return 2 * pow;
  if (n < 7.5) return 5 * pow;
  return 10 * pow;
}

/** Distance readout rotated along the dashed link, upright at any angle. */
function drawLinkDistanceLabel(
  mapCtx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  text: string,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 130) return;
  let angle = Math.atan2(dy, dx);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
  mapCtx.save();
  mapCtx.translate((from.x + to.x) * 0.5, (from.y + to.y) * 0.5);
  mapCtx.rotate(angle);
  mapCtx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
  mapCtx.textAlign = 'center';
  mapCtx.textBaseline = 'alphabetic';
  const width = mapCtx.measureText(text).width;
  mapCtx.fillStyle = 'rgba(5, 11, 20, 0.82)';
  mapCtx.fillRect(-width / 2 - 4, -15, width + 8, 14);
  mapCtx.fillStyle = 'rgba(255, 214, 168, 0.95)';
  mapCtx.fillText(text, 0, -5);
  mapCtx.restore();
}

/** The flyable part of a parent link. */
function strokeLink(
  mapCtx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  mapCtx.strokeStyle = 'rgba(255, 180, 90, 0.35)';
  mapCtx.lineWidth = 1;
  mapCtx.setLineDash([4, 4]);
  mapCtx.beginPath();
  mapCtx.moveTo(from.x, from.y);
  mapCtx.lineTo(to.x, to.y);
  mapCtx.stroke();
  mapCtx.setLineDash([]);
}

/**
 * The half of the offset buried in the parent body — drawn faint and tight so
 * it reads as "this part is the planet, not a distance you travel".
 */
function strokeBuriedLink(
  mapCtx: CanvasRenderingContext2D,
  centre: { x: number; y: number },
  surface: { x: number; y: number },
): void {
  mapCtx.strokeStyle = 'rgba(255, 180, 90, 0.16)';
  mapCtx.lineWidth = 1;
  mapCtx.setLineDash([2, 3]);
  mapCtx.beginPath();
  mapCtx.moveTo(centre.x, centre.y);
  mapCtx.lineTo(surface.x, surface.y);
  mapCtx.stroke();
  mapCtx.setLineDash([]);
}

type PlanetRadiusLookup = (planetId: string) => number | null;

/**
 * Planet body + the shell below which play refuses to place a station.
 *
 * Planets used to draw as fixed-size icons, so a station dragged "just above"
 * one could sit kilometres inside the crust with no feedback — and play would
 * then silently relocate it to the minimum orbit shell, which reads in-game as
 * the station (and anything exiting its hangar) sitting on the planet.
 */
function drawPlanetShell(
  mapCtx: CanvasRenderingContext2D,
  planet: SystemPlanetEntry,
  screen: { x: number; y: number },
  getRadius: PlanetRadiusLookup,
  metersToPixels: (meters: number) => number,
): void {
  const radiusMeters = getRadius(planet.planetId);
  if (radiusMeters === null || radiusMeters <= 0) return;
  const minOrbitPx = metersToPixels(
    minimumOrbitRadiusMeters(radiusMeters, DEFAULT_STATION_ALTITUDE_METERS),
  );
  // Below a few pixels the rings are noise; the planet icon already reads as "here".
  if (minOrbitPx < 3) return;

  mapCtx.beginPath();
  mapCtx.arc(screen.x, screen.y, metersToPixels(radiusMeters), 0, Math.PI * 2);
  mapCtx.fillStyle = 'rgba(90, 150, 220, 0.16)';
  mapCtx.fill();
  mapCtx.strokeStyle = 'rgba(150, 200, 255, 0.5)';
  mapCtx.lineWidth = 1;
  mapCtx.stroke();

  mapCtx.beginPath();
  mapCtx.arc(screen.x, screen.y, minOrbitPx, 0, Math.PI * 2);
  mapCtx.strokeStyle = 'rgba(255, 140, 90, 0.55)';
  mapCtx.setLineDash([5, 4]);
  mapCtx.stroke();
  mapCtx.setLineDash([]);
}

/**
 * True when play will relocate this station: its authored offset puts it inside
 * the parent's minimum orbit shell. Flagged at authoring time because the
 * in-game symptom (arriving on top of the planet) points nowhere near the map.
 */
function stationIsBuried(
  documentState: SystemDocument,
  station: SystemStationEntry,
  getRadius: PlanetRadiusLookup,
): boolean {
  if (station.parentBodyId === SYSTEM_STAR_PARENT_ID) return false;
  const parent = documentState.planets.find((entry) => entry.id === station.parentBodyId);
  if (!parent) return false;
  const radiusMeters = getRadius(parent.planetId);
  if (radiusMeters === null || radiusMeters <= 0) return false;
  const authored = Math.hypot(station.offsetMeters.x, station.offsetMeters.z);
  return (
    authored
    < minimumOrbitRadiusMeters(
      radiusMeters,
      station.altitudeMeters ?? DEFAULT_STATION_ALTITUDE_METERS,
    )
  );
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

  const legend = createSystemMapLegend(mapHost, {
    onReferenceSpeedChange: () => {
      needsRedraw = true;
    },
  });

  function worldToScreen(wx: number, wz: number): { x: number; y: number } {
    const ppm = 1 / metersPerPixel;
    return {
      x: (wx - viewCenterX) * ppm + canvas.width / 2,
      y: -(wz - viewCenterZ) * ppm + canvas.height / 2,
    };
  }

  /** Radius in meters as canvas pixels at the current zoom. */
  const planetRadius: PlanetRadiusLookup = (planetId) =>
    callbacks.getPlanetRadiusMeters?.(planetId) ?? null;

  function metersToPixels(meters: number): number {
    return meters / metersPerPixel;
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
    legend.setGridStepMeters(
      gridStep,
      `${formatMapDistance(gridStep)} · ${formatDuration(
        gridStep / Math.max(legend.getReferenceSpeedMps(), 1),
      )} cruise`,
    );
  }

  /** Classic map scale bar — the fastest read for "how big is this view". */
  function drawScaleBar(width: number, height: number): void {
    const targetPixels = Math.min(220, Math.max(120, width * 0.22));
    const meters = niceGridStep(targetPixels * metersPerPixel);
    const pixels = meters / metersPerPixel;
    const right = width - 16;
    const left = right - pixels;
    const baseY = height - 22;
    mapCtx.strokeStyle = 'rgba(190, 220, 255, 0.75)';
    mapCtx.lineWidth = 1.5;
    mapCtx.beginPath();
    mapCtx.moveTo(left, baseY - 5);
    mapCtx.lineTo(left, baseY + 5);
    mapCtx.moveTo(left, baseY);
    mapCtx.lineTo(right, baseY);
    mapCtx.moveTo(right, baseY - 5);
    mapCtx.lineTo(right, baseY + 5);
    mapCtx.stroke();
    mapCtx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    mapCtx.textAlign = 'right';
    mapCtx.fillStyle = '#cfe9ff';
    mapCtx.fillText(
      `${formatMapDistance(meters)} · ${formatDuration(
        meters / Math.max(legend.getReferenceSpeedMps(), 1),
      )} cruise`,
      right,
      baseY - 9,
    );
    mapCtx.textAlign = 'left';
  }

  /**
   * Parent link, split at the parent's surface.
   *
   * `offsetMeters` is measured from the parent's **centre**, so the raw link
   * runs straight through the planet body and its label reads like a gap when
   * most of it is just the radius. Drawing the buried half separately — and
   * labelling the outside half with altitude — makes the authored number and
   * the flyable distance visibly different things.
   */
  function drawStationParentLine(
    documentState: SystemDocument,
    station: SystemStationEntry,
  ): void {
    const parent =
      station.parentBodyId === SYSTEM_STAR_PARENT_ID
        ? null
        : documentState.planets.find((planet) => planet.id === station.parentBodyId) ?? null;
    const parentPos = parent ? parent.positionMeters : { x: 0, z: 0 };
    const world = stationWorldPos(documentState, station);
    const centre = worldToScreen(parentPos.x, parentPos.z);
    const to = worldToScreen(world.x, world.z);
    const centreMeters = Math.hypot(world.x - parentPos.x, world.z - parentPos.z);
    const radiusMeters = parent ? planetRadius(parent.planetId) : null;

    if (radiusMeters === null || radiusMeters <= 0 || radiusMeters >= centreMeters) {
      // No known body to sit inside — the whole link is the gap, as before.
      strokeLink(mapCtx, centre, to);
      drawLinkDistanceLabel(
        mapCtx,
        centre,
        to,
        formatMapLink(centreMeters, legend.getReferenceSpeedMps()),
      );
      return;
    }

    const t = radiusMeters / centreMeters;
    const surface = {
      x: centre.x + (to.x - centre.x) * t,
      y: centre.y + (to.y - centre.y) * t,
    };
    strokeBuriedLink(mapCtx, centre, surface);
    strokeLink(mapCtx, surface, to);
    // The label rides the part you can actually fly, and reads as altitude.
    drawLinkDistanceLabel(
      mapCtx,
      surface,
      to,
      `alt ${formatMapLink(centreMeters - radiusMeters, legend.getReferenceSpeedMps())}`,
    );
  }

  function drawStationParentLines(documentState: SystemDocument): void {
    for (const station of documentState.stations) {
      drawStationParentLine(documentState, station);
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
      drawPlanetShell(mapCtx, planet, screen, planetRadius, metersToPixels);
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
      const buried = stationIsBuried(documentState, station, planetRadius);
      const size = selected ? 9 : 7;
      mapCtx.fillStyle = buried ? '#ff6b5a' : selected ? '#ffc27a' : '#e09845';
      mapCtx.strokeStyle = buried
        ? '#ffd0c6'
        : selected
          ? '#ffe6c4'
          : 'rgba(255, 210, 160, 0.75)';
      mapCtx.lineWidth = selected ? 2.5 : 1.5;
      mapCtx.beginPath();
      mapCtx.moveTo(screen.x, screen.y - size);
      mapCtx.lineTo(screen.x + size, screen.y);
      mapCtx.lineTo(screen.x, screen.y + size);
      mapCtx.lineTo(screen.x - size, screen.y);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.stroke();
      mapCtx.fillStyle = buried ? '#ffd0c6' : '#ffe6c4';
      mapCtx.fillText(
        buried ? `${station.name}  ⚠ inside planet` : station.name,
        screen.x + 12,
        screen.y + 4,
      );
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
    drawScaleBar(width, height);
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
      legend.dispose();
    },
    requestRedraw: () => {
      needsRedraw = true;
    },
    fitView,
  };
}

export { stationWorldPos };
