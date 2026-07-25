/**
 * World-projected cockpit speed instrument (number + bar).
 * Bar ceiling is boost max; SCM max is marked as a tick. Boost accents the fill.
 */

export interface CockpitSpeedHudElements {
  rootEl: HTMLElement;
}

export interface CockpitSpeedInstrumentUpdate {
  id: string;
  /** Offset from screen center in CSS pixels. */
  offsetPx: { x: number; y: number };
  /** Current speed (m/s). */
  speedMps: number;
  /** SCM / cruise speed cap (m/s). */
  scmMaxMps: number;
  /** Absolute boost ceiling used for the bar (m/s). */
  boostMaxMps: number;
  /** Whether boost accent should show (smoothed). */
  boosting: boolean;
  /** Smoothed boost intensity 0..1 for fade styling. */
  boost01?: number;
  /** Optional authored title; default "SPEED". */
  label?: string;
}

export interface CockpitSpeedHudUpdate {
  visible: boolean;
  instruments?: readonly CockpitSpeedInstrumentUpdate[];
}

export function createCockpitSpeedHud(elements: CockpitSpeedHudElements) {
  const widgets = new Map<
    string,
    {
      root: HTMLElement;
      valueEl: HTMLElement;
      fillEl: HTMLElement;
      scmEl: HTMLElement;
      titleEl: HTMLElement;
    }
  >();

  function ensureWidget(id: string) {
    let widget = widgets.get(id);
    if (widget) return widget;

    const root = document.createElement("div");
    root.className = "sc-cockpit-speed";
    root.dataset.speedId = id;

    const titleEl = document.createElement("div");
    titleEl.className = "sc-cockpit-speed-title";
    titleEl.textContent = "SPEED";

    const valueEl = document.createElement("div");
    valueEl.className = "sc-cockpit-speed-value";

    const track = document.createElement("div");
    track.className = "sc-cockpit-speed-track";

    const fillEl = document.createElement("div");
    fillEl.className = "sc-cockpit-speed-fill";

    const scmEl = document.createElement("div");
    scmEl.className = "sc-cockpit-speed-scm";

    track.append(fillEl, scmEl);
    root.append(titleEl, valueEl, track);
    elements.rootEl.appendChild(root);

    widget = { root, valueEl, fillEl, scmEl, titleEl };
    widgets.set(id, widget);
    return widget;
  }

  function update(next: CockpitSpeedHudUpdate): void {
    const list = next.visible ? (next.instruments ?? []) : [];
    const seen = new Set<string>();
    elements.rootEl.classList.toggle("is-visible", list.length > 0);

    for (const instrument of list) {
      seen.add(instrument.id);
      const widget = ensureWidget(instrument.id);
      const boostMax = Math.max(1e-3, instrument.boostMaxMps);
      const scmMax = Math.max(0, instrument.scmMaxMps);
      const speed = Math.max(0, instrument.speedMps);
      const fill01 = Math.max(0, Math.min(1, speed / boostMax));
      const scm01 = Math.max(0, Math.min(1, scmMax / boostMax));

      widget.titleEl.textContent = instrument.label?.trim() || "SPEED";
      widget.valueEl.textContent = `${Math.round(speed)} m/s`;
      widget.fillEl.style.transform = `scaleX(${fill01})`;
      widget.scmEl.style.left = `${scm01 * 100}%`;
      const boost01 = Math.max(
        0,
        Math.min(1, instrument.boost01 ?? (instrument.boosting ? 1 : 0)),
      );
      widget.root.style.setProperty("--boost-01", String(boost01));
      widget.root.classList.toggle("is-boosting", boost01 > 0.05);
      widget.root.style.transform = `translate(calc(-50% + ${instrument.offsetPx.x}px), calc(-50% + ${instrument.offsetPx.y}px))`;
      widget.root.classList.add("is-visible");
    }

    for (const [id, widget] of widgets) {
      if (seen.has(id)) continue;
      widget.root.classList.remove("is-visible");
    }
  }

  return { update };
}
