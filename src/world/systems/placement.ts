import { vec3 } from '../../math/vec3';
import { altitudeForPosition, latLonForPosition } from '../coordinates';
import type { Planet, Vec3 } from '../../types';
import {
  DEFAULT_STATION_ALTITUDE_METERS,
  SYSTEM_STAR_PARENT_ID,
  type SystemDocument,
  type SystemEclipticMeters,
  type SystemPlanetEntry,
  type SystemStationEntry,
} from './schema';

/**
 * Where every body in the active star system sits, in play meters.
 *
 * **Open Space is the whole star system at 1:1.** The System Map's authored
 * meters are the play meters — drag a station further out and it is that far
 * out when you fly. This module is the one place that turns map coordinates
 * into world coordinates; nothing else may invent a second scale.
 *
 * The world origin is the **active planet**, because the terrain, atmosphere
 * and gravity stacks are all built around one planet at the origin. That is a
 * rendering convention, not a second coordinate system: every other body is
 * placed at its true ecliptic offset from that origin, so distances and
 * bearings between any two bodies match the map exactly.
 *
 * Bodies far from the player still get a position here. Whether their mesh is
 * in the render set is a separate distance policy (`activationRadiusMeters`);
 * a culled body keeps its pilot blip and stays quantum-targetable.
 */

/** Ecliptic plane only — the System Map has no out-of-plane authoring. */
function eclipticVec3(meters: SystemEclipticMeters): Vec3 {
  return vec3(meters.x, 0, meters.z);
}

function subtractEcliptic(
  a: SystemEclipticMeters,
  b: SystemEclipticMeters,
): SystemEclipticMeters {
  return { x: a.x - b.x, z: a.z - b.z };
}

export type SystemBodyKind = 'star' | 'planet' | 'station';

export interface SystemBodyPlacement {
  /** Stable id: star id, `SystemPlanetEntry.id`, or `SystemStationEntry.id`. */
  id: string;
  name: string;
  kind: SystemBodyKind;
  /** World position with the active planet at the origin (ecliptic, y = 0). */
  position: Vec3;
  /** Distance from the ship at which this body's mesh should be in the render set. */
  activationRadiusMeters: number;
  /** True for the planet the terrain stack is currently built around. */
  isActivePlanet: boolean;
  /**
   * In the player's immediate neighbourhood — the active planet itself or a
   * body orbiting it. Drives whether a nav blip shows unconditionally or only
   * once the player sets a route to it.
   */
  isLocal: boolean;
  /** Planet document id, for planet bodies. */
  planetId?: string;
  /** Source entry, for station bodies. */
  station?: SystemStationEntry;
}

export const SYSTEM_STAR_BODY_ID = SYSTEM_STAR_PARENT_ID;

/**
 * Activation ranges per body type. The doc leaves exact radii open; these are
 * the starting values, chosen to match what already ships:
 *
 * - Station reuses the secondary-station loader's own prepare distance, so the
 *   blip/mesh handover happens at one distance rather than two that disagree.
 * - A planet is kilometres across, so it has to come back far earlier than a
 *   hull does or it pops in as a wall.
 * - A star is never a mesh you approach; it is lit by the sky, not placed.
 */
export const BODY_ACTIVATION_RADIUS_METERS: Record<SystemBodyKind, number> = {
  star: 0,
  planet: 2_000_000,
  station: 220_000,
};

/** The map entry for the planet the world is currently built around. */
export function findActivePlanetEntry(
  system: SystemDocument,
  activePlanetDocumentId: string,
): SystemPlanetEntry | null {
  return (
    system.planets.find((entry) => entry.planetId === activePlanetDocumentId) ?? null
  );
}

/** Ecliptic position of a station's parent, in raw map meters from the star. */
function parentEclipticMeters(
  system: SystemDocument,
  parentBodyId: string,
): SystemEclipticMeters {
  if (parentBodyId === SYSTEM_STAR_PARENT_ID) return { x: 0, z: 0 };
  const parent = system.planets.find((entry) => entry.id === parentBodyId);
  // A dangling parent is an authoring error the map validator should catch;
  // placing it at the star is better than dropping the body out of the world.
  return parent?.positionMeters ?? { x: 0, z: 0 };
}

/** Warn once per station+offset, not once per frame or per body query. */
const clampWarned = new Set<string>();

function warnStationClamped(
  stationId: string,
  authoredMeters: number,
  minOrbitMeters: number,
  parentRadiusMeters: number,
): void {
  const key = `${stationId}:${Math.round(authoredMeters)}`;
  if (clampWarned.has(key)) return;
  clampWarned.add(key);
  const km = (m: number) => `${Math.round(m / 1000).toLocaleString('en-US')} km`;
  console.warn(
    `System Map: station "${stationId}" is authored ${km(authoredMeters)} from its parent's `
    + `centre, which is inside the planet (radius ${km(parentRadiusMeters)}). `
    + `Play is pushing it out to ${km(minOrbitMeters)} — ${km(minOrbitMeters - parentRadiusMeters)} `
    + 'altitude, barely above the atmosphere, so it will look like it is sitting on the planet. '
    + `Drag it past ${km(minOrbitMeters)} on the System Map (or raise its Altitude) to place it `
    + 'in real orbit. Map meters are play meters; this clamp is a crust guard, not a layout.',
  );
}

/**
 * Push a station out to its parent's minimum orbit shell when the authored
 * offset would bury it in the crust.
 *
 * A last-resort guard, **not** part of the layout: it is the one place play
 * refuses to honour System Map meters 1:1, so it warns loudly. Silently
 * relocating a station is what makes an exit-hangar look broken — the ship
 * arrives exactly where the station is, and the station is not where the map
 * said it was.
 *
 * Only applied around the **active** planet, because that is the only body
 * whose radius the session knows. Everywhere else the authored offset is taken
 * literally — a station 300 m from a planet we cannot measure is an authoring
 * problem, not something to silently relocate.
 */
function clearParentSurface(
  offsetMeters: SystemEclipticMeters,
  altitudeMeters: number,
  parentRadiusMeters: number | null,
  stationId: string,
): SystemEclipticMeters {
  if (parentRadiusMeters === null) return offsetMeters;
  const minOrbitRadius = parentRadiusMeters + Math.max(0, altitudeMeters);
  const horiz = Math.hypot(offsetMeters.x, offsetMeters.z);
  if (horiz < 1e-6 || horiz >= minOrbitRadius) return offsetMeters;
  warnStationClamped(stationId, horiz, minOrbitRadius, parentRadiusMeters);
  const scale = minOrbitRadius / horiz;
  return { x: offsetMeters.x * scale, z: offsetMeters.z * scale };
}

/**
 * Distance from the parent's centre below which a station is inside the crust
 * and will be relocated by play. Editor surfaces use this to show the shell.
 */
export function minimumOrbitRadiusMeters(
  parentRadiusMeters: number,
  altitudeMeters: number = DEFAULT_STATION_ALTITUDE_METERS,
): number {
  return parentRadiusMeters + Math.max(0, altitudeMeters);
}

/**
 * Every body in the system, positioned relative to the active planet.
 *
 * Deliberately unfiltered: a station orbiting another planet, or parked on the
 * star, is still part of this system and must still blip and be quantum
 * targetable. Filtering by parent is what used to make those bodies vanish.
 */
export function listSystemBodyPlacements(
  system: SystemDocument,
  activePlanetDocumentId: string,
  activePlanetRadiusMeters: number,
): SystemBodyPlacement[] {
  const active = findActivePlanetEntry(system, activePlanetDocumentId);
  const origin: SystemEclipticMeters = active?.positionMeters ?? { x: 0, z: 0 };
  const bodies: SystemBodyPlacement[] = [
    {
      id: SYSTEM_STAR_BODY_ID,
      name: system.star.name,
      kind: 'star',
      position: eclipticVec3(subtractEcliptic({ x: 0, z: 0 }, origin)),
      activationRadiusMeters: BODY_ACTIVATION_RADIUS_METERS.star,
      isActivePlanet: false,
      isLocal: false,
    },
  ];

  for (const entry of system.planets) {
    const isActivePlanet = entry.planetId === activePlanetDocumentId;
    bodies.push({
      id: entry.id,
      name: entry.name ?? entry.planetId,
      kind: 'planet',
      position: eclipticVec3(subtractEcliptic(entry.positionMeters, origin)),
      activationRadiusMeters: BODY_ACTIVATION_RADIUS_METERS.planet,
      isActivePlanet,
      isLocal: isActivePlanet,
      planetId: entry.planetId,
    });
  }

  for (const station of system.stations) {
    const parentIsActive = active !== null && station.parentBodyId === active.id;
    const offset = clearParentSurface(
      station.offsetMeters,
      station.altitudeMeters ?? DEFAULT_STATION_ALTITUDE_METERS,
      parentIsActive ? activePlanetRadiusMeters : null,
      station.id,
    );
    const parent = parentEclipticMeters(system, station.parentBodyId);
    bodies.push({
      id: station.id,
      name: station.name,
      kind: 'station',
      position: eclipticVec3(
        subtractEcliptic({ x: parent.x + offset.x, z: parent.z + offset.z }, origin),
      ),
      activationRadiusMeters: BODY_ACTIVATION_RADIUS_METERS.station,
      isActivePlanet: false,
      // A station orbiting the planet underfoot is somewhere you can actually
      // fly to right now; one around a different planet is an hours-long burn.
      isLocal: parentIsActive,
      station,
    });
  }

  return bodies;
}

/**
 * World position of one station entry, active planet at the origin.
 *
 * The single answer used by orbit frames, hangar mouths, nav blips and quantum
 * approach, so all four agree on where a station is.
 */
export function stationBodyWorldPosition(
  system: SystemDocument,
  activePlanetDocumentId: string,
  activePlanetRadiusMeters: number,
  station: SystemStationEntry,
): Vec3 {
  const active = findActivePlanetEntry(system, activePlanetDocumentId);
  const parentIsActive = active !== null && station.parentBodyId === active.id;
  const offset = clearParentSurface(
    station.offsetMeters,
    station.altitudeMeters ?? DEFAULT_STATION_ALTITUDE_METERS,
    parentIsActive ? activePlanetRadiusMeters : null,
    station.id,
  );
  const parent = parentEclipticMeters(system, station.parentBodyId);
  const origin: SystemEclipticMeters = active?.positionMeters ?? { x: 0, z: 0 };
  return eclipticVec3(
    subtractEcliptic({ x: parent.x + offset.x, z: parent.z + offset.z }, origin),
  );
}

/**
 * Planet-relative spherical coordinates for a world position.
 *
 * The nav, quantum and station-frame stacks all address points as
 * lat/lon/altitude around the active planet. Rather than teach them a second
 * addressing scheme, far bodies are expressed in the one they already speak —
 * which is lossless, because both describe the same cartesian point.
 */
export function sphericalForWorldPosition(
  planet: Planet,
  position: Vec3,
): { latRadians: number; lonRadians: number; altitudeMeters: number } {
  const { latRadians, lonRadians } = latLonForPosition(position);
  return {
    latRadians,
    lonRadians,
    altitudeMeters: altitudeForPosition(position, planet.radiusMeters),
  };
}
