import { dot, length } from '../../../math/vec3';
import { biomeDisplayName } from '../../../world/climate';
import { radialUp } from '../../../world/coordinates';
import {
  MODE_ENTERING_SHIP,
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_LEAVING_PILOT,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  modeLabel,
} from '../../../player/modes';
import type { WorldState } from '../../../player/world-state';
import { getActiveShip, getActiveShipBody } from '../../../player/world-state';
import { flightModeLabel } from '../../../flight/flight-modes';
import type { Planet, PlanetSurfaceSample, RenderStats, Vec3 } from '../../../types';
import {
  getDedupCallsByOwner,
  getLargestTextures,
  getTextureBytesByOwner,
} from '../../assets/texture-dedup';
import { getAtmosphereWorkCounters } from '../../main/post/atmosphere-work-counters';
import { getFrameTimingSnapshot, resetWorstFrame } from '../../main/frame-timing';
import type { FpsReadout } from './fps-counter';

export interface StatsPanelElements {
  promptEl: HTMLElement;
  readoutsEl: HTMLElement;
  readoutsCopyBtn: HTMLButtonElement;
  statusEl: HTMLElement;
}

export interface StatsPanelUpdateParams {
  world: WorldState;
  focusSurface: PlanetSurfaceSample;
  focusVelocity: Vec3;
  shipSurface: PlanetSurfaceSample;
  renderStats: RenderStats | null;
  rendererError: unknown;
  rendererMode: string | undefined;
  planet: Planet;
  isPointerLocked: boolean;
  fps: FpsReadout | null;
}

function buildFrameReadouts(fps: FpsReadout | null): [string, string][] {
  if (!fps || fps.fps <= 0) return [];
  // Mean FPS hides hitches by construction; the 1% low and worst frame are the
  // numbers that move when terrain or vegetation stalls the main thread.
  return [
    ['FPS', Math.round(fps.fps).toString()],
    ['1% low', Math.round(fps.onePercentLow).toString()],
    ['Worst frame', `${fps.worstFrameMs.toFixed(1)} ms`],
  ];
}

function isShipMode(mode: string): boolean {
  return (
    mode === MODE_IN_SHIP ||
    mode === MODE_ON_SHIP_DECK ||
    mode === MODE_ENTERING_SHIP ||
    mode === MODE_LEAVING_PILOT
  );
}

function buildVitalsReadouts(world: WorldState): [string, string][] {
  if (!isShipMode(world.mode)) return [];
  const ship = getActiveShip(world);
  return [
    ['Hull', `${Math.round(ship.vitals.hp)} / ${ship.spec.maxHp}`],
    ['Shields', `${Math.round(ship.vitals.shields)} / ${ship.spec.maxShields}`],
    ['Max spd', `${Math.round(ship.spec.maxSpeedMps)} m/s`],
  ];
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

function buildMemoryReadouts(renderStats: RenderStats): [string, string][] {
  const { assets, gpu } = renderStats;
  const cacheEntries = Object.entries(assets.entries)
    .map(([name, count]) => `${name} ${count}`)
    .join(' / ');
  return [
    ['GPU', `geo ${gpu.geometries} / tex ${gpu.textures} / draws ${gpu.drawCalls}`],
    [
      'Tex Mem',
      `${formatBytes(gpu.estimatedTextureBytes)} est (>=1k atlases), ${gpu.pendingSourceReleases} pending`,
    ],
    [
      'Assets',
      `${cacheEntries || 'none'} · canon ${assets.canonicalTextures} · dedup ${assets.dedupExamined}->${assets.dedupReused} · gen ${assets.generation}`,
    ],
  ];
}

function buildCacheReadouts(renderStats: RenderStats | null): [string, string][] {
  if (!renderStats) return [];
  return [
    ...buildMemoryReadouts(renderStats),
    [
      'Terrain Cache',
      `${renderStats.terrain.activeTiles}/${renderStats.terrain.cachedTiles} q${renderStats.terrain.pendingTiles} (+${renderStats.terrain.builtThisFrame}|${renderStats.terrain.queuedThisFrame} -${renderStats.terrain.evictedThisFrame} idb${renderStats.terrain.diskHits}/${renderStats.terrain.diskMisses})`,
    ],
    [
      'Veg Cache',
      `${renderStats.vegetation.activeTiles}/${renderStats.vegetation.cachedTiles} (+${renderStats.vegetation.builtThisFrame} -${renderStats.vegetation.evictedThisFrame} idb${renderStats.vegetation.diskHits}/${renderStats.vegetation.diskMisses})`,
    ],
    [
      'Height Cache',
      `${renderStats.surfaceCache.entries.toLocaleString()} / ${renderStats.surfaceCache.limit.toLocaleString()}`,
    ],
    // Page hits are grid corners served from a terrain worker's own evaluation
    // instead of being recomputed on the main thread. A high miss rate while
    // walking means tiles are being evicted out from under the sampler.
    [
      'Height Pages',
      `${renderStats.heightPages.pages} res, ${renderStats.heightPages.hits.toLocaleString()} hit / ${renderStats.heightPages.misses.toLocaleString()} miss`,
    ],
    // The one readout that says whether a stall is scheduling or generation:
    // a low average with workers on means the queue is the problem, a high
    // average means the sampler is, and "sync" means the pool never started.
    [
      'Tile Build',
      `${renderStats.terrain.buildMsAverage.toFixed(1)}ms avg, ${renderStats.terrain.buildMsPeak.toFixed(0)}ms peak (${
        renderStats.terrain.workerBuildsEnabled ? 'workers' : 'sync'
      })`,
    ],
  ];
}

function buildFlightReadouts(world: WorldState): [string, string][] {
  if (world.mode !== MODE_IN_SHIP) return [];
  return [
    ['Flight', flightModeLabel(world.flightMode)],
    ['QT', world.quantum.phase === 'idle' ? 'Ready' : world.quantum.phase],
  ];
}

function resolveOnFootStatusMessage(
  world: WorldState,
  isPointerLocked: boolean,
): string | null {
  if (world.mode === MODE_ON_FOOT || world.shipExteriorWalk) {
    if (!isPointerLocked) {
      return 'Click the view to lock the mouse, then move with WASD, sprint with Shift, and jump with Space.';
    }
    if (world.prompt) {
      return 'Use the ramp controls at the tail, then walk up the ramp to board.';
    }
    return 'Over-the-shoulder traversal is active. Orbit with the mouse and walk the terrain toward the ship.';
  }
  return null;
}

function resolveFlightStatusMessage(
  world: WorldState,
  shipSurface: PlanetSurfaceSample,
  planet: Planet,
  speed: number,
  rendererMode: string | undefined,
  isPointerLocked: boolean,
): string | null {
  if (world.mode === MODE_IN_SHIP && world.flightMode === 'nav' && world.quantum.phase === 'idle') {
    return 'Nav mode. Tap U to cycle flight modes. Leave the atmosphere, align toward a surface POI marker, then hold U for 2 seconds to quantum travel.';
  }
  if (shipSurface.altitudeMeters < 20) {
    return speed < 50
      ? 'Hold F to look around the cockpit. Hold Y to get up and walk the deck, or push throttle and lift to take off.'
      : 'Surface contact at speed.';
  }
  if (shipSurface.altitudeMeters > planet.atmosphereHeightMeters) {
    return 'Vacuum edge. Stars, atmosphere rim, and the global cloud shell should read as one orbit view.';
  }
  if (shipSurface.altitudeMeters > 40_000) {
    return 'Upper atmosphere. Local clouds fall away while the planetary cloud shell starts to carry the view.';
  }
  if (!isPointerLocked) {
    return 'Click the flight view to lock the mouse, then steer with the mouse and roll with Q/E.';
  }
  // WebGPU carries logarithmic depth too; only the legacy WebGL fallback modes
  // lose orbit-scale depth precision.
  if (rendererMode !== 'webgpu' && rendererMode !== 'log-depth') {
    return 'Low atmosphere. Rendering is running in fallback mode, so visuals may be a little less stable at orbit scale.';
  }
  return 'Low atmosphere. Mouse steer, Q/E roll, A/D strafe, and Shift boost should feel much closer to a real 3d game.';
}

function resolveStatusMessage(
  world: WorldState,
  shipSurface: PlanetSurfaceSample,
  planet: Planet,
  speed: number,
  rendererError: unknown,
  rendererMode: string | undefined,
  isPointerLocked: boolean,
): string {
  if (rendererError) {
    return 'This browser could not start WebGL rendering. Refresh once, then try a different browser or GPU mode if it stays black.';
  }
  if (world.mode === MODE_ENTERING_SHIP) {
    return 'Taking the pilot seat. Flight control hands over when the sit animation finishes.';
  }
  if (world.mode === MODE_LEAVING_PILOT) {
    return 'Standing up behind the seat. Walk control returns on your feet.';
  }
  if (world.mode === MODE_IN_STATION) {
    if (!isPointerLocked) {
      return 'Click the view to lock the mouse, then walk the station with WASD and sprint with Shift.';
    }
    if (world.assignedHangar === null) {
      return 'Your ship is in storage. Call it from the AVMS terminal.';
    }
    return `Your ship is parked in Hangar ${world.assignedHangar}.`;
  }
  if (world.mode === MODE_ON_SHIP_DECK && !world.shipExteriorWalk) {
    if (!isPointerLocked) {
      return 'Click the view to lock the mouse, then walk the ship with WASD and sprint with Shift.';
    }
    if (world.prompt) return 'Press F to use what is in front of you.';
    return 'Walk the cabin. The cockpit doors are forward; the boarding ramp is at the tail.';
  }
  const onFootMessage = resolveOnFootStatusMessage(world, isPointerLocked);
  if (onFootMessage) return onFootMessage;
  return resolveFlightStatusMessage(
    world,
    shipSurface,
    planet,
    speed,
    rendererMode,
    isPointerLocked,
  ) ?? 'Low atmosphere. Mouse steer, Q/E roll, A/D strafe, and Shift boost should feel much closer to a real 3d game.';
}

interface ReadoutRow {
  row: HTMLElement;
  valueEl: HTMLElement;
  value: string;
}

/**
 * The editor renderer runs on a custom `cceditor://` origin, which is not a
 * secure context, so `navigator.clipboard` can be missing outright. Fall back
 * to the selection-based copy rather than silently doing nothing.
 */
async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('readonly', '');
  scratch.style.position = 'fixed';
  scratch.style.opacity = '0';
  document.body.append(scratch);
  scratch.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  scratch.remove();
  return copied;
}

/**
 * "Tex Mem: 2.5 GB" says there is a problem but not which asset caused it.
 * These two blocks name it. Both sort the registry, so they run only on the
 * copy click, never per frame.
 */
function buildTextureBlame(): string[] {
  const lines: string[] = ['', 'Top textures by resident bytes:'];
  for (const texture of getLargestTextures(10)) {
    const owners = texture.owners.join(', ') || '(no owner)';
    lines.push(
      `  ${formatBytes(texture.bytes)}  ${texture.width}x${texture.height}  ${texture.name}  <- ${owners}`,
    );
  }
  lines.push('', 'Resident texture bytes by asset:');
  for (const { bytes, owner } of getTextureBytesByOwner().slice(0, 10)) {
    lines.push(`  ${formatBytes(bytes)}  ${owner}`);
  }
  // Anything above 1 call is being re-processed after its first load.
  lines.push('', 'Dedup calls by asset (should be 1 each):');
  for (const { calls, examined, owner } of getDedupCallsByOwner().slice(0, 10)) {
    lines.push(`  ${calls} calls, ${examined} examined  ${owner}`);
  }
  return lines;
}

function buildSnapshotText(
  entries: readonly [string, string][],
  rendererMode: string | undefined,
  status: string,
): string {
  const lines = [
    'ClaudeCitizen perf snapshot',
    `Renderer: ${rendererMode ?? 'unknown'}`,
    // Resolution and DPR decide how much of a frame budget the GPU work even
    // has; a snapshot without them is not diagnosable.
    `Viewport: ${window.innerWidth}x${window.innerHeight} css @ dpr ${window.devicePixelRatio.toFixed(2)}`,
    '',
  ];
  for (const [label, value] of entries) lines.push(`${label}: ${value}`);
  const timing = getFrameTimingSnapshot();
  lines.push(
    '',
    // If `outside js` dominates, the frame is not being spent in our code and
    // profiling the call tree is the wrong move.
    `Frame ms (avg of ${timing.frames}): total ${timing.totalMs.toFixed(1)} (p95 ${timing.totalP95Ms.toFixed(1)})` +
      ` = sim ${timing.simMs.toFixed(1)} + render ${timing.renderMs.toFixed(1)}` +
      ` + outside js ${timing.outsideJsMs.toFixed(1)}`,
    `  of which graphics submit ${timing.submitMs.toFixed(1)} ms` +
      ` (scene update ${Math.max(0, timing.renderMs - timing.submitMs).toFixed(1)} ms)`,
    // Builds > 0 on the worst frame means tile construction; builds 0 with a
    // large render time means a shader variant compiled on first view.
    `Worst frame: ${timing.worstTotalMs.toFixed(1)} ms total,` +
      ` ${timing.worstRenderMs.toFixed(1)} ms render, ${timing.worstBuilds} veg builds`,
  );
  const work = getAtmosphereWorkCounters();
  lines.push(
    // Both fills are supposed to be rare. Tracking the frame count means they
    // are running inline every frame on the main thread.
    `Atmosphere work: ${work.lutFills} LUT fills / ${work.starFills} star fills / ${work.frames} frames`,
  );
  lines.push(...buildTextureBlame());
  if (status) lines.push('', `Status: ${status}`);
  return lines.join('\n');
}

export function createStatsPanel(elements: StatsPanelElements) {
  let peakAltitudeMeters = 0;
  // Rows are reused across frames and only their value text is rewritten.
  const rowsByLabel = new Map<string, ReadoutRow>();
  let lastLabelSignature = '';
  let lastEntries: [string, string][] = [];
  let lastRendererMode: string | undefined;
  let lastStatus = '';
  let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  elements.readoutsCopyBtn.addEventListener('click', () => {
    const label = 'Copy stats';
    const text = buildSnapshotText(lastEntries, lastRendererMode, lastStatus);
    // Worst-frame is a high-water mark; clearing it on copy means the next
    // snapshot reports the worst stall *since this one*, not the load spike.
    resetWorstFrame();
    void writeClipboardText(text).then((copied) => {
      elements.readoutsCopyBtn.textContent = copied ? 'Copied' : 'Copy failed';
      if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = setTimeout(() => {
        elements.readoutsCopyBtn.textContent = label;
        copyFeedbackTimer = null;
      }, 1_500);
    });
  });

  function createRow(label: string): ReadoutRow {
    const row = document.createElement('div');
    row.className = 'readout';
    const labelEl = document.createElement('div');
    labelEl.className = 'readout-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'readout-value';
    row.append(labelEl, valueEl);
    return { row, valueEl, value: '\u0000' };
  }

  /**
   * Updates the readout list in place.
   *
   * This used to assign `innerHTML` from a template every frame, which destroys
   * and reparses ~20 rows and forces a full style recalculation and layout —
   * while the panel is open, which is precisely when someone is watching the
   * frame counter. Rows are now built once and only changed text is written, so
   * a steady frame touches the DOM only where a number actually moved. Values
   * go through `textContent` rather than markup interpolation, which also means
   * a biome or prompt string can no longer inject HTML.
   */
  function renderReadouts(entries: [string, string][]): void {
    lastEntries = entries;
    let signature = '';
    for (const [label] of entries) signature += `${label}|`;
    if (signature !== lastLabelSignature) {
      lastLabelSignature = signature;
      elements.readoutsEl.replaceChildren(
        ...entries.map(([label]) => {
          let cached = rowsByLabel.get(label);
          if (!cached) {
            cached = createRow(label);
            rowsByLabel.set(label, cached);
          }
          return cached.row;
        }),
      );
    }

    for (const [label, value] of entries) {
      const cached = rowsByLabel.get(label);
      if (!cached || cached.value === value) continue;
      cached.value = value;
      cached.valueEl.textContent = value;
    }
  }

  function update({
    world,
    focusSurface,
    focusVelocity,
    shipSurface,
    renderStats,
    rendererError,
    rendererMode,
    planet,
    isPointerLocked,
    fps,
  }: StatsPanelUpdateParams): void {
    const subjectPosition =
      world.mode === MODE_IN_SHIP
        ? getActiveShipBody(world).position
        : world.character.position;
    const speed = length(focusVelocity);
    const verticalSpeed = dot(focusVelocity, radialUp(subjectPosition));
    peakAltitudeMeters = Math.max(peakAltitudeMeters, shipSurface.altitudeMeters);
    const atmospherePct = Math.max(
      0,
      100 - Math.max(0, focusSurface.altitudeMeters / planet.atmosphereHeightMeters) * 100,
    );

    renderReadouts([
      ['Mode', modeLabel(world.shipExteriorWalk ? MODE_ON_FOOT : world.mode)],
      ...buildFrameReadouts(fps),
      ...buildFlightReadouts(world),
      ['Altitude', `${Math.round(focusSurface.altitudeMeters).toLocaleString()} m`],
      ['Speed', `${Math.round(speed).toLocaleString()} m/s`],
      ['Vertical', `${Math.round(verticalSpeed).toLocaleString()} m/s`],
      ['Biome', biomeDisplayName(focusSurface.biome)],
      ...(focusSurface.waterBody ? ([['Water', focusSurface.waterBody]] as [string, string][]) : []),
      ['Atmosphere', `${Math.max(0, Math.round(atmospherePct))}%`],
      ['Ship Alt', `${Math.round(shipSurface.altitudeMeters).toLocaleString()} m`],
      ['Peak', `${Math.round(peakAltitudeMeters).toLocaleString()} m`],
      ...buildVitalsReadouts(world),
      ...buildCacheReadouts(renderStats),
    ]);

    elements.promptEl.textContent = world.prompt;
    lastRendererMode = rendererMode;
    lastStatus = resolveStatusMessage(
      world,
      shipSurface,
      planet,
      speed,
      rendererError,
      rendererMode,
      isPointerLocked,
    );
    elements.statusEl.textContent = lastStatus;
  }

  return {
    resetPeak() {
      peakAltitudeMeters = 0;
    },
    update,
  };
}
