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
  closeBtnEl: HTMLButtonElement;
}

export interface AvmsOpenOptions {
  ships: AvmsShipRecord[];
  onDeliver: (ship: AvmsShipRecord) => Promise<void>;
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
  let onDeliver: AvmsOpenOptions['onDeliver'] | null = null;

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

      const name = document.createElement('span');
      name.className = 'sc-avms-ship-name';
      name.textContent = ship.displayName;

      const meta = document.createElement('span');
      meta.className = 'sc-avms-ship-meta';
      meta.textContent = ship.prefabId;

      const bars = document.createElement('span');
      bars.className = 'sc-avms-ship-bars';
      bars.innerHTML = `
        <span class="sc-avms-mini-bar sc-avms-mini-bar-hp" style="width:${barWidth(ship.hp, ship.maxHp)}"></span>
        <span class="sc-avms-mini-bar sc-avms-mini-bar-shield" style="width:${barWidth(ship.shields, ship.maxShields)}"></span>
      `;

      row.append(name, meta, bars);
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

  function setStatus(message: string): void {
    elements.statusEl.textContent = message;
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
      setStatus('Select a vehicle and request hangar delivery.');
      elements.deliverBtnEl.disabled = ships.length === 0 || delivering;
      elements.closeBtnEl.focus();
      return;
    }
    delivering = false;
    onDeliver = null;
    elements.rootEl.blur();
  }

  async function handleDeliver(): Promise<void> {
    const ship = ships[selectedIndex];
    if (!ship || delivering || !onDeliver) return;
    delivering = true;
    elements.deliverBtnEl.disabled = true;
    setStatus('Dispatching vehicle to hangar bay…');
    try {
      await onDeliver(ship);
      setOpen(false);
    } catch (error) {
      delivering = false;
      elements.deliverBtnEl.disabled = false;
      setStatus(error instanceof Error ? error.message : 'Delivery failed.');
    }
  }

  elements.deliverBtnEl.addEventListener('click', () => {
    void handleDeliver();
  });
  elements.closeBtnEl.addEventListener('click', () => setOpen(false));

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
      onDeliver = options.onDeliver;
      setOpen(true);
    },
  };
}

export type AvmsTerminalController = ReturnType<typeof createAvmsTerminal>;
