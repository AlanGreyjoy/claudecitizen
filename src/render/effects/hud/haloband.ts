import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
} from '../../../app/game_settings';
import { getKeyboardBindingCodes } from '../../../flight/input_settings';
import { length } from '../../../math/vec3';
import {
  MODE_ENTERING_SHIP,
  MODE_IN_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ON_SHIP_DECK,
} from '../../../player/modes';
import { getActiveShip, type WorldState } from '../../../player/world_state';
import type { GameMode, PlanetSurfaceSample } from '../../../types';
import { createHalobandHolo } from './haloband_holo';

export interface HaloBandElements {
  rootEl: HTMLElement;
  chatMessagesEl: HTMLElement;
  chatInputEl: HTMLInputElement;
  sendBtnEl: HTMLButtonElement;
  shipStatusEl: HTMLElement;
  balanceEl: HTMLElement;
  balanceValueEl: HTMLElement;
  holoCanvasEl: HTMLCanvasElement;
}

export interface HaloBandUpdateParams {
  world: WorldState;
  shipSurface: PlanetSurfaceSample;
}

export interface HaloBandCallbacks {
  onSendMessage: (text: string) => void;
  playerControls: { setInputSuppressed: (value: boolean) => void };
  /** Returns the player's current ARC balance, or null when offline / unavailable. */
  getArcBalance: () => number | null;
}

type HaloBandTab = 'comms' | 'missions' | 'ship';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

function barWidth(current: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.min(100, Math.max(0, (current / max) * 100))}%`;
}

function formatPercent(current: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.round((current / max) * 100)}%`;
}

function isShipMode(mode: GameMode): boolean {
  return (
    mode === MODE_IN_SHIP ||
    mode === MODE_ON_SHIP_DECK ||
    mode === MODE_ENTERING_SHIP ||
    mode === MODE_LEAVING_PILOT
  );
}

function makeBarStat(
  label: string,
  current: number,
  max: number,
  kind: 'hp' | 'shield',
): HTMLElement {
  const stat = document.createElement('div');
  stat.className = 'sc-haloband-stat';
  const labelEl = document.createElement('span');
  labelEl.className = 'sc-haloband-stat-label';
  labelEl.textContent = label;
  const bar = document.createElement('div');
  bar.className = 'sc-haloband-stat-bar';
  const fill = document.createElement('span');
  fill.className = `sc-haloband-stat-fill sc-haloband-stat-fill-${kind}`;
  fill.style.width = barWidth(current, max);
  bar.appendChild(fill);
  const value = document.createElement('span');
  value.className = 'sc-haloband-stat-value';
  value.textContent = `${Math.round(current)} / ${Math.round(max)} (${formatPercent(current, max)})`;
  stat.append(labelEl, bar, value);
  return stat;
}

function makeRowStat(label: string, valueText: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sc-haloband-stat-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'sc-haloband-stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'sc-haloband-stat-row-value';
  valueEl.textContent = valueText;
  row.append(labelEl, valueEl);
  return row;
}

export function createHaloBand(elements: HaloBandElements, callbacks: HaloBandCallbacks) {
  // TODO: implement the missions system — data model, persistent store, and
  // backend integration. The Missions tab currently renders a static placeholder.
  let open = false;
  let activeTab: HaloBandTab = 'comms';
  let latestParams: HaloBandUpdateParams | null = null;
  let haloBandCodes: readonly string[] = [];
  let lastRenderedBalance: number | null | undefined;

  const holo = createHalobandHolo(elements.holoCanvasEl);

  const navButtons = Array.from(
    elements.rootEl.querySelectorAll<HTMLButtonElement>('[data-haloband-tab]'),
  );
  const panels = Array.from(
    elements.rootEl.querySelectorAll<HTMLElement>('[data-haloband-panel]'),
  );
  const shipNavBtn = elements.rootEl.querySelector<HTMLButtonElement>(
    '[data-haloband-tab="ship"]',
  );

  function refreshBindings(): void {
    const bindings = loadGameSettings().input.mouseKeyboard.bindings;
    haloBandCodes = getKeyboardBindingCodes(bindings, 'haloBand');
  }

  function isShipTabVisible(): boolean {
    return shipNavBtn !== null && !shipNavBtn.classList.contains('is-hidden');
  }

  function renderBalance(): void {
    const balance = callbacks.getArcBalance();
    if (balance === lastRenderedBalance) return;
    lastRenderedBalance = balance;
    elements.balanceEl.classList.toggle('is-hidden', balance === null);
    if (balance === null) {
      elements.balanceValueEl.textContent = '—';
      return;
    }
    elements.balanceValueEl.textContent = `${balance.toLocaleString()} ARC`;
  }

  function renderShipStatus(): void {
    const host = elements.shipStatusEl;
    host.replaceChildren();
    if (!latestParams) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'No active ship.';
      host.appendChild(empty);
      return;
    }
    const { world, shipSurface } = latestParams;
    const ship = getActiveShip(world);
    const body = ship.body;
    const speed = length(body.velocity);
    const altitude = shipSurface.altitudeMeters;

    const vitals = document.createElement('div');
    vitals.className = 'sc-haloband-ship-section';
    const vitalsTitle = document.createElement('h4');
    vitalsTitle.className = 'sc-haloband-ship-section-title';
    vitalsTitle.textContent = 'Vitals';
    vitals.append(vitalsTitle);
    vitals.append(makeBarStat('Hull', ship.vitals.hp, ship.spec.maxHp, 'hp'));
    vitals.append(makeBarStat('Shields', ship.vitals.shields, ship.spec.maxShields, 'shield'));
    vitals.append(makeRowStat('Max Speed', `${Math.round(ship.spec.maxSpeedMps)} m/s`));
    vitals.append(makeRowStat('Speed', `${Math.round(speed)} m/s`));
    vitals.append(makeRowStat('Altitude', `${Math.round(altitude).toLocaleString()} m`));
    vitals.append(makeRowStat('Status', body.grounded ? 'Grounded' : 'Airborne'));

    const rig = ship.rig;
    const systems = document.createElement('div');
    systems.className = 'sc-haloband-ship-section';
    const systemsTitle = document.createElement('h4');
    systemsTitle.className = 'sc-haloband-ship-section-title';
    systemsTitle.textContent = 'Systems';
    systems.append(systemsTitle);
    systems.append(makeRowStat('Landing Gear', rig.gearDown ? 'Deployed' : 'Retracted'));
    systems.append(makeRowStat('Boarding Ramp', rig.rampDown ? 'Lowered' : 'Raised'));
    for (const [id, door] of Object.entries(rig.doors)) {
      systems.append(makeRowStat(`${id} Door`, door.isOpen ? 'Open' : 'Closed'));
    }

    host.append(vitals, systems);
  }

  function updateShipTabVisibility(): void {
    const mode = latestParams?.world.mode ?? null;
    const visible = mode ? isShipMode(mode) : false;
    shipNavBtn?.classList.toggle('is-hidden', !visible);
    if (!visible && activeTab === 'ship') {
      setActiveTab('comms');
    }
  }

  function setActiveTab(tab: HaloBandTab): void {
    activeTab = tab;
    for (const button of navButtons) {
      button.classList.toggle('is-active', button.dataset.halobandTab === tab);
    }
    for (const panel of panels) {
      panel.classList.toggle('is-active', panel.dataset.halobandPanel === tab);
    }
    if (tab === 'ship') renderShipStatus();
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      callbacks.playerControls.setInputSuppressed(true);
      updateShipTabVisibility();
      renderBalance();
      holo.start();
      if (activeTab === 'ship' && !isShipTabVisible()) setActiveTab('comms');
      else setActiveTab(activeTab);
      if (activeTab === 'comms') {
        elements.chatInputEl.focus({ preventScroll: true });
      } else {
        navButtons[0]?.focus({ preventScroll: true });
      }
      return;
    }
    holo.stop();
    callbacks.playerControls.setInputSuppressed(false);
    elements.chatInputEl.blur();
  }

  function appendChatMessage(author: string, text: string): void {
    const line = document.createElement('div');
    line.className = 'sc-haloband-chat-line';
    const authorEl = document.createElement('span');
    authorEl.className = 'sc-haloband-chat-author';
    authorEl.textContent = author;
    const textEl = document.createElement('span');
    textEl.className = 'sc-haloband-chat-text';
    textEl.textContent = text;
    line.append(authorEl, textEl);
    elements.chatMessagesEl.appendChild(line);
    elements.chatMessagesEl.scrollTop = elements.chatMessagesEl.scrollHeight;
  }

  function sendMessage(): void {
    const text = elements.chatInputEl.value.trim();
    if (!text) return;
    callbacks.onSendMessage(text);
    elements.chatInputEl.value = '';
  }

  function update(params: HaloBandUpdateParams): void {
    const modeChanged = latestParams?.world.mode !== params.world.mode;
    latestParams = params;
    if (!open) return;
    renderBalance();
    if (modeChanged) updateShipTabVisibility();
    if (activeTab === 'ship' && isShipTabVisible()) renderShipStatus();
  }

  for (const button of navButtons) {
    button.addEventListener('click', () => {
      const tab = button.dataset.halobandTab as HaloBandTab | undefined;
      if (tab) setActiveTab(tab);
    });
  }

  elements.sendBtnEl.addEventListener('click', () => sendMessage());
  elements.chatInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendMessage();
    }
    event.stopPropagation();
  });
  elements.chatInputEl.addEventListener('keyup', (event) => event.stopPropagation());
  elements.chatInputEl.addEventListener('keypress', (event) => event.stopPropagation());

  refreshBindings();

  const handleSettingsChanged = () => refreshBindings();
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      return;
    }
    if (!haloBandCodes.includes(event.code)) return;
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  };
  window.addEventListener('keydown', handleKeyDown, true);

  appendChatMessage('SYS', 'HaloBand commlink ready.');

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
      callbacks.playerControls.setInputSuppressed(false);
      holo.dispose();
    },
    isOpen() {
      return open;
    },
    isPaused() {
      return false;
    },
    open() {
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    toggle() {
      setOpen(!open);
    },
    appendChatMessage,
    update,
  };
}

export type HaloBandController = ReturnType<typeof createHaloBand>;
