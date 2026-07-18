/**
 * HaloBand System Map panel — top-down ecliptic view for Set Route.
 * Screen X = system x, screen Y = −system z (+z up). Updates on open /
 * selection only — not every game frame.
 */
import {
  getActiveSystemDocument,
  findPlanetEntryByPlanetId,
} from '../../../world/systems/runtime';
import {
  SYSTEM_MAP_PLANET_DISTANCE_METERS,
  SYSTEM_STAR_PARENT_ID,
  type SystemDocument,
  type SystemPlanetEntry,
  type SystemStationEntry,
} from '../../../world/systems/schema';
import { getActivePlanetConfig } from '../../../world/planets/runtime';
import {
  clearNavRoute,
  getNavRoute,
  setNavRoute,
  type NavRouteTarget,
} from '../../../flight/nav_route';

type MapSelection =
  | { kind: 'none' }
  | { kind: 'planet'; id: string }
  | { kind: 'station'; id: string };

interface MapBodyPos {
  x: number;
  z: number;
}

function planetPos(planet: SystemPlanetEntry): MapBodyPos {
  return { ...planet.positionMeters };
}

function stationPos(doc: SystemDocument, station: SystemStationEntry): MapBodyPos {
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

export interface SystemMapPanel {
  refresh: () => void;
  dispose: () => void;
}

export function createSystemMapPanel(host: HTMLElement): SystemMapPanel {
  let selection: MapSelection = { kind: 'none' };
  let viewCenterX = SYSTEM_MAP_PLANET_DISTANCE_METERS * 0.5;
  let viewCenterZ = 0;
  let metersPerPixel = SYSTEM_MAP_PLANET_DISTANCE_METERS / 200;
  let panning = false;
  let panLastX = 0;
  let panLastY = 0;

  host.replaceChildren();
  host.classList.add('sc-haloband-system-map');

  const layout = document.createElement('div');
  layout.className = 'sc-haloband-system-map-layout';

  const canvasHost = document.createElement('div');
  canvasHost.className = 'sc-haloband-system-map-canvas-host';
  const canvas = document.createElement('canvas');
  canvas.className = 'sc-haloband-system-map-canvas';
  const mapCtxOrNull = canvas.getContext('2d');
  if (!mapCtxOrNull) throw new Error('System Map panel requires a 2D canvas');
  const mapCtx: CanvasRenderingContext2D = mapCtxOrNull;
  canvasHost.append(canvas);

  const side = document.createElement('div');
  side.className = 'sc-haloband-system-map-side';
  const detailTitle = document.createElement('h4');
  detailTitle.className = 'sc-haloband-system-map-detail-title';
  detailTitle.textContent = 'Selection';
  const detailBody = document.createElement('p');
  detailBody.className = 'sc-haloband-system-map-detail';
  detailBody.textContent = 'Select a planet or station.';
  const routeStatus = document.createElement('p');
  routeStatus.className = 'sc-haloband-system-map-route';
  const actions = document.createElement('div');
  actions.className = 'sc-haloband-system-map-actions';
  const setRouteBtn = document.createElement('button');
  setRouteBtn.type = 'button';
  setRouteBtn.className = 'sc-haloband-system-map-btn';
  setRouteBtn.textContent = 'Set Route';
  const clearRouteBtn = document.createElement('button');
  clearRouteBtn.type = 'button';
  clearRouteBtn.className = 'sc-haloband-system-map-btn sc-haloband-system-map-btn-ghost';
  clearRouteBtn.textContent = 'Clear Route';
  actions.append(setRouteBtn, clearRouteBtn);
  side.append(detailTitle, detailBody, routeStatus, actions);

  layout.append(canvasHost, side);
  host.append(layout);

  function activePlanetEntryId(doc: SystemDocument): string | null {
    const planetId = getActivePlanetConfig().planetId;
    return findPlanetEntryByPlanetId(doc, planetId)?.id ?? null;
  }

  function worldToScreen(wx: number, wz: number): { x: number; y: number } {
    const ppm = 1 / metersPerPixel;
    return {
      x: (wx - viewCenterX) * ppm + canvas.width / 2,
      y: -(wz - viewCenterZ) * ppm + canvas.height / 2,
    };
  }

  function screenToWorld(sx: number, sy: number): MapBodyPos {
    const ppm = 1 / metersPerPixel;
    return {
      x: (sx - canvas.width / 2) / ppm + viewCenterX,
      z: -((sy - canvas.height / 2) / ppm) + viewCenterZ,
    };
  }

  function fitView(doc: SystemDocument): void {
    const points: MapBodyPos[] = [{ x: 0, z: 0 }];
    for (const planet of doc.planets) points.push(planetPos(planet));
    for (const station of doc.stations) points.push(stationPos(doc, station));
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
    metersPerPixel = (span * 1.4) / size;
  }

  function resize(): void {
    const width = Math.max(1, Math.floor(canvasHost.clientWidth));
    const height = Math.max(1, Math.floor(canvasHost.clientHeight));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function hitTest(doc: SystemDocument, sx: number, sy: number): MapSelection {
    const radius = 22;
    for (const station of doc.stations) {
      const pos = stationPos(doc, station);
      const screen = worldToScreen(pos.x, pos.z);
      if (Math.hypot(screen.x - sx, screen.y - sy) <= radius) {
        return { kind: 'station', id: station.id };
      }
    }
    for (const planet of doc.planets) {
      const pos = planetPos(planet);
      const screen = worldToScreen(pos.x, pos.z);
      if (Math.hypot(screen.x - sx, screen.y - sy) <= radius) {
        return { kind: 'planet', id: planet.id };
      }
    }
    return { kind: 'none' };
  }

  function selectionTarget(doc: SystemDocument): NavRouteTarget | null {
    if (selection.kind === 'planet') {
      const selectedId = selection.id;
      const planet = doc.planets.find((entry) => entry.id === selectedId);
      if (!planet) return null;
      return {
        kind: 'system-planet',
        id: planet.id,
        label: planet.name ?? planet.planetId,
      };
    }
    if (selection.kind === 'station') {
      const selectedId = selection.id;
      const station = doc.stations.find((entry) => entry.id === selectedId);
      if (!station) return null;
      return {
        kind: 'system-station',
        id: station.id,
        label: station.name,
      };
    }
    return null;
  }

  function renderDetail(doc: SystemDocument): void {
    const activeParent = activePlanetEntryId(doc);
    const route = getNavRoute();
    if (route) {
      routeStatus.textContent = `Route: ${route.label} (${route.kind})`;
    } else {
      routeStatus.textContent = 'No active route.';
    }

    if (selection.kind === 'planet') {
      const selectedId = selection.id;
      const planet = doc.planets.find((entry) => entry.id === selectedId);
      if (!planet) {
        detailBody.textContent = 'Select a planet or station.';
        setRouteBtn.disabled = true;
        return;
      }
      const local = planet.id === activeParent;
      detailBody.textContent = local
        ? `Planet · ${planet.name ?? planet.planetId} · active local body`
        : `Planet · ${planet.name ?? planet.planetId} · quantum handoff required`;
      setRouteBtn.disabled = false;
      return;
    }
    if (selection.kind === 'station') {
      const selectedId = selection.id;
      const station = doc.stations.find((entry) => entry.id === selectedId);
      if (!station) {
        detailBody.textContent = 'Select a planet or station.';
        setRouteBtn.disabled = true;
        return;
      }
      const local =
        station.parentBodyId === SYSTEM_STAR_PARENT_ID ||
        station.parentBodyId === activeParent;
      detailBody.textContent = local
        ? `Station · ${station.name} · local orbit`
        : `Station · ${station.name} · parent inactive (quantum handoff)`;
      setRouteBtn.disabled = false;
      return;
    }
    detailBody.textContent = 'Select a planet or station.';
    setRouteBtn.disabled = true;
  }

  function draw(doc: SystemDocument): void {
    resize();
    const width = canvas.width;
    const height = canvas.height;
    mapCtx.fillStyle = 'rgba(4, 10, 18, 0.92)';
    mapCtx.fillRect(0, 0, width, height);

    const activeParent = activePlanetEntryId(doc);

    for (const station of doc.stations) {
      const parentPos =
        station.parentBodyId === SYSTEM_STAR_PARENT_ID
          ? { x: 0, z: 0 }
          : doc.planets.find((planet) => planet.id === station.parentBodyId)?.positionMeters ?? {
              x: 0,
              z: 0,
            };
      const world = stationPos(doc, station);
      const from = worldToScreen(parentPos.x, parentPos.z);
      const to = worldToScreen(world.x, world.z);
      mapCtx.strokeStyle = 'rgba(255, 180, 90, 0.3)';
      mapCtx.setLineDash([3, 3]);
      mapCtx.beginPath();
      mapCtx.moveTo(from.x, from.y);
      mapCtx.lineTo(to.x, to.y);
      mapCtx.stroke();
      mapCtx.setLineDash([]);
    }

    {
      const star = worldToScreen(0, 0);
      mapCtx.fillStyle = '#ffd27a';
      mapCtx.beginPath();
      mapCtx.arc(star.x, star.y, 8, 0, Math.PI * 2);
      mapCtx.fill();
      mapCtx.fillStyle = '#ffe9b8';
      mapCtx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
      mapCtx.fillText(doc.star.name, star.x + 12, star.y + 4);
    }

    for (const planet of doc.planets) {
      const pos = planetPos(planet);
      const screen = worldToScreen(pos.x, pos.z);
      const selected = selection.kind === 'planet' && selection.id === planet.id;
      const local = planet.id === activeParent;
      const radius = selected ? 18 : 14;
      mapCtx.fillStyle = selected ? '#7ad0ff' : local ? '#3f9ae8' : '#5a6f86';
      mapCtx.beginPath();
      mapCtx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      mapCtx.fill();
      if (selected || local) {
        mapCtx.strokeStyle = selected ? 'rgba(200, 240, 255, 0.9)' : 'rgba(120, 190, 255, 0.55)';
        mapCtx.lineWidth = selected ? 2.5 : 1.5;
        mapCtx.stroke();
      }
      mapCtx.fillStyle = '#cfe9ff';
      mapCtx.fillText(planet.name ?? planet.planetId, screen.x + radius + 6, screen.y + 4);
    }

    for (const station of doc.stations) {
      const pos = stationPos(doc, station);
      const screen = worldToScreen(pos.x, pos.z);
      const selected = selection.kind === 'station' && selection.id === station.id;
      const size = selected ? 8 : 6;
      mapCtx.fillStyle = selected ? '#ffc27a' : '#e09845';
      mapCtx.beginPath();
      mapCtx.moveTo(screen.x, screen.y - size);
      mapCtx.lineTo(screen.x + size, screen.y);
      mapCtx.lineTo(screen.x, screen.y + size);
      mapCtx.lineTo(screen.x - size, screen.y);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.fillStyle = '#ffe6c4';
      mapCtx.fillText(station.name, screen.x + 10, screen.y + 4);
    }
  }

  function refresh(): void {
    const doc = getActiveSystemDocument();
    fitView(doc);
    draw(doc);
    renderDetail(doc);
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
    const doc = getActiveSystemDocument();
    selection = hitTest(doc, sx, sy);
    draw(doc);
    renderDetail(doc);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!panning) return;
    const dx = event.clientX - panLastX;
    const dy = event.clientY - panLastY;
    panLastX = event.clientX;
    panLastY = event.clientY;
    viewCenterX -= dx * metersPerPixel;
    viewCenterZ += dy * metersPerPixel;
    draw(getActiveSystemDocument());
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 1) panning = false;
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
      draw(getActiveSystemDocument());
    },
    { passive: false },
  );

  setRouteBtn.addEventListener('click', () => {
    const doc = getActiveSystemDocument();
    const target = selectionTarget(doc);
    if (!target) return;
    setNavRoute(target);
    renderDetail(doc);
  });
  clearRouteBtn.addEventListener('click', () => {
    clearNavRoute();
    renderDetail(getActiveSystemDocument());
  });

  return {
    refresh,
    dispose: () => {
      host.replaceChildren();
      host.classList.remove('sc-haloband-system-map');
    },
  };
}
