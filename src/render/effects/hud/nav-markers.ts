import {
  formatNavMarkerDistance,
  type NavMarkerScreenPlacement,
} from './nav-marker-projection';

/**
 * Nav-mode marker overlay: one screen element per visible destination.
 *
 * Elements are pooled and reused. Nav mode runs every frame, and building or
 * discarding DOM nodes per frame is exactly the kind of main-thread churn the
 * frame budget cannot absorb — only text and transforms change per update.
 */

export type NavMarkerKind = 'surface-poi' | 'system-station' | 'system-planet';

export interface NavMarkerView {
  id: string;
  name: string;
  kind: NavMarkerKind;
  distanceMeters: number;
  /** The Set Route target. Drawn brighter, and never distance-filtered. */
  routed: boolean;
  placement: NavMarkerScreenPlacement;
}

export interface NavMarkersUpdateParams {
  /** Nav mode, in a ship, not mid-quantum. */
  visible: boolean;
  markers: readonly NavMarkerView[];
}

interface MarkerSlot {
  root: HTMLElement;
  icon: HTMLElement;
  arrow: HTMLElement;
  label: HTMLElement;
  distance: HTMLElement;
  labelText: string;
  distanceText: string;
  kind: NavMarkerKind | null;
}

function createSlot(): MarkerSlot {
  const root = document.createElement('div');
  root.className = 'sc-nav-marker';
  const arrow = document.createElement('span');
  arrow.className = 'sc-nav-marker-arrow';
  const icon = document.createElement('span');
  icon.className = 'sc-nav-marker-icon';
  const label = document.createElement('span');
  label.className = 'sc-nav-marker-label';
  const distance = document.createElement('span');
  distance.className = 'sc-nav-marker-distance';
  root.append(arrow, icon, label, distance);
  return {
    root,
    icon,
    arrow,
    label,
    distance,
    labelText: '',
    distanceText: '',
    kind: null,
  };
}

export function createNavMarkersHud(elements: { rootEl: HTMLElement }) {
  const slots: MarkerSlot[] = [];
  let visible = false;

  function slotAt(index: number): MarkerSlot {
    const existing = slots[index];
    if (existing) return existing;
    const slot = createSlot();
    elements.rootEl.appendChild(slot.root);
    slots.push(slot);
    return slot;
  }

  function applyMarker(slot: MarkerSlot, marker: NavMarkerView): void {
    const { placement } = marker;
    slot.root.style.transform = `translate(${placement.x.toFixed(1)}px, ${placement.y.toFixed(1)}px)`;
    slot.root.classList.toggle('is-off-screen', placement.offScreen);
    slot.root.classList.toggle('is-routed', marker.routed);
    if (slot.kind !== marker.kind) {
      slot.root.dataset.kind = marker.kind;
      slot.kind = marker.kind;
    }
    if (placement.offScreen) {
      // CSS rotates the arrow only; the icon and text stay upright so a marker
      // pinned to the bottom edge is still readable.
      slot.arrow.style.transform = `rotate(${placement.edgeAngleRadians.toFixed(3)}rad)`;
    }
    if (slot.labelText !== marker.name) {
      slot.label.textContent = marker.name;
      slot.labelText = marker.name;
    }
    const distanceText = formatNavMarkerDistance(marker.distanceMeters);
    if (slot.distanceText !== distanceText) {
      slot.distance.textContent = distanceText;
      slot.distanceText = distanceText;
    }
    slot.root.classList.add('is-visible');
  }

  return {
    update(params: NavMarkersUpdateParams): void {
      if (visible !== params.visible) {
        elements.rootEl.classList.toggle('is-visible', params.visible);
        visible = params.visible;
      }
      const count = params.visible ? params.markers.length : 0;
      for (let i = 0; i < count; i += 1) {
        const marker = params.markers[i];
        if (marker) applyMarker(slotAt(i), marker);
      }
      // Pooled slots past the live count stay in the DOM but hidden, so a
      // marker coming back into range does not re-allocate.
      for (let i = count; i < slots.length; i += 1) {
        slots[i]?.root.classList.remove('is-visible');
      }
    },
    dispose(): void {
      for (const slot of slots) slot.root.remove();
      slots.length = 0;
    },
  };
}

export type NavMarkersHud = ReturnType<typeof createNavMarkersHud>;
