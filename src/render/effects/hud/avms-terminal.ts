import type { GameBootstrap } from '../../../net/api';

export type AvmsShipRecord = GameBootstrap['ships'][number];

export interface AvmsTerminalElements {
  rootEl: HTMLElement;
  shipListEl: HTMLElement;
  detailNameEl: HTMLElement;
  detailPrefabEl: HTMLElement;
  detailHpBarEl: HTMLElement;
  detailShieldBarEl: HTMLElement;
  detailHpValueEl: HTMLElement;
  detailShieldValueEl: HTMLElement;
  statusEl: HTMLElement;
  deliverBtnEl: HTMLButtonElement;
  storeBtnEl: HTMLButtonElement;
  hangarBtnEl: HTMLButtonElement;
  closeBtnEl: HTMLButtonElement;
  powerBtnEl?: HTMLButtonElement;
}

export interface AvmsOpenOptions {
  ships: AvmsShipRecord[];
  onDeliver: (ship: AvmsShipRecord) => Promise<void>;
  canStore: boolean;
  onStore: () => Promise<void>;
  onClose?: () => void;
  /** Button label; the button stays hidden unless `onHangar` is supplied too. */
  hangarLabel?: string;
  /** Travel to the authored hangar scene. Closes the panel — the session is rebuilt. */
  onHangar?: () => void;
}

function formatPercent(current: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.round((current / max) * 100)}%`;
}

function barWidth(current: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.min(100, Math.max(0, (current / max) * 100))}%`;
}

export function createAvmsTerminal(elements: AvmsTerminalElements) {
  let open = false;
  let ships: AvmsShipRecord[] = [];
  let selectedIndex = 0;
  let delivering = false;
  let storing = false;
  let canStore = false;
  let onDeliver: AvmsOpenOptions['onDeliver'] | null = null;
  let onStore: AvmsOpenOptions['onStore'] | null = null;
  let onClose: (() => void) | null = null;
  let onHangar: (() => void) | null = null;

  function setStatus(message: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
    elements.statusEl.textContent = message;
    elements.statusEl.dataset.kind = kind;
  }

  function renderShipList(): void {
    elements.shipListEl.replaceChildren();
    if (ships.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-avms-empty';
      empty.textContent = 'No vehicles registered in your inventory.';
      elements.shipListEl.appendChild(empty);
      elements.deliverBtnEl.disabled = true;
      return;
    }

    ships.forEach((ship, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'sc-avms-ship-row';
      if (index === selectedIndex) row.classList.add('is-selected');

      const meta = document.createElement('div');
      meta.className = 'sc-avms-ship-meta-wrap';

      const name = document.createElement('div');
      name.className = 'sc-avms-ship-name';
      name.textContent = ship.displayName;

      const detail = document.createElement('div');
      detail.className = 'sc-avms-ship-meta';
      detail.textContent = ship.prefabId;

      meta.append(name, detail);

      const bars = document.createElement('span');
      bars.className = 'sc-avms-ship-bars';
      bars.innerHTML = `
        <span class="sc-avms-mini-bar sc-avms-mini-bar-hp" style="width:${barWidth(ship.hp, ship.maxHp)}"></span>
        <span class="sc-avms-mini-bar sc-avms-mini-bar-shield" style="width:${barWidth(ship.shields, ship.maxShields)}"></span>
      `;

      row.append(meta, bars);
      row.addEventListener('click', () => {
        selectedIndex = index;
        renderShipList();
        renderDetail();
      });
      elements.shipListEl.appendChild(row);
    });

    elements.deliverBtnEl.disabled = false;
  }

  function renderDetail(): void {
    const ship = ships[selectedIndex];
    if (!ship) {
      elements.detailNameEl.textContent = '—';
      elements.detailPrefabEl.textContent = '—';
      elements.detailHpBarEl.style.width = '0%';
      elements.detailShieldBarEl.style.width = '0%';
      elements.detailHpValueEl.textContent = '—';
      elements.detailShieldValueEl.textContent = '—';
      return;
    }

    elements.detailNameEl.textContent = ship.displayName;
    elements.detailPrefabEl.textContent = ship.prefabId;
    elements.detailHpBarEl.style.width = barWidth(ship.hp, ship.maxHp);
    elements.detailShieldBarEl.style.width = barWidth(ship.shields, ship.maxShields);
    elements.detailHpValueEl.textContent = `${Math.round(ship.hp)} / ${Math.round(ship.maxHp)} (${formatPercent(ship.hp, ship.maxHp)})`;
    elements.detailShieldValueEl.textContent = `${Math.round(ship.shields)} / ${Math.round(ship.maxShields)} (${formatPercent(ship.shields, ship.maxShields)})`;
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      renderShipList();
      renderDetail();
      setStatus(
        canStore
          ? 'Select a vehicle, request delivery, or store the current ship.'
          : 'Select a vehicle and request hangar delivery.',
      );
      elements.deliverBtnEl.disabled = ships.length === 0 || delivering || storing;
      elements.storeBtnEl.disabled = !canStore || delivering || storing;
      elements.hangarBtnEl.hidden = !onHangar;
      elements.hangarBtnEl.disabled = !onHangar;
      const focusEl = elements.powerBtnEl ?? elements.closeBtnEl;
      focusEl.focus({ preventScroll: true });
      return;
    }
    delivering = false;
    storing = false;
    canStore = false;
    onDeliver = null;
    onStore = null;
    onHangar = null;
    elements.hangarBtnEl.hidden = true;
    (elements.powerBtnEl ?? elements.closeBtnEl).blur();
    const closeCb = onClose;
    onClose = null;
    closeCb?.();
  }

  async function handleDeliver(): Promise<void> {
    const ship = ships[selectedIndex];
    if (!ship || delivering || storing || !onDeliver) return;
    delivering = true;
    elements.deliverBtnEl.disabled = true;
    elements.storeBtnEl.disabled = true;
    setStatus('Dispatching vehicle to hangar bay…');
    try {
      await onDeliver(ship);
      delivering = false;
      canStore = true;
      elements.deliverBtnEl.disabled = ships.length === 0;
      elements.storeBtnEl.disabled = false;
      setStatus(
        `${ship.displayName} delivered. Use To Hangar when ready, or store to recall.`,
        'ok',
      );
    } catch (error) {
      delivering = false;
      elements.deliverBtnEl.disabled = ships.length === 0;
      elements.storeBtnEl.disabled = !canStore;
      setStatus(error instanceof Error ? error.message : 'Delivery failed.', 'error');
    }
  }

  async function handleStore(): Promise<void> {
    if (storing || delivering || !onStore || !canStore) return;
    storing = true;
    elements.deliverBtnEl.disabled = true;
    elements.storeBtnEl.disabled = true;
    setStatus('Storing current vehicle…');
    try {
      await onStore();
      storing = false;
      canStore = false;
      elements.deliverBtnEl.disabled = ships.length === 0;
      elements.storeBtnEl.disabled = true;
      setStatus('Ship stored. Select a vehicle and request delivery.', 'ok');
    } catch (error) {
      storing = false;
      elements.deliverBtnEl.disabled = ships.length === 0;
      elements.storeBtnEl.disabled = !canStore;
      setStatus(error instanceof Error ? error.message : 'Store failed.', 'error');
    }
  }

  /**
   * Travel closes the panel first: the scene switch tears down this session, so
   * the request has to be read off before `setOpen(false)` clears the handlers.
   */
  function handleHangar(): void {
    if (delivering || storing || !onHangar) return;
    const travel = onHangar;
    setOpen(false);
    travel();
  }

  elements.deliverBtnEl.addEventListener('click', () => {
    void handleDeliver();
  });
  elements.hangarBtnEl.addEventListener('click', () => handleHangar());
  elements.storeBtnEl.addEventListener('click', () => {
    void handleStore();
  });
  elements.closeBtnEl.addEventListener('click', () => setOpen(false));
  elements.powerBtnEl?.addEventListener('click', () => setOpen(false));

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  };

  window.addEventListener('keydown', handleKeyDown, true);

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true);
    },
    isOpen() {
      return open;
    },
    isPaused() {
      return open;
    },
    close() {
      setOpen(false);
    },
    open(options: AvmsOpenOptions) {
      ships = options.ships;
      selectedIndex = 0;
      delivering = false;
      storing = false;
      canStore = options.canStore;
      onDeliver = options.onDeliver;
      onStore = options.onStore;
      onClose = options.onClose ?? null;
      onHangar = options.onHangar ?? null;
      elements.hangarBtnEl.textContent = options.hangarLabel?.trim() || 'To Hangar';
      setOpen(true);
    },
  };
}

export type AvmsTerminalController = ReturnType<typeof createAvmsTerminal>;
