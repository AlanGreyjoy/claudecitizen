/**
 * Active navigation route for System Map → quantum (phase 05).
 * Presentation (HaloBand) writes here; flight/nav reads it. No DOM.
 */

export type NavRouteKind = 'system-planet' | 'system-station' | 'surface-poi';

export interface NavRouteTarget {
  kind: NavRouteKind;
  /** System planet entry id, station instance id, or surface POI id. */
  id: string;
  /** Display label captured at Set Route time. */
  label: string;
}

let activeRoute: NavRouteTarget | null = null;

export function getNavRoute(): NavRouteTarget | null {
  return activeRoute;
}

export function setNavRoute(target: NavRouteTarget): NavRouteTarget {
  activeRoute = target;
  return activeRoute;
}

export function clearNavRoute(): void {
  activeRoute = null;
}
