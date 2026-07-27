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
      // Exterior entry has no deck to stand on, so the built-in Starhopper
      // anchors would drop the pilot outside the hull with no way back in.
      severity: layout.entry === "exterior" ? "blocker" : "warning",
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
  // Only an interior walker can be blocked by an unbound door collider.
  for (const door of layout.entry === "exterior" ? [] : layout.doors) {
    if (boundDoorIds.has(door.id)) continue;
    issues.push({
      severity: "warning",
      message: `Door "${door.label || door.id}" animates but has no collider bound — it opens visually and still blocks the player.`,
    });
  }
  // Exterior entry never walks the ramp, so an unbound hinge is cosmetic.
  if (layout.entry !== "exterior" && layout.spec.rampHinge && !hasRampCollider) {
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

/**
 * Exterior-entry ships trade deck colliders for a ground-level board circle,
 * so the deck checks do not apply. What matters instead is that the circle
 * lands where the player actually stands.
 */
function collectExteriorEntryIssues(
  layout: ShipLayout,
  issues: ShipLayoutIssue[],
): void {
  const pilotSeatIds = new Set(
    layout.seats.filter((seat) => seat.role === "pilot").map((seat) => seat.id),
  );
  for (const entry of layout.entryPoints) {
    if (!entry.seatId || pilotSeatIds.has(entry.seatId)) continue;
    issues.push({
      severity: "warning",
      message: `Ship Entry "${entry.label}" targets a non-pilot seat — only pilot seats can be boarded, so this prompt does nothing.`,
    });
  }
  if (layout.restHeightMeters === null) {
    issues.push({
      severity: "warning",
      message:
        "No rest height on the ship-controller — the board circle is matched against the parked ground band, so the F prompt may not appear where you stand.",
    });
  }
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
  if (layout.entry === "exterior") {
    collectExteriorEntryIssues(layout, issues);
  } else {
    if (layout.colliders.length === 0) {
      issues.push({
        severity: "blocker",
        message:
          "No deck colliders — the interior is not walkable, so the deck loop cannot be tested. Set Entry Mode to Exterior if this hull is boarded from the ground.",
      });
    }
    collectDeckSpawnIssues(layout, issues);
  }
  collectSeatIssues(layout, issues);
  collectArticulationIssues(layout, issues);
  return issues;
}
