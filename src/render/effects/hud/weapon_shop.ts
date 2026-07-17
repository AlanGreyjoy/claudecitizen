/**
 * Station weapon shop — ES-style flat panel listing catalog weapons for ARC.
 */

import { purchaseInventoryItem } from "../../../net/api";
import type { InventoryState, ItemDefinition } from "../../../player/inventory/types";
import {
  findItemDefinition,
  itemQuantity,
  normalizeInventoryState,
} from "../../../player/inventory/types";
import type { StationWeaponShopMarker } from "../../../world/station";
import { paintItemIcon } from "./item_icon";

/** Weapon shop sells unique gear — one owned copy per catalog definition. */
function ownsWeapon(inventory: InventoryState, itemDefinitionId: string): boolean {
  return itemQuantity(inventory, itemDefinitionId) >= 1;
}

export interface WeaponShopElements {
  rootEl: HTMLElement;
  bezelEl: HTMLElement;
  listEl: HTMLElement;
  statusEl: HTMLElement;
  balanceEl: HTMLElement;
  closeBtnEl: HTMLButtonElement;
  powerBtnEl: HTMLButtonElement;
}

export interface WeaponShopOpenOptions {
  shop: StationWeaponShopMarker;
  onClose?: () => void;
}

export interface WeaponShopCallbacks {
  getArcBalance: () => number | null;
  getInventory: () => InventoryState | null;
  onPurchaseResult: (result: { arcBalance: number; inventory: InventoryState }) => void;
}

function formatArc(cost: number): string {
  return `${cost.toLocaleString()} ARC`;
}

function filterShopWeapons(
  catalog: ItemDefinition[],
  shop: StationWeaponShopMarker,
): ItemDefinition[] {
  const weapons = catalog.filter((entry) => entry.itemType === "weapon");
  if (shop.itemDefinitionIds.length === 0) return weapons;
  const allow = new Set(shop.itemDefinitionIds);
  return weapons.filter((entry) => allow.has(entry.id));
}

export function createWeaponShop(
  elements: WeaponShopElements,
  callbacks: WeaponShopCallbacks,
) {
  let open = false;
  let currentShop: StationWeaponShopMarker | null = null;
  let onClose: (() => void) | null = null;
  let buyingId: string | null = null;

  function setStatus(message: string, kind: "info" | "error" | "ok" = "info"): void {
    elements.statusEl.textContent = message;
    elements.statusEl.dataset.kind = kind;
  }

  function refreshBalance(): void {
    const balance = callbacks.getArcBalance();
    elements.balanceEl.textContent =
      balance === null ? "ARC —" : `${balance.toLocaleString()} ARC`;
  }

  function renderList(): void {
    elements.listEl.replaceChildren();
    const inventory = callbacks.getInventory();
    if (!inventory || !currentShop) {
      setStatus("Sign in to browse and buy weapons.", "error");
      return;
    }

    const offerings = filterShopWeapons(inventory.catalog, currentShop);
    if (offerings.length === 0) {
      setStatus("No weapons listed in the catalog.", "info");
      return;
    }

    setStatus("Select a weapon to purchase.", "info");
    const balance = callbacks.getArcBalance() ?? 0;

    for (const definition of offerings) {
      const owned = ownsWeapon(inventory, definition.id);
      const canAfford = balance >= definition.costArc;
      const disabled = owned || !canAfford || buyingId !== null;

      const row = document.createElement("div");
      row.className = "sc-weapon-shop-row";
      if (owned) row.classList.add("is-owned");
      if (!canAfford && !owned) row.classList.add("is-unaffordable");

      const icon = document.createElement("div");
      icon.className = "sc-weapon-shop-icon";
      paintItemIcon(icon, definition);

      const meta = document.createElement("div");
      meta.className = "sc-weapon-shop-meta";
      const name = document.createElement("div");
      name.className = "sc-weapon-shop-name";
      name.textContent = definition.name;
      const detail = document.createElement("div");
      detail.className = "sc-weapon-shop-detail";
      detail.textContent = owned
        ? "Owned — already in inventory"
        : definition.description || definition.subType || "Weapon";
      meta.append(name, detail);

      const price = document.createElement("div");
      price.className = "sc-weapon-shop-price";
      price.textContent = formatArc(definition.costArc);

      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "sc-weapon-shop-buy";
      buy.textContent = owned ? "Owned" : "Buy";
      buy.disabled = disabled;
      buy.dataset.itemId = definition.id;
      buy.addEventListener("click", () => {
        void buyItem(definition.id);
      });

      row.append(icon, meta, price, buy);
      elements.listEl.append(row);
    }
  }

  async function buyItem(itemDefinitionId: string): Promise<void> {
    if (buyingId || !currentShop) return;
    const inventory = callbacks.getInventory();
    if (!inventory) {
      setStatus("Sign in to browse and buy weapons.", "error");
      return;
    }
    const definition = findItemDefinition(inventory.catalog, itemDefinitionId);
    if (!definition) {
      setStatus("Item not found in catalog.", "error");
      return;
    }
    if (ownsWeapon(inventory, itemDefinitionId)) {
      setStatus("You already own this weapon.", "error");
      renderList();
      return;
    }

    buyingId = itemDefinitionId;
    renderList();
    setStatus(`Purchasing ${definition.name}…`, "info");

    try {
      const result = await purchaseInventoryItem(itemDefinitionId);
      callbacks.onPurchaseResult({
        arcBalance: result.arcBalance,
        inventory: normalizeInventoryState(result.inventory),
      });
      refreshBalance();
      setStatus(`Purchased ${definition.name}.`, "ok");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Purchase failed.";
      setStatus(message, "error");
    } finally {
      buyingId = null;
      renderList();
    }
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle("is-open", open);
    elements.rootEl.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      document.exitPointerLock?.();
      refreshBalance();
      renderList();
      elements.powerBtnEl.focus({ preventScroll: true });
      return;
    }
    buyingId = null;
    currentShop = null;
    elements.listEl.replaceChildren();
    elements.powerBtnEl.blur();
    const closeCb = onClose;
    onClose = null;
    closeCb?.();
  }

  elements.closeBtnEl.addEventListener("click", () => setOpen(false));
  elements.powerBtnEl.addEventListener("click", () => setOpen(false));

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  window.addEventListener("keydown", handleKeyDown, true);

  return {
    dispose() {
      window.removeEventListener("keydown", handleKeyDown, true);
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
    open(options: WeaponShopOpenOptions) {
      currentShop = options.shop;
      onClose = options.onClose ?? null;
      setOpen(true);
    },
  };
}

export type WeaponShopController = ReturnType<typeof createWeaponShop>;
