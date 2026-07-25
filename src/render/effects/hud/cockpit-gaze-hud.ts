/**
 * Screen-space label for cockpit look-at controls (Hold F free-look).
 * Dev-quality floating prompt projected from a world marker.
 */

export interface CockpitGazeHudElements {
  rootEl: HTMLElement;
}

export interface CockpitGazeHudUpdate {
  visible: boolean;
  label?: string;
  /** Offset from screen center in CSS pixels. */
  offsetPx?: { x: number; y: number };
}

export function createCockpitGazeHud(elements: CockpitGazeHudElements) {
  let labelEl = elements.rootEl.querySelector<HTMLElement>(".sc-cockpit-gaze-label");
  if (!labelEl) {
    labelEl = document.createElement("div");
    labelEl.className = "sc-cockpit-gaze-label";
    elements.rootEl.appendChild(labelEl);
  }

  function update(next: CockpitGazeHudUpdate): void {
    const show = next.visible && Boolean(next.label) && next.offsetPx != null;
    elements.rootEl.classList.toggle("is-visible", show);
    if (!show || !next.offsetPx || !next.label) {
      labelEl!.textContent = "";
      return;
    }
    labelEl!.textContent = next.label;
    labelEl!.style.transform = `translate(calc(-50% + ${next.offsetPx.x}px), calc(-50% + ${next.offsetPx.y}px))`;
  }

  return { update };
}
