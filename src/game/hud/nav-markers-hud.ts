import { distance } from "../../math/vec3";
import {
  listNavDestinationMarkers,
  type NavDestinationMarker,
} from "../../flight/quantum-travel";
import {
  destinationWorldPosition,
  getQuantumDestination,
} from "../../world/quantum-destinations";
import { projectNavMarkerToScreen } from "../../render/effects/hud/nav-marker-projection";
import type { NavMarkerView } from "../../render/effects/hud/nav-markers";
import type { HudUpdateParams } from "../../render/effects";
import type { Vec3 } from "../../types";
import type { LoopContext } from "../loop-context";

/**
 * Nav-mode destination markers, projected to screen pixels.
 *
 * Markers are a screen overlay rather than world-space geometry so an
 * off-screen body still shows: the marker pins to the viewport edge with an
 * arrow, and the pilot knows which way to turn. A body you cannot see is
 * exactly when the marker matters most, which is what world-space diamonds
 * could never do — they vanish with the frustum.
 */

/** Screen inset for edge-pinned markers, in CSS pixels. */
const VIEWPORT_MARGIN_PX = 44;

export interface NavMarkerViewBasis {
  /** Camera / eye position the markers are measured from. */
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  fovYRadians: number;
}

/**
 * Mid-jump the tunnel hides the world, so the whole marker set would be noise
 * over the effect — but the destination you are actually travelling to stays
 * pinned, distance counting down, the way it does in Star Citizen. Resolved
 * from the destination itself, not the blip list: you can engage quantum on a
 * nose-aligned site that was never routed, and that site must still show.
 *
 * Markers are a DOM overlay, so keeping one alive costs nothing against the
 * isolated quantum render pass.
 */
function quantumTargetMarker(ctx: LoopContext): NavDestinationMarker[] {
  const id = ctx.world.quantum.destinationId;
  if (!id) return [];
  const destination = getQuantumDestination(ctx.planet, ctx.seed, id);
  if (!destination) return [];
  return [
    {
      id: destination.id,
      name: destination.name,
      position: destinationWorldPosition(ctx.planet, ctx.seed, destination),
      kind: destination.kind,
      routed: true,
    },
  ];
}

/**
 * Which destinations blip is decided in `listNavDestinationMarkers` (local
 * bodies always, distant only when routed) — this only projects them, so the
 * HUD and quantum can never disagree about what is on the map.
 */
export function buildNavMarkersHudState(
  ctx: LoopContext,
  view: NavMarkerViewBasis,
): HudUpdateParams["navMarkers"] {
  if (ctx.world.flightMode !== "nav") {
    return { visible: false, markers: [] };
  }

  const inQuantum = ctx.world.quantum.phase !== "idle";
  const sourceMarkers = inQuantum
    ? quantumTargetMarker(ctx)
    : listNavDestinationMarkers(ctx.planet, ctx.seed);
  if (sourceMarkers.length === 0) {
    return { visible: false, markers: [] };
  }

  const viewport = {
    widthPx: window.innerWidth,
    heightPx: window.innerHeight,
    marginPx: VIEWPORT_MARGIN_PX,
  };
  const markers: NavMarkerView[] = sourceMarkers.map((marker) => ({
    id: marker.id,
    name: marker.name,
    kind: marker.kind,
    routed: marker.routed,
    distanceMeters: distance(marker.position, view.position),
    placement: projectNavMarkerToScreen(
      marker.position,
      view.position,
      {
        forward: view.forward,
        right: view.right,
        up: view.up,
        fovYRadians: view.fovYRadians,
      },
      viewport,
    ),
  }));

  return { visible: true, markers };
}
