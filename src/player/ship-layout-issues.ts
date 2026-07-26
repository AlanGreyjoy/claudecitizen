import type { ShipLayout } from "./ship-layout";

/**
 * Authoring problems a built ship layout exposes. The runtime logs the same
 * class of problem to the console as it bakes; this reports them as data so
 * the editor can show "why does Test do nothing" instead of making the author
 * read the console.
 */
export interface ShipLayoutIssue {
  /** `blocker` stops the playtest loop; `warning` degrades it. */
  severity: "blocker" | "warning";
  message: string;
}

function collectSeatIssues(layout: ShipLayout, issues: ShipLayoutIssue[]): void {
  if (layout.seats.length === 0) {
    issues.push({
      severity: "warning",
      message:
        "No ship-seat markers — flight uses the built-in Starhopper pilot anchors.",
    });
    return;
  }
  const pilots = layout.seats.filter((seat) => seat.role === "pilot");
  if (pilots.length === 0) {
    issues.push({
      severity: "blocker",
      message: 'Seats authored but none has role "pilot" — you cannot sit to fly.',
    });
  } else if (pilots.length > 1) {
    issues.push({
      severity: "warning",
      message: `${pilots.length} pilot seats — the first one wins for flight.`,
    });
  }
}

function collectArticulationIssues(
  layout: ShipLayout,
  issues: ShipLayoutIssue[],
): void {
  const boundDoorIds = new Set<string>();
  let hasRampCollider = false;
  for (const collider of layout.colliders) {
    const animation = collider.animation;
    if (!animation) continue;
    if (animation.kind === "door") boundDoorIds.add(animation.doorId);
    if (animation.kind === "ramp") hasRampCollider = true;
  }
  for (const door of layout.doors) {
    if (boundDoorIds.has(door.id)) continue;
    issues.push({
      severity: "warning",
      message: `Door "${door.label || door.id}" animates but has no collider bound — it opens visually and still blocks the player.`,
    });
  }
  if (layout.spec.rampHinge && !hasRampCollider) {
    issues.push({
      severity: "warning",
      message:
        "Ramp hinge authored with no collider bound to its node — the ramp animates but is not walkable.",
    });
  }
}

/**
 * With nothing authored, deck spawn falls back to probing ship-local (0, 0) for
 * the highest collider surface under ~2.25 m up. That only lands on the deck
 * when the hull's origin sits at deck level; on a hull whose origin is up in the
 * fuselage the highest hit is the roof, and the capsule spawns inside the
 * ceiling plating with no way to fall out.
 */
function collectDeckSpawnIssues(
  layout: ShipLayout,
  issues: ShipLayoutIssue[],
): void {
  if (layout.colliders.length === 0) return;
  const hasHint =
    layout.testSpawn !== undefined ||
    layout.deckSpawn !== undefined ||
    layout.seats.some((seat) => seat.role === "pilot") ||
    layout.cameraBounds.some((bound) => !bound.openToOutside);
  if (hasHint) return;
  issues.push({
    severity: "blocker",
    message:
      'No deck spawn hint — add an empty named "Test Spawn" standing on the deck. Without one the walker spawns at the highest hull surface, which is the roof on any hull whose origin is not at deck level.',
  });
}

/** Inspects a built layout. An empty list means the ship is ready to test. */
export function collectShipLayoutIssues(
  layout: ShipLayout | null,
): ShipLayoutIssue[] {
  if (!layout) {
    return [
      {
        severity: "blocker",
        message:
          "No ship components — add a ship-controller to the hull entity to make this a ship.",
      },
    ];
  }

  const issues: ShipLayoutIssue[] = [];
  if (!layout.hullUrl) {
    issues.push({
      severity: "blocker",
      message:
        "No hull GLB on the ship-controller entity — previews fall back to the built-in hull.",
    });
  }
  if (layout.colliders.length === 0) {
    issues.push({
      severity: "blocker",
      message:
        "No deck colliders — the interior is not walkable, so the deck loop cannot be tested.",
    });
  }
  collectDeckSpawnIssues(layout, issues);
  collectSeatIssues(layout, issues);
  collectArticulationIssues(layout, issues);
  return issues;
}
