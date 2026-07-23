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
  MODE_RIDING_ELEVATOR,
  modeLabel,
} from '../../../player/modes';
import type { WorldState } from '../../../player/world_state';
import { getActiveShip, getActiveShipBody } from '../../../player/world_state';
import { flightModeLabel } from '../../../flight/flight_modes';
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

function buildCacheReadouts(renderStats: RenderStats | null): [string, string][] {
  if (!renderStats) return [];
  return [
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
  if (rendererMode !== 'log-depth') {
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
  if (world.mode === MODE_RIDING_ELEVATOR) {
    return 'Riding the station elevator.';
  }
  if (world.mode === MODE_IN_STATION) {
    if (!isPointerLocked) {
      return 'Click the view to lock the mouse, then walk the station with WASD and sprint with Shift.';
    }
    if (world.assignedHangar === null) {
      return 'Your ship is in storage. Take the hab elevator down to the lobby and call it from the AVMS terminal.';
    }
    return `Your ship is parked in Hangar ${world.assignedHangar}. Ride the hangar elevators from the lobby.`;
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

    elements.readoutsEl.innerHTML = [
      ['Mode', modeLabel(world.shipExteriorWalk ? MODE_ON_FOOT : world.mode)],
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
    elements.statusEl.textContent = resolveStatusMessage(
      world,
      shipSurface,
      planet,
      speed,
      rendererError,
      rendererMode,
      isPointerLocked,
    );
  }

  return {
    resetPeak() {
      peakAltitudeMeters = 0;
    },
    update,
  };
}
