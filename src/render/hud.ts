import { dot, length } from '../math/vec3';
import { radialUp } from '../world/coordinates';
import {
  MODE_ENTERING_SHIP,
  MODE_EXITING_SHIP,
  MODE_IN_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_RETURNING_PILOT,
  modeLabel,
} from '../player/modes';
import type { WorldState } from '../player/world_state';
import type { Planet, PlanetSurfaceSample, RenderStats, Vec3 } from '../types';

export interface HudElements {
  promptEl: HTMLElement;
  readoutsEl: HTMLElement;
  statusEl: HTMLElement;
}

export interface HudUpdateParams {
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

export function createHud(elements: HudElements) {
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
  }: HudUpdateParams): void {
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
            `${renderStats.terrain.activeTiles}/${renderStats.terrain.cachedTiles} q${renderStats.terrain.pendingTiles} (+${renderStats.terrain.builtThisFrame}|${renderStats.terrain.queuedThisFrame} -${renderStats.terrain.evictedThisFrame})`,
          ],
          [
            'Veg Cache',
            `${renderStats.vegetation.activeTiles}/${renderStats.vegetation.cachedTiles} (+${renderStats.vegetation.builtThisFrame} -${renderStats.vegetation.evictedThisFrame})`,
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
        'Boarding the ship. Flight control will hand over as soon as the sit animation finishes.';
    } else if (world.mode === MODE_LEAVING_PILOT) {
      elements.statusEl.textContent = 'Stepping away from the wheel. Deck control returns when you stand up.';
    } else if (world.mode === MODE_RETURNING_PILOT) {
      elements.statusEl.textContent = 'Returning to the wheel. Flight control resumes when you sit down.';
    } else if (world.mode === MODE_EXITING_SHIP) {
      elements.statusEl.textContent =
        'Stepping back onto the surface. Control returns when the exit animation finishes.';
    } else if (world.mode === MODE_ON_SHIP_DECK) {
      if (!isPointerLocked) {
        elements.statusEl.textContent =
          'Click the view to lock the mouse, then walk the deck with WASD and sprint with Shift.';
      } else if (world.prompt) {
        elements.statusEl.textContent = world.prompt.includes('pilot')
          ? 'You are at the wheel. Press F to take the controls.'
          : 'You are at the ramp. Press F to step down onto the surface.';
      } else {
        elements.statusEl.textContent =
          'Walk the upper deck. Return to the wheel to pilot, or use the ramp to disembark when landed.';
      }
    } else if (world.mode === MODE_ON_FOOT) {
      if (!isPointerLocked) {
        elements.statusEl.textContent =
          'Click the view to lock the mouse, then move with WASD, sprint with Shift, and jump with Space.';
      } else if (world.prompt) {
        elements.statusEl.textContent =
          'You are close enough to board. Press F to swap from surface travel into flight.';
      } else {
        elements.statusEl.textContent =
          'Third-person traversal is active. Orbit the camera with the mouse and walk the terrain toward the ship.';
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
