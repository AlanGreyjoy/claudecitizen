import { dot, length } from '../../../math/vec3';
import { radialUp } from '../../../world/coordinates';
import {
  MODE_ENTERING_SHIP,
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_LEAVING_PILOT,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_RIDING_ELEVATOR,
  modeLabel,
} from '../../../player/modes';
import type { WorldState } from '../../../player/world_state';
import type { Planet, PlanetSurfaceSample, RenderStats, Vec3 } from '../../../types';

export interface StatsPanelElements {
  promptEl: HTMLElement;
  readoutsEl: HTMLElement;
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
}

export function createStatsPanel(elements: StatsPanelElements) {
  let peakAltitudeMeters = 0;

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
  }: StatsPanelUpdateParams): void {
    const subjectPosition =
      world.mode === MODE_IN_SHIP ? world.ship.position : world.character.position;
    const speed = length(focusVelocity);
    const verticalSpeed = dot(focusVelocity, radialUp(subjectPosition));
    peakAltitudeMeters = Math.max(peakAltitudeMeters, shipSurface.altitudeMeters);
    const atmospherePct = Math.max(
      0,
      100 - Math.max(0, focusSurface.altitudeMeters / planet.atmosphereHeightMeters) * 100,
    );

    const cacheReadouts: [string, string][] = renderStats
      ? [
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
        ]
      : [];

    elements.readoutsEl.innerHTML = [
      ['Mode', modeLabel(world.mode)],
      ['Altitude', `${Math.round(focusSurface.altitudeMeters).toLocaleString()} m`],
      ['Speed', `${Math.round(speed).toLocaleString()} m/s`],
      ['Vertical', `${Math.round(verticalSpeed).toLocaleString()} m/s`],
      ['Biome', focusSurface.biome],
      ['Atmosphere', `${Math.max(0, Math.round(atmospherePct))}%`],
      ['Ship Alt', `${Math.round(shipSurface.altitudeMeters).toLocaleString()} m`],
      ['Peak', `${Math.round(peakAltitudeMeters).toLocaleString()} m`],
      ...cacheReadouts,
    ]
      .map(
        ([label, value]) => `
        <div class="readout">
          <div class="readout-label">${label}</div>
          <div class="readout-value">${value}</div>
        </div>`,
      )
      .join('');

    elements.promptEl.textContent = world.prompt;

    if (rendererError) {
      elements.statusEl.textContent =
        'This browser could not start WebGL rendering. Refresh once, then try a different browser or GPU mode if it stays black.';
    } else if (world.mode === MODE_ENTERING_SHIP) {
      elements.statusEl.textContent =
        'Taking the pilot seat. Flight control hands over when the sit animation finishes.';
    } else if (world.mode === MODE_LEAVING_PILOT) {
      elements.statusEl.textContent =
        'Standing up behind the seat. Walk control returns on your feet.';
    } else if (world.mode === MODE_RIDING_ELEVATOR) {
      elements.statusEl.textContent = 'Riding the station elevator.';
    } else if (world.mode === MODE_IN_STATION) {
      if (!isPointerLocked) {
        elements.statusEl.textContent =
          'Click the view to lock the mouse, then walk the station with WASD and sprint with Shift.';
      } else if (world.assignedHangar === null) {
        elements.statusEl.textContent =
          'Your ship is in storage. Take the hab elevator down to the lobby and call it from the terminal.';
      } else {
        elements.statusEl.textContent = `Your ship is parked in Hangar ${world.assignedHangar}. Ride the hangar elevators from the lobby.`;
      }
    } else if (world.mode === MODE_ON_SHIP_DECK) {
      if (!isPointerLocked) {
        elements.statusEl.textContent =
          'Click the view to lock the mouse, then walk the ship with WASD and sprint with Shift.';
      } else if (world.prompt) {
        elements.statusEl.textContent = 'Press F to use what is in front of you.';
      } else {
        elements.statusEl.textContent =
          'Walk the cabin. The cockpit doors are forward; the boarding ramp is at the tail.';
      }
    } else if (world.mode === MODE_ON_FOOT) {
      if (!isPointerLocked) {
        elements.statusEl.textContent =
          'Click the view to lock the mouse, then move with WASD, sprint with Shift, and jump with Space.';
      } else if (world.prompt) {
        elements.statusEl.textContent =
          'Use the ramp controls at the tail, then walk up the ramp to board.';
      } else if (world.cameraView === 'first-person') {
        elements.statusEl.textContent =
          'First-person traversal is active. Look with the mouse and walk the terrain toward the ship. Press V for third person.';
      } else {
        elements.statusEl.textContent =
          'Third-person traversal is active. Orbit the camera with the mouse and walk the terrain toward the ship. Press V for first person.';
      }
    } else if (shipSurface.altitudeMeters < 20) {
      elements.statusEl.textContent =
        speed < 50
          ? 'Press F to walk the deck, or push throttle and lift to take off again.'
          : 'Surface contact at speed.';
    } else if (shipSurface.altitudeMeters > planet.atmosphereHeightMeters) {
      elements.statusEl.textContent =
        'Vacuum edge. Stars, atmosphere rim, and the global cloud shell should read as one orbit view.';
    } else if (shipSurface.altitudeMeters > 40_000) {
      elements.statusEl.textContent =
        'Upper atmosphere. Local clouds fall away while the planetary cloud shell starts to carry the view.';
    } else if (!isPointerLocked) {
      elements.statusEl.textContent =
        'Click the flight view to lock the mouse, then steer with the mouse and roll with Q/E.';
    } else if (rendererMode !== 'log-depth') {
      elements.statusEl.textContent =
        'Low atmosphere. Rendering is running in fallback mode, so visuals may be a little less stable at orbit scale.';
    } else {
      elements.statusEl.textContent =
        'Low atmosphere. Mouse steer, Q/E roll, A/D strafe, and Shift boost should feel much closer to a real 3d game.';
    }
  }

  return {
    resetPeak() {
      peakAltitudeMeters = 0;
    },
    update,
  };
}
