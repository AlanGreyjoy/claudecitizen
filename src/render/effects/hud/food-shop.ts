/**
 * Station food / drinks / canteen shop — ES-style flat panel listing
 * consumable catalog items for ARC (stackable buys).
 */

import { purchaseInventoryItem } from "../../../net/api";
import type { InventoryState, ItemDefinition } from "../../../player/inventory/types";
import {
  findItemDefinition,
  itemQuantity,
  normalizeInventoryState,
} from "../../../player/inventory/types";
import type { StationFoodShopMarker } from "../../../world/station";
import { paintItemIcon } from "./item_icon";

export interface FoodShopElements {
  rootEl: HTMLElement;
  bezelEl: HTMLElement;
  titleEl: HTMLElement;
  kickerEl: HTMLElement;
  listEl: HTMLElement;
  statusEl: HTMLElement;
  balanceEl: HTMLElement;
  closeBtnEl: HTMLButtonElement;
  powerBtnEl: HTMLButtonElement;
}

export interface FoodShopOpenOptions {
  shop: StationFoodShopMarker;
  onClose?: () => void;
}

export interface FoodShopCallbacks {
  getArcBalance: () => number | null;
  getInventory: () => InventoryState | null;
  onPurchaseResult: (result: { arcBalance: number; inventory: InventoryState }) => void;
}

function formatArc(cost: number): string {
  return `${cost.toLocaleString()} ARC`;
}

function shopTitle(shop: StationFoodShopMarker): { kicker: string; title: string } {
  if (shop.catalogMode === "food") {
    return { kicker: "Station Mess", title: "Food Shop" };
  }
  if (shop.catalogMode === "drinks") {
    return { kicker: "Hydration Kiosk", title: "Drinks Shop" };
  }
  return { kicker: "Station Canteen", title: "Canteen" };
}

function matchesCatalogMode(
  entry: ItemDefinition,
  shop: StationFoodShopMarker,
): boolean {
  if (entry.itemType !== "consumable") return false;
  if (shop.catalogMode === "food") return entry.subType === "food";
  if (shop.catalogMode === "drinks") return entry.subType === "drink";
  return entry.subType === "food" || entry.subType === "drink";
}

function filterShopConsumables(
  catalog: ItemDefinition[],
  shop: StationFoodShopMarker,
): ItemDefinition[] {
  const matching = catalog.filter((entry) => matchesCatalogMode(entry, shop));
  if (shop.itemDefinitionIds.length === 0) {
    return matching.slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  const allow = new Set(shop.itemDefinitionIds);
  return matching
    .filter((entry) => allow.has(entry.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function restoreHint(definition: ItemDefinition): string {
  const parts: string[] = [];
  const hunger = definition.hungerRestore01 ?? 0;
  const thirst = definition.thirstRestore01 ?? 0;
  if (hunger > 0) parts.push(`Hunger +${Math.round(hunger * 100)}%`);
  if (thirst > 0) parts.push(`Thirst +${Math.round(thirst * 100)}%`);
  if (parts.length > 0) return parts.join(" · ");
  return definition.description || definition.subType || "Consumable";
}

export function createFoodShop(
  elements: FoodShopElements,
  callbacks: FoodShopCallbacks,
) {
  let open = false;
  let currentShop: StationFoodShopMarker | null = null;
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

  function applyShopChrome(shop: StationFoodShopMarker): void {
    const { kicker, title } = shopTitle(shop);
    elements.kickerEl.textContent = kicker;
    elements.titleEl.textContent = title;
  }

  function renderList(): void {
    elements.listEl.replaceChildren();
    const inventory = callbacks.getInventory();
    if (!inventory || !currentShop) {
      setStatus("Sign in to browse and buy provisions.", "error");
      return;
    }

    const offerings = filterShopConsumables(inventory.catalog, currentShop);
    if (offerings.length === 0) {
      setStatus("No provisions listed in the catalog.", "info");
      return;
    }

    setStatus("Select an item to purchase.", "info");
    const balance = callbacks.getArcBalance() ?? 0;

    for (const definition of offerings) {
      const ownedQty = itemQuantity(inventory, definition.id);
      const atCap = ownedQty >= definition.stackMax;
      const canAfford = balance >= definition.costArc;
      const disabled = atCap || !canAfford || buyingId !== null;

      const row = document.createElement("div");
      row.className = "sc-food-shop-row";
      if (atCap) row.classList.add("is-owned");
      if (!canAfford && !atCap) row.classList.add("is-unaffordable");

      const icon = document.createElement("div");
      icon.className = "sc-food-shop-icon";
      paintItemIcon(icon, definition);

      const meta = document.createElement("div");
      meta.className = "sc-food-shop-meta";
      const name = document.createElement("div");
      name.className = "sc-food-shop-name";
      name.textContent = definition.name;
      const detail = document.createElement("div");
      detail.className = "sc-food-shop-detail";
      detail.textContent = atCap
        ? `Owned ×${ownedQty} — stack full`
        : ownedQty > 0
          ? `Owned ×${ownedQty} · ${restoreHint(definition)}`
          : restoreHint(definition);
      meta.append(name, detail);

      const price = document.createElement("div");
      price.className = "sc-food-shop-price";
      price.textContent = formatArc(definition.costArc);

      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "sc-food-shop-buy";
      buy.textContent = atCap ? "Full" : "Buy";
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
      setStatus("Sign in to browse and buy provisions.", "error");
      return;
    }
    const definition = findItemDefinition(inventory.catalog, itemDefinitionId);
    if (!definition) {
      setStatus("Item not found in catalog.", "error");
      return;
    }
    if (itemQuantity(inventory, itemDefinitionId) >= definition.stackMax) {
      setStatus("Stack is already full.", "error");
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
      if (currentShop) applyShopChrome(currentShop);
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
    open(options: FoodShopOpenOptions) {
      currentShop = options.shop;
      onClose = options.onClose ?? null;
      setOpen(true);
    },
  };
}

export type FoodShopController = ReturnType<typeof createFoodShop>;
