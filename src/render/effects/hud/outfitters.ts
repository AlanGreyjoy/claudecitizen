/**
 * Station outfitters — ES-style flat panel with gear category tabs.
 * Back stocks backpacks; other categories are empty until catalog grows.
 */

import { purchaseInventoryItem } from "../../../net/api";
import type { InventoryState, ItemDefinition } from "../../../player/inventory/types";
import {
  findItemDefinition,
  itemQuantity,
  normalizeInventoryState,
} from "../../../player/inventory/types";
import type { StationOutfittersMarker } from "../../../world/station";
import { paintItemIcon } from "./item_icon";

export type OutfittersCategory =
  | "head"
  | "shoulders"
  | "arms"
  | "chest"
  | "waist"
  | "legs"
  | "feet"
  | "back";

export const OUTFITTERS_CATEGORIES: readonly {
  id: OutfittersCategory;
  label: string;
}[] = [
  { id: "head", label: "Head" },
  { id: "shoulders", label: "Shoulders" },
  { id: "arms", label: "Arms" },
  { id: "chest", label: "Chest" },
  { id: "waist", label: "Waist" },
  { id: "legs", label: "Legs" },
  { id: "feet", label: "Feet" },
  { id: "back", label: "Back" },
] as const;

/** Outfitters sells unique gear — one owned copy per catalog definition. */
function ownsItem(inventory: InventoryState, itemDefinitionId: string): boolean {
  return itemQuantity(inventory, itemDefinitionId) >= 1;
}

function filterCategoryOfferings(
  catalog: ItemDefinition[],
  shop: StationOutfittersMarker,
  category: OutfittersCategory,
): ItemDefinition[] {
  // Only Back is stocked for now (backpacks). Other body categories stay empty
  // until armor/clothing slots and catalog entries exist.
  if (category !== "back") return [];

  let offerings = catalog.filter((entry) => entry.itemType === "backpack");
  if (shop.itemDefinitionIds.length > 0) {
    const allow = new Set(shop.itemDefinitionIds);
    offerings = offerings.filter((entry) => allow.has(entry.id));
  }
  return offerings;
}

export interface OutfittersElements {
  rootEl: HTMLElement;
  bezelEl: HTMLElement;
  tabsEl: HTMLElement;
  listEl: HTMLElement;
  statusEl: HTMLElement;
  balanceEl: HTMLElement;
  closeBtnEl: HTMLButtonElement;
  powerBtnEl: HTMLButtonElement;
}

export interface OutfittersOpenOptions {
  shop: StationOutfittersMarker;
  onClose?: () => void;
}

export interface OutfittersCallbacks {
  getArcBalance: () => number | null;
  getInventory: () => InventoryState | null;
  onPurchaseResult: (result: { arcBalance: number; inventory: InventoryState }) => void;
}

function formatArc(cost: number): string {
  return `${cost.toLocaleString()} ARC`;
}

export function createOutfitters(
  elements: OutfittersElements,
  callbacks: OutfittersCallbacks,
) {
  let open = false;
  let currentShop: StationOutfittersMarker | null = null;
  let onClose: (() => void) | null = null;
  let buyingId: string | null = null;
  let activeCategory: OutfittersCategory = "back";

  function setStatus(message: string, kind: "info" | "error" | "ok" = "info"): void {
    elements.statusEl.textContent = message;
    elements.statusEl.dataset.kind = kind;
  }

  function refreshBalance(): void {
    const balance = callbacks.getArcBalance();
    elements.balanceEl.textContent =
      balance === null ? "ARC —" : `${balance.toLocaleString()} ARC`;
  }

  function renderTabs(): void {
    elements.tabsEl.replaceChildren();
    for (const category of OUTFITTERS_CATEGORIES) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "sc-outfitters-tab";
      if (category.id === activeCategory) tab.classList.add("is-active");
      tab.textContent = category.label;
      tab.dataset.category = category.id;
      tab.addEventListener("click", () => {
        if (activeCategory === category.id) return;
        activeCategory = category.id;
        renderTabs();
        renderList();
      });
      elements.tabsEl.append(tab);
    }
  }

  function itemDetailText(definition: ItemDefinition, owned: boolean): string {
    if (owned) return "Owned — already in inventory";
    const capacity =
      typeof definition.capacityLiters === "number"
        ? `${definition.capacityLiters} L`
        : null;
    const blurb = definition.description || definition.subType || "Gear";
    return capacity ? `${capacity} · ${blurb}` : blurb;
  }

  function appendOfferingRow(
    definition: ItemDefinition,
    inventory: InventoryState,
    balance: number,
  ): void {
    const owned = ownsItem(inventory, definition.id);
    const canAfford = balance >= definition.costArc;

    const row = document.createElement("div");
    row.className = "sc-outfitters-row";
    if (owned) row.classList.add("is-owned");
    if (!canAfford && !owned) row.classList.add("is-unaffordable");

    const icon = document.createElement("div");
    icon.className = "sc-outfitters-icon";
    paintItemIcon(icon, definition);

    const meta = document.createElement("div");
    meta.className = "sc-outfitters-meta";
    const name = document.createElement("div");
    name.className = "sc-outfitters-name";
    name.textContent = definition.name;
    const detail = document.createElement("div");
    detail.className = "sc-outfitters-detail";
    detail.textContent = itemDetailText(definition, owned);
    meta.append(name, detail);

    const price = document.createElement("div");
    price.className = "sc-outfitters-price";
    price.textContent = formatArc(definition.costArc);

    const buy = document.createElement("button");
    buy.type = "button";
    buy.className = "sc-outfitters-buy";
    buy.textContent = owned ? "Owned" : "Buy";
    buy.disabled = owned || !canAfford || buyingId !== null;
    buy.dataset.itemId = definition.id;
    buy.addEventListener("click", () => {
      void buyItem(definition.id);
    });

    row.append(icon, meta, price, buy);
    elements.listEl.append(row);
  }

  function renderList(): void {
    elements.listEl.replaceChildren();
    const inventory = callbacks.getInventory();
    if (!inventory || !currentShop) {
      setStatus("Sign in to browse and buy gear.", "error");
      return;
    }

    const offerings = filterCategoryOfferings(
      inventory.catalog,
      currentShop,
      activeCategory,
    );
    if (offerings.length === 0) {
      setStatus("No stock in this category.", "info");
      return;
    }

    setStatus("Select an item to purchase.", "info");
    const balance = callbacks.getArcBalance() ?? 0;
    for (const definition of offerings) {
      appendOfferingRow(definition, inventory, balance);
    }
  }

  async function buyItem(itemDefinitionId: string): Promise<void> {
    if (buyingId || !currentShop) return;
    const inventory = callbacks.getInventory();
    if (!inventory) {
      setStatus("Sign in to browse and buy gear.", "error");
      return;
    }
    const definition = findItemDefinition(inventory.catalog, itemDefinitionId);
    if (!definition) {
      setStatus("Item not found in catalog.", "error");
      return;
    }
    if (ownsItem(inventory, itemDefinitionId)) {
      setStatus("You already own this item.", "error");
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
      activeCategory = "back";
      refreshBalance();
      renderTabs();
      renderList();
      elements.powerBtnEl.focus({ preventScroll: true });
      return;
    }
    buyingId = null;
    currentShop = null;
    elements.listEl.replaceChildren();
    elements.tabsEl.replaceChildren();
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
    open(options: OutfittersOpenOptions) {
      currentShop = options.shop;
      onClose = options.onClose ?? null;
      setOpen(true);
    },
  };
}

export type OutfittersController = ReturnType<typeof createOutfitters>;
