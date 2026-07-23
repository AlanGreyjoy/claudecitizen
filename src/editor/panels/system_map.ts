/**
 * System Map editor tab — top-down ecliptic authoring for SystemDocument.
 *
 * Canvas coordinates: screen X = system `x`, screen Y = −system `z`
 * so +z points up on the map. Star at (0,0). Stations store parent-local
 * `offsetMeters`; the canvas shows world ecliptic = parent + offset.
 */
import { clearChildren, el } from '../dom';
import {
  fetchPlanetList,
  fetchPrefabList,
  fetchSystem,
  fetchSystemList,
  saveSystem,
  type PlanetListEntry,
  type PrefabListEntry,
  type SystemListEntry,
} from '../api';
import {
  createDefaultSystemDocument,
  DEFAULT_STATION_ALTITUDE_METERS,
  parseSystemDocument,
  SYSTEM_ID_PATTERN,
  SYSTEM_MAP_PLANET_DISTANCE_METERS,
  SYSTEM_MAP_STATION_OFFSET_METERS,
  SYSTEM_STAR_PARENT_ID,
  type SystemDocument,
  type SystemPlanetEntry,
  type SystemStationEntry,
} from '../../world/systems/schema';
import { activateSystemDocument } from '../../world/systems/runtime';

export interface SystemMapEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  loadSystem: (id: string) => Promise<boolean>;
  getDocument: () => SystemDocument | null;
  /** Form chrome — dock into Scene hierarchy panel (full height). */
  getLeftPanel: () => HTMLElement;
}

type Selection =
  | { kind: 'none' }
  | { kind: 'planet'; id: string }
  | { kind: 'station'; id: string };

interface EclipticPos {
  x: number;
  z: number;
}

function cloneDocument(doc: SystemDocument): SystemDocument {
  return structuredClone(doc);
}

function documentsEqual(a: SystemDocument | null, b: SystemDocument | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
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

function uniqueSlug(base: string, taken: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  step = 1,
): HTMLElement {
  const input = el('input', {
    className: 'ed-input',
    attrs: { type: 'number', step: String(step), value: String(value) },
    on: {
      input: () => {
        const next = Number(input.value);
        if (Number.isFinite(next)) onChange(next);
      },
      keydown: (event) => event.stopPropagation(),
    },
  }) as HTMLInputElement;
  return el('label', { className: 'ed-system-field' }, [el('span', { text: label }), input]);
}

function textField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  readonly = false,
): HTMLElement {
  const input = el('input', {
    className: 'ed-input',
    attrs: {
      type: 'text',
      value,
      ...(readonly ? { readonly: 'true' } : {}),
    },
    on: {
      input: () => onChange(input.value),
      keydown: (event) => event.stopPropagation(),
    },
  }) as HTMLInputElement;
  return el('label', { className: 'ed-system-field' }, [el('span', { text: label }), input]);
}

function selectField(
  label: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  onChange: (value: string) => void,
): HTMLElement {
  const select = el(
    'select',
    {
      className: 'ed-input',
      on: {
        change: () => onChange(select.value),
        keydown: (event) => event.stopPropagation(),
      },
    },
    options.map((option) =>
      el('option', {
        attrs: { value: option.value, ...(option.value === value ? { selected: 'true' } : {}) },
        text: option.label,
      }),
    ),
  ) as HTMLSelectElement;
  select.value = value;
  return el('label', { className: 'ed-system-field' }, [el('span', { text: label }), select]);
}

function section(title: string, children: HTMLElement[]): HTMLElement {
  return el('section', { className: 'ed-system-section' }, [
    el('h3', { className: 'ed-base-subtitle', text: title }),
    ...children,
  ]);
}

export function createSystemMapEditor(host: HTMLElement): SystemMapEditor {
  let active = false;
  let initialized = false;
  let documentState: SystemDocument = createDefaultSystemDocument();
  let savedSnapshot: SystemDocument = cloneDocument(documentState);
  let selection: Selection = { kind: 'none' };
  let planetList: PlanetListEntry[] = [];
  let stationPrefabs: PrefabListEntry[] = [];
  let systemList: SystemListEntry[] = [];
  let loadGeneration = 0;
  let raf = 0;
  let needsRedraw = true;

  // View: meters → pixels. Screen Y = −system z (+z up).
  let viewCenterX = SYSTEM_MAP_PLANET_DISTANCE_METERS * 0.5;
  let viewCenterZ = 0;
  let metersPerPixel = SYSTEM_MAP_PLANET_DISTANCE_METERS / 280;
  let panning = false;
  let panLastX = 0;
  let panLastY = 0;
  let dragging: Selection = { kind: 'none' };

  // Map fills the Scene center body; sidebar docks into hierarchy chrome.
  const sidebar = el('div', { className: 'ed-system-sidebar' });
  const formHost = el('div', { className: 'ed-system-form' });
  const mapHost = el('div', { className: 'ed-system-map-view' });
  const statusEl = el('div', { className: 'ed-system-status', text: 'System Map' });
  const actions = el('div', { className: 'ed-base-actions' });
  const hint = el('div', {
    className: 'ed-system-map-hint',
    text: 'LMB select/drag · MMB pan · wheel zoom · +z up on map',
  });

  const canvas = document.createElement('canvas');
  canvas.className = 'ed-system-canvas';
  const mapCtxOrNull = canvas.getContext('2d');
  if (!mapCtxOrNull) throw new Error('System Map requires a 2D canvas context');
  const mapCtx: CanvasRenderingContext2D = mapCtxOrNull;
  mapHost.append(canvas, hint);

  host.replaceChildren(mapHost);
  sidebar.append(
    el('h2', { className: 'ed-base-panel-title', text: 'System Map' }),
    statusEl,
    actions,
    formHost,
  );

  function hasUnsavedChanges(): boolean {
    return !documentsEqual(documentState, savedSnapshot);
  }

  function setStatus(message: string, isError = false): void {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', isError);
  }

  function markDirty(): void {
    needsRedraw = true;
    setStatus(`${documentState.name} — unsaved`);
  }

  function markDirtyAndRebuild(): void {
    markDirty();
    rebuildForm();
  }

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

  function hitTest(sx: number, sy: number): Selection {
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

  function drawStationParentLines(): void {
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

  function drawStar(): void {
    const star = worldToScreen(0, 0);
    mapCtx.fillStyle = '#ffd27a';
    mapCtx.beginPath();
    mapCtx.arc(star.x, star.y, 10, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = '#ffe9b8';
    mapCtx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    mapCtx.fillText(documentState.star.name, star.x + 14, star.y + 4);
  }

  function drawPlanets(): void {
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

  function drawStations(): void {
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
    const width = canvas.width;
    const height = canvas.height;
    mapCtx.fillStyle = '#050b14';
    mapCtx.fillRect(0, 0, width, height);
    drawMapGrid(width, height);
    drawStationParentLines();
    drawStar();
    drawPlanets();
    drawStations();
    needsRedraw = false;
  }

  function niceGridStep(raw: number): number {
    const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
    const n = raw / pow;
    if (n < 1.5) return pow;
    if (n < 3.5) return 2 * pow;
    if (n < 7.5) return 5 * pow;
    return 10 * pow;
  }

  function tick(): void {
    if (!active) return;
    if (needsRedraw) draw();
    raf = requestAnimationFrame(tick);
  }

  function setSelection(next: Selection): void {
    selection = next;
    needsRedraw = true;
    rebuildForm();
  }

  function applyDragWorld(world: EclipticPos): void {
    const drag = dragging;
    if (drag.kind === 'planet') {
      const planet = documentState.planets.find((entry) => entry.id === drag.id);
      if (!planet) return;
      planet.positionMeters = { x: world.x, z: world.z };
      markDirty();
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
      markDirty();
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
    setSelection(hit);
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
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 1) panning = false;
    if (event.button === 0 && dragging.kind !== 'none') {
      dragging = { kind: 'none' };
      rebuildForm();
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

  function listRow(
    label: string,
    selected: boolean,
    onClick: () => void,
  ): HTMLElement {
    return el('button', {
      className: `ed-system-list-row${selected ? ' is-selected' : ''}`,
      text: label,
      on: { click: onClick },
    });
  }

  function rebuildForm(): void {
    clearChildren(formHost);
    const doc = documentState;

    formHost.append(
      section('System', [
        textField('Id', doc.id, () => undefined, true),
        textField('Name', doc.name, (value) => {
          doc.name = value;
          markDirty();
        }),
        textField('Star name', doc.star.name, (value) => {
          doc.star.name = value;
          markDirty();
        }),
      ]),
    );

    const planetRows = doc.planets.map((planet) =>
      listRow(
        `${planet.name ?? planet.planetId} (${planet.id})`,
        selection.kind === 'planet' && selection.id === planet.id,
        () => setSelection({ kind: 'planet', id: planet.id }),
      ),
    );
    formHost.append(section('Planets', planetRows.length > 0 ? planetRows : [
      el('div', { className: 'ed-system-empty', text: 'No planet entries' }),
    ]));

    const stationRows = doc.stations.map((station) =>
      listRow(
        `${station.name} (${station.id})`,
        selection.kind === 'station' && selection.id === station.id,
        () => setSelection({ kind: 'station', id: station.id }),
      ),
    );
    formHost.append(section('Stations', stationRows.length > 0 ? stationRows : [
      el('div', { className: 'ed-system-empty', text: 'No station entries' }),
    ]));

    if (selection.kind === 'planet') {
      const selectedId = selection.id;
      const planet = doc.planets.find((entry) => entry.id === selectedId);
      if (planet) {
        const planetOptions = planetList.map((entry) => ({
          value: entry.id,
          label: `${entry.name} (${entry.id})`,
        }));
        if (!planetOptions.some((option) => option.value === planet.planetId)) {
          planetOptions.unshift({
            value: planet.planetId,
            label: `${planet.planetId} (missing)`,
          });
        }
        formHost.append(
          section('Selected planet', [
            textField('Entry id', planet.id, () => undefined, true),
            selectField('Planet document', planet.planetId, planetOptions, (value) => {
              planet.planetId = value;
              const meta = planetList.find((entry) => entry.id === value);
              if (meta && !planet.name) planet.name = meta.name;
              markDirtyAndRebuild();
            }),
            textField('Display name', planet.name ?? '', (value) => {
              planet.name = value.trim() || undefined;
              markDirty();
            }),
            numberField('Position X (m)', planet.positionMeters.x, (value) => {
              planet.positionMeters.x = value;
              markDirty();
            }, 1_000_000),
            numberField('Position Z (m)', planet.positionMeters.z, (value) => {
              planet.positionMeters.z = value;
              markDirty();
            }, 1_000_000),
          ]),
        );
      }
    }

    if (selection.kind === 'station') {
      const selectedId = selection.id;
      const station = doc.stations.find((entry) => entry.id === selectedId);
      if (station) {
        const prefabOptions = stationPrefabs.map((entry) => ({
          value: entry.id,
          label: `${entry.name} (${entry.id})`,
        }));
        if (!prefabOptions.some((option) => option.value === station.stationPrefabId)) {
          prefabOptions.unshift({
            value: station.stationPrefabId,
            label: `${station.stationPrefabId} (missing)`,
          });
        }
        const parentOptions = [
          { value: SYSTEM_STAR_PARENT_ID, label: 'Star' },
          ...doc.planets.map((planet) => ({
            value: planet.id,
            label: planet.name ?? planet.id,
          })),
        ];
        formHost.append(
          section('Selected station', [
            textField('Instance id', station.id, (value) => {
              const next = value.trim().toLowerCase();
              if (!SYSTEM_ID_PATTERN.test(next)) return;
              if (doc.stations.some((other) => other.id === next && other !== station)) return;
              station.id = next;
              selection = { kind: 'station', id: next };
              markDirtyAndRebuild();
            }),
            textField('Name', station.name, (value) => {
              station.name = value;
              markDirty();
            }),
            selectField('Station prefab', station.stationPrefabId, prefabOptions, (value) => {
              station.stationPrefabId = value;
              markDirty();
            }),
            selectField('Parent body', station.parentBodyId, parentOptions, (value) => {
              const world = stationWorldPos(doc, station);
              station.parentBodyId = value;
              const parentPos =
                value === SYSTEM_STAR_PARENT_ID
                  ? { x: 0, z: 0 }
                  : doc.planets.find((planet) => planet.id === value)?.positionMeters ?? {
                      x: 0,
                      z: 0,
                    };
              station.offsetMeters = {
                x: world.x - parentPos.x,
                z: world.z - parentPos.z,
              };
              markDirtyAndRebuild();
            }),
            numberField('Offset X (m)', station.offsetMeters.x, (value) => {
              station.offsetMeters.x = value;
              markDirty();
            }, 1_000_000),
            numberField('Offset Z (m)', station.offsetMeters.z, (value) => {
              station.offsetMeters.z = value;
              markDirty();
            }, 1_000_000),
            numberField(
              'Altitude (m)',
              station.altitudeMeters ?? DEFAULT_STATION_ALTITUDE_METERS,
              (value) => {
                station.altitudeMeters = value;
                markDirty();
              },
              1000,
            ),
          ]),
        );
      }
    }
  }

  async function refreshLists(): Promise<void> {
    const [planets, prefabs, systems] = await Promise.all([
      fetchPlanetList().catch(() => [] as PlanetListEntry[]),
      fetchPrefabList().catch(() => [] as PrefabListEntry[]),
      fetchSystemList().catch(() => [] as SystemListEntry[]),
    ]);
    planetList = planets;
    stationPrefabs = prefabs.filter((entry) => entry.kind === 'station');
    systemList = systems;
  }

  async function loadSystem(id: string): Promise<boolean> {
    const generation = ++loadGeneration;
    try {
      const loaded = await fetchSystem(id);
      if (generation !== loadGeneration) return false;
      documentState = loaded;
      savedSnapshot = cloneDocument(loaded);
      activateSystemDocument(loaded);
      selection = { kind: 'none' };
      rebuildForm();
      fitView();
      setStatus(`${loaded.name} (${loaded.id})`);
      return true;
    } catch (error) {
      if (generation !== loadGeneration) return false;
      setStatus(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  async function save(): Promise<boolean> {
    const parsed = parseSystemDocument(documentState);
    if (!parsed) {
      setStatus('Invalid system document — check ids, parents, and positions.', true);
      return false;
    }
    try {
      const path = await saveSystem(parsed);
      documentState = parsed;
      savedSnapshot = cloneDocument(parsed);
      activateSystemDocument(parsed);
      await refreshLists();
      setStatus(`Saved ${path}`);
      rebuildForm();
      needsRedraw = true;
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  function addPlanetEntry(): void {
    if (planetList.length === 0) {
      setStatus('No planet documents available — create one in Planet Authoring first.', true);
      return;
    }
    const taken = new Set(documentState.planets.map((planet) => planet.id));
    const unused = planetList.find((entry) => !taken.has(entry.id)) ?? planetList[0];
    if (!unused) return;
    const id = uniqueSlug(unused.id, taken);
    const angle = documentState.planets.length * 0.9;
    const distance = SYSTEM_MAP_PLANET_DISTANCE_METERS * (1 + documentState.planets.length * 0.35);
    documentState.planets.push({
      id,
      planetId: unused.id,
      name: unused.name,
      positionMeters: {
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
      },
    });
    setSelection({ kind: 'planet', id });
    markDirtyAndRebuild();
  }

  function addStationEntry(): void {
    if (stationPrefabs.length === 0) {
      setStatus('No station prefabs available.', true);
      return;
    }
    const prefab = stationPrefabs[0];
    if (!prefab) return;
    const taken = new Set(documentState.stations.map((station) => station.id));
    const id = uniqueSlug(`${prefab.id}-orbit`, taken);
    const parent = documentState.planets[0];
    const parentBodyId = parent?.id ?? SYSTEM_STAR_PARENT_ID;
    const index = documentState.stations.length;
    documentState.stations.push({
      id,
      stationPrefabId: prefab.id,
      name: prefab.name,
      parentBodyId,
      offsetMeters: {
        x: Math.cos(index) * SYSTEM_MAP_STATION_OFFSET_METERS,
        z: Math.sin(index) * SYSTEM_MAP_STATION_OFFSET_METERS,
      },
      altitudeMeters: DEFAULT_STATION_ALTITUDE_METERS,
    });
    setSelection({ kind: 'station', id });
    markDirtyAndRebuild();
  }

  function removeSelected(): void {
    if (selection.kind === 'planet') {
      const id = selection.id;
      if (documentState.stations.some((station) => station.parentBodyId === id)) {
        setStatus('Reparent or remove stations attached to this planet first.', true);
        return;
      }
      documentState.planets = documentState.planets.filter((planet) => planet.id !== id);
      setSelection({ kind: 'none' });
      markDirtyAndRebuild();
      return;
    }
    if (selection.kind === 'station') {
      const id = selection.id;
      documentState.stations = documentState.stations.filter((station) => station.id !== id);
      setSelection({ kind: 'none' });
      markDirtyAndRebuild();
    }
  }

  function openSystemPicker(): void {
    const query = window.prompt(
      `Open system id:\n${systemList.map((entry) => `${entry.id} — ${entry.name}`).join('\n') || '(none yet)'}`,
      documentState.id,
    );
    if (!query) return;
    void loadSystem(query.trim());
  }

  actions.append(
    el('button', {
      className: 'ed-btn',
      text: 'Open…',
      on: { click: () => openSystemPicker() },
    }),
    el('button', {
      className: 'ed-btn',
      text: 'Save',
      on: { click: () => void save() },
    }),
    el('button', {
      className: 'ed-btn',
      text: 'Add planet',
      on: { click: () => addPlanetEntry() },
    }),
    el('button', {
      className: 'ed-btn',
      text: 'Add station',
      on: { click: () => addStationEntry() },
    }),
    el('button', {
      className: 'ed-btn',
      text: 'Remove',
      on: { click: () => removeSelected() },
    }),
    el('button', {
      className: 'ed-btn',
      text: 'Fit',
      on: { click: () => fitView() },
    }),
    el('button', {
      className: 'ed-btn',
      text: 'New',
      on: {
        click: () => {
          if (hasUnsavedChanges() && !window.confirm('Discard unsaved system changes?')) return;
          const id = window.prompt('New system id (slug)', 'new-system')?.trim().toLowerCase();
          if (!id || !SYSTEM_ID_PATTERN.test(id)) {
            setStatus('System id must be a lowercase slug (a-z, 0-9, -).', true);
            return;
          }
          documentState = createDefaultSystemDocument(id, id);
          savedSnapshot = cloneDocument(documentState);
          selection = { kind: 'none' };
          rebuildForm();
          fitView();
          setStatus(`New ${id} — unsaved`);
        },
      },
    }),
  );

  return {
    activate: () => {
      active = true;
      if (!initialized) {
        initialized = true;
        rebuildForm();
        void (async () => {
          await refreshLists();
          const params = new URLSearchParams(window.location.search);
          const systemId = params.get('systemId') ?? 'default';
          const ok = await loadSystem(systemId);
          if (!ok) {
            documentState = createDefaultSystemDocument();
            savedSnapshot = cloneDocument(documentState);
            activateSystemDocument(documentState);
            rebuildForm();
            fitView();
            setStatus('Loaded default template (save to create)');
          }
        })();
      }
      needsRedraw = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    },
    deactivate: () => {
      active = false;
      cancelAnimationFrame(raf);
    },
    canLeave: () =>
      !hasUnsavedChanges() || window.confirm('Leave System Map with unsaved changes?'),
    isDirty: hasUnsavedChanges,
    save,
    loadSystem,
    getDocument: () => documentState,
    getLeftPanel: () => sidebar,
  };
}
