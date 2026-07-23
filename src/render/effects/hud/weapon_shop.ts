/**
 * Station weapon shop — ES-style flat panel listing catalog weapons and ammo for ARC.
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

/** Weapons remain unique gear; ammunition is a normal stackable item. */
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

function filterShopOfferings(
  catalog: ItemDefinition[],
  shop: StationWeaponShopMarker,
): ItemDefinition[] {
  const offerings = catalog.filter(
    (entry) => entry.itemType === "weapon" || entry.itemType === "ammo",
  );
  if (shop.itemDefinitionIds.length === 0) return offerings;
  const allow = new Set(shop.itemDefinitionIds);
  return offerings.filter((entry) => allow.has(entry.id));
}

function formatShopItemDetail(
  definition: ItemDefinition,
  quantity: number,
  uniqueOwned: boolean,
  stackFull: boolean,
): string {
  if (uniqueOwned) return "Owned — already in inventory";
  if (definition.itemType !== "ammo") {
    return definition.description || definition.subType || "Weapon";
  }
  if (stackFull) {
    return `Owned ${quantity} / ${definition.stackMax} — stack full`;
  }
  return `Owned ${quantity} / ${definition.stackMax} · ${definition.description || definition.subType}`;
}

function createShopRow(
  definition: ItemDefinition,
  quantity: number,
  balance: number,
  buyingId: string | null,
  onBuy: (itemId: string) => void,
): HTMLElement {
  const uniqueOwned = definition.itemType === "weapon" && quantity >= 1;
  const stackFull = definition.itemType === "ammo" && quantity >= definition.stackMax;
  const canAfford = balance >= definition.costArc;
  const disabled = uniqueOwned || stackFull || !canAfford || buyingId !== null;

  const row = document.createElement("div");
  row.className = "sc-weapon-shop-row";
  if (uniqueOwned || stackFull) row.classList.add("is-owned");
  if (!canAfford && !uniqueOwned && !stackFull) row.classList.add("is-unaffordable");

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
  detail.textContent = formatShopItemDetail(definition, quantity, uniqueOwned, stackFull);
  meta.append(name, detail);

  const price = document.createElement("div");
  price.className = "sc-weapon-shop-price";
  price.textContent = formatArc(definition.costArc);

  const buy = document.createElement("button");
  buy.type = "button";
  buy.className = "sc-weapon-shop-buy";
  buy.textContent = uniqueOwned ? "Owned" : stackFull ? "Full" : "Buy";
  buy.disabled = disabled;
  buy.dataset.itemId = definition.id;
  buy.addEventListener("click", () => {
    void onBuy(definition.id);
  });

  row.append(icon, meta, price, buy);
  return row;
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
      setStatus("Sign in to browse weapons and ammunition.", "error");
      return;
    }

    const offerings = filterShopOfferings(inventory.catalog, currentShop);
    if (offerings.length === 0) {
      setStatus("No weapons or ammunition listed in the catalog.", "info");
      return;
    }

    setStatus("Select a weapon or ammunition round to purchase.", "info");
    const balance = callbacks.getArcBalance() ?? 0;

    for (const definition of offerings) {
      const quantity = itemQuantity(inventory, definition.id);
      elements.listEl.append(
        createShopRow(definition, quantity, balance, buyingId, buyItem),
      );
    }
  }

  async function buyItem(itemDefinitionId: string): Promise<void> {
    if (buyingId || !currentShop) return;
    const inventory = callbacks.getInventory();
    if (!inventory) {
      setStatus("Sign in to browse weapons and ammunition.", "error");
      return;
    }
    const definition = findItemDefinition(inventory.catalog, itemDefinitionId);
    if (!definition) {
      setStatus("Item not found in catalog.", "error");
      return;
    }
    if (definition.itemType === "weapon" && ownsWeapon(inventory, itemDefinitionId)) {
      setStatus("You already own this weapon.", "error");
      renderList();
      return;
    }
    if (
      definition.itemType === "ammo" &&
      itemQuantity(inventory, itemDefinitionId) >= definition.stackMax
    ) {
      setStatus("That ammunition stack is already full.", "error");
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
