/**
 * System Map legend overlay — symbol key, live grid scale, and the reference
 * cruise speed every distance/time readout on the map is quoted against.
 */
const REF_SPEED_STORAGE_KEY = 'asteron.systemMap.referenceSpeedMps';
const REF_SPEED_CHOICES_MPS = [50, 100, 250, 500, 1_000, 2_500] as const;
const DEFAULT_REF_SPEED_MPS = 100;

export interface SystemMapLegendCallbacks {
  onReferenceSpeedChange: (speedMps: number) => void;
}

export interface SystemMapLegendController {
  element: HTMLElement;
  getReferenceSpeedMps: () => number;
  /** Called each redraw with the current grid spacing in map meters. */
  setGridStepMeters: (meters: number, label: string) => void;
  dispose: () => void;
}

function readStoredSpeed(): number {
  try {
    const raw = window.localStorage.getItem(REF_SPEED_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    /* private mode / storage disabled — fall through to the default */
  }
  return DEFAULT_REF_SPEED_MPS;
}

function storeSpeed(speedMps: number): void {
  try {
    window.localStorage.setItem(REF_SPEED_STORAGE_KEY, String(speedMps));
  } catch {
    /* non-fatal: the selection just will not persist across sessions */
  }
}

function legendRow(swatchClass: string, text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ed-system-legend-row';
  const swatch = document.createElement('span');
  swatch.className = `ed-system-legend-swatch ${swatchClass}`;
  const label = document.createElement('span');
  label.textContent = text;
  row.replaceChildren(swatch, label);
  return row;
}

export function createSystemMapLegend(
  host: HTMLElement,
  callbacks: SystemMapLegendCallbacks,
): SystemMapLegendController {
  let referenceSpeedMps = readStoredSpeed();

  const element = document.createElement('div');
  element.className = 'ed-system-legend';

  const title = document.createElement('div');
  title.className = 'ed-system-legend-title';
  title.textContent = 'Legend';

  const gridRow = document.createElement('div');
  gridRow.className = 'ed-system-legend-grid';
  gridRow.textContent = '1 grid square = —';

  const speedRow = document.createElement('label');
  speedRow.className = 'ed-system-legend-speed';
  const speedLabel = document.createElement('span');
  speedLabel.textContent = 'Times at';
  const select = document.createElement('select');
  select.className = 'ed-system-legend-select';
  for (const choice of REF_SPEED_CHOICES_MPS) {
    const option = document.createElement('option');
    option.value = String(choice);
    option.textContent = `${choice} m/s`;
    select.append(option);
  }
  select.value = String(referenceSpeedMps);
  if (select.value !== String(referenceSpeedMps)) {
    // Stored value is not one of the presets — surface it rather than silently snapping.
    const custom = document.createElement('option');
    custom.value = String(referenceSpeedMps);
    custom.textContent = `${referenceSpeedMps} m/s`;
    select.append(custom);
    select.value = String(referenceSpeedMps);
  }
  speedRow.replaceChildren(speedLabel, select);

  const onSpeedInput = (): void => {
    const parsed = Number.parseFloat(select.value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    referenceSpeedMps = parsed;
    storeSpeed(parsed);
    callbacks.onReferenceSpeedChange(parsed);
  };
  select.addEventListener('change', onSpeedInput);

  element.replaceChildren(
    title,
    legendRow('is-star', 'Star (system origin, 0,0)'),
    legendRow('is-planet', 'Planet'),
    legendRow('is-station', 'Station'),
    legendRow('is-link', 'Link to parent body + distance'),
    gridRow,
    speedRow,
  );
  host.append(element);

  return {
    element,
    getReferenceSpeedMps: () => referenceSpeedMps,
    setGridStepMeters: (_meters, label) => {
      const next = `1 grid square = ${label}`;
      if (gridRow.textContent !== next) gridRow.textContent = next;
    },
    dispose: () => {
      select.removeEventListener('change', onSpeedInput);
      element.remove();
    },
  };
}
