import { distance } from "../../math/vec3";
import { listNavDestinationMarkers } from "../../flight/quantum-travel";
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
 * Which destinations blip is decided in `listNavDestinationMarkers` (local
 * bodies always, distant only when routed) — this only projects them, so the
 * HUD and quantum can never disagree about what is on the map.
 */
export function buildNavMarkersHudState(
  ctx: LoopContext,
  view: NavMarkerViewBasis,
): HudUpdateParams["navMarkers"] {
  // Markers are a nav-mode instrument, and the quantum tunnel hides the world
  // anyway — drawing them mid-jump would just be noise over the effect.
  if (ctx.world.flightMode !== "nav" || ctx.world.quantum.phase !== "idle") {
    return { visible: false, markers: [] };
  }

  const viewport = {
    widthPx: window.innerWidth,
    heightPx: window.innerHeight,
    marginPx: VIEWPORT_MARGIN_PX,
  };
  const markers: NavMarkerView[] = listNavDestinationMarkers(ctx.planet, ctx.seed).map(
    (marker) => ({
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
    }),
  );

  return { visible: true, markers };
}
