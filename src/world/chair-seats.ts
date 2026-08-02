/**
 * Furniture chairs shared by station-local and ship-local surfaces.
 *
 * Both surfaces express positions as right/up/forward meters in their own
 * frame (same as ladders). Marker +Z is the facing the seated character looks
 * along. Nothing here touches physics or rendering.
 */

export interface ChairPoint {
  right: number;
  up: number;
  forward: number;
}

export interface ChairDir2 {
  right: number;
  forward: number;
}

/** Baked chair from a chair-seat marker. */
export interface ChairSeatSpec {
  id: string;
  /** Prompt noun, e.g. "chair" / "bench". */
  label: string;
  /** Seated character root in surface-local meters. */
  seat: ChairPoint;
  /** First-person eye in surface-local meters. */
  eye: ChairPoint;
  /** Stand-up spot beside the chair (2D surface-local). */
  stand: ChairDir2;
  /** Unit facing the seated character looks along (marker +Z). */
  face: ChairDir2;
  trigger: 'radial' | 'raycast';
  radius: number;
  aimRadius: number;
}

/** Live occupancy, stored on world state while sitting / transitioning. */
export interface ChairOccupancyState {
  surface: 'station' | 'ship';
  chairId: string;
}

export const CHAIR_DEFAULT_RADIUS = 1.45;
export const CHAIR_DEFAULT_AIM_RADIUS = 0.35;
export const CHAIR_DEFAULT_LABEL = 'chair';

export function findChairById(
  chairs: readonly ChairSeatSpec[],
  id: string,
): ChairSeatSpec | null {
  return chairs.find((chair) => chair.id === id) ?? null;
}

export interface ChairLocal2 {
  right: number;
  forward: number;
}

/**
 * Nearest radial chair within reach on the horizontal plane at matching
 * height. Raycast chairs are resolved by the caller with camera aim.
 */
export function nearestRadialChair(
  chairs: readonly ChairSeatSpec[],
  local: ChairPoint,
): ChairSeatSpec | null {
  let best: { chair: ChairSeatSpec; distance: number } | null = null;
  for (const chair of chairs) {
    if (chair.trigger === 'raycast') continue;
    const distance = Math.hypot(
      local.right - chair.seat.right,
      local.up - chair.seat.up,
      local.forward - chair.seat.forward,
    );
    if (distance > chair.radius) continue;
    if (best && distance >= best.distance) continue;
    best = { chair, distance };
  }
  return best?.chair ?? null;
}

export function chairInteractPrompt(
  chair: ChairSeatSpec,
  interactLabel = 'F',
): string {
  const label = chair.label.trim() || CHAIR_DEFAULT_LABEL;
  if (label.toLowerCase() !== 'chair') {
    return `Press ${interactLabel} — sit (${label})`;
  }
  return `Press ${interactLabel} — sit`;
}
