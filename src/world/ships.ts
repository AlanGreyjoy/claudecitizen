import { setShipLayoutOverride } from "../player/ship_layout";
import { loadPrefabDocument } from "./prefabs/loader";
import { buildShipLayoutFromPrefab } from "./prefabs/ship_runtime";

/**
 * The player ship is a ship prefab: hull model, walk zones, doors, pilot
 * seat, and ramp anchors all come from its components. The hardcoded
 * Starhopper layout in player/ship_layout.ts remains the fallback when the
 * prefab is missing or unusable.
 */
export const DEFAULT_SHIP_PREFAB_ID = "phobos-starhopper";

/** Loads the default ship prefab and activates its gameplay layout. */
export async function applyDefaultShipPrefab(): Promise<void> {
  const doc = await loadPrefabDocument(DEFAULT_SHIP_PREFAB_ID);
  if (!doc) {
    console.warn(
      `Ship prefab "${DEFAULT_SHIP_PREFAB_ID}" not found; using the built-in ship layout.`,
    );
    return;
  }
  if (doc.kind !== "ship") {
    console.warn(
      `Prefab "${DEFAULT_SHIP_PREFAB_ID}" is not a ship prefab; using built-in layout.`,
    );
    return;
  }
  const layout = buildShipLayoutFromPrefab(doc);
  // The flyable ship must have a walkable deck; an in-progress prefab
  // (hull only) falls back to the built-in layout in the main game.
  if (!layout || layout.walkZones.length === 0) {
    if (layout) {
      console.warn(
        `Ship prefab "${DEFAULT_SHIP_PREFAB_ID}" has no walk zones; using the built-in layout.`,
      );
    }
    return;
  }
  setShipLayoutOverride(layout);
}
