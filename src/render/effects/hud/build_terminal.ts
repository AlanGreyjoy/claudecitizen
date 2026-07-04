import type { HangarBuildController } from '../../../player/hangar_build/build_controller';
import {
  findDefinition,
  inventoryQuantity,
  type BuildToolMode,
} from '../../../player/hangar_build/types';

export interface BuildTerminalElements {
  rootEl: HTMLElement;
  propListEl: HTMLElement;
  detailNameEl: HTMLElement;
  detailMetaEl: HTMLElement;
  detailDescEl: HTMLElement;
  detailQtyEl: HTMLElement;
  detailCostEl: HTMLElement;
  statusEl: HTMLElement;
  purchaseBtnEl: HTMLButtonElement;
  placeBtnEl: HTMLButtonElement;
  moveBtnEl: HTMLButtonElement;
  deleteBtnEl: HTMLButtonElement;
  closeBtnEl: HTMLButtonElement;
}

export interface BuildTerminalOptions {
  controller: HangarBuildController;
}

export function createBuildTerminal(elements: BuildTerminalElements, options: BuildTerminalOptions) {
  let open = false;

  function renderPropList(): void {
    const context = options.controller.getContext();
    elements.propListEl.replaceChildren();

    const grouped = new Map<string, typeof context.state.catalog>();
    for (const entry of context.state.catalog) {
      const bucket = grouped.get(entry.category) ?? [];
      bucket.push(entry);
      grouped.set(entry.category, bucket);
    }

    if (context.state.catalog.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-avms-empty';
      empty.textContent = 'No props in the catalog.';
      elements.propListEl.append(empty);
      return;
    }

    for (const [category, entries] of grouped.entries()) {
      const heading = document.createElement('p');
      heading.className = 'sc-build-category';
      heading.textContent = category;
      elements.propListEl.append(heading);

      for (const entry of entries) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'sc-avms-ship-row';
        if (entry.id === context.selectedDefinitionId) row.classList.add('is-selected');

        const name = document.createElement('span');
        name.className = 'sc-avms-ship-name';
        name.textContent = entry.name;

        const meta = document.createElement('span');
        meta.className = 'sc-avms-ship-meta';
        meta.textContent = entry.prefabId;

        const qty = document.createElement('span');
        qty.className = 'sc-build-qty';
        qty.textContent = `×${inventoryQuantity(context, entry.id)}`;

        row.append(name, meta, qty);
        row.addEventListener('click', () => {
          options.controller.selectDefinition(entry.id);
          renderPropList();
          renderDetail();
        });
        elements.propListEl.append(row);
      }
    }
  }

  function renderDetail(): void {
    const context = options.controller.getContext();
    const definition = context.selectedDefinitionId
      ? findDefinition(context, context.selectedDefinitionId)
      : null;
    if (!definition) {
      elements.detailNameEl.textContent = '—';
      elements.detailMetaEl.textContent = '—';
      elements.detailDescEl.textContent = '—';
      elements.detailQtyEl.textContent = '—';
      elements.detailCostEl.textContent = '—';
      elements.purchaseBtnEl.disabled = true;
      return;
    }

    elements.detailNameEl.textContent = definition.name;
    elements.detailMetaEl.textContent = definition.prefabId;
    elements.detailDescEl.textContent = definition.description;
    elements.detailQtyEl.textContent = String(inventoryQuantity(context, definition.id));
    elements.detailCostEl.textContent = `${definition.costArc.toLocaleString()} ARC`;
    elements.purchaseBtnEl.disabled = context.busy;
  }

  function renderStatus(): void {
    elements.statusEl.textContent = options.controller.getContext().statusMessage;
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      options.controller.openCatalog();
      renderPropList();
      renderDetail();
      renderStatus();
      elements.closeBtnEl.focus();
      return;
    }
    options.controller.closeCatalog();
    elements.rootEl.blur();
  }

  function startTool(mode: BuildToolMode): void {
    options.controller.setToolMode(mode);
    setOpen(false);
  }

  elements.purchaseBtnEl.addEventListener('click', () => {
    void options.controller.purchaseSelected().then(() => {
      renderPropList();
      renderDetail();
      renderStatus();
    });
  });
  elements.placeBtnEl.addEventListener('click', () => startTool('place'));
  elements.moveBtnEl.addEventListener('click', () => startTool('move'));
  elements.deleteBtnEl.addEventListener('click', () => startTool('delete'));
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
    open() {
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    refresh() {
      if (!open) return;
      renderPropList();
      renderDetail();
      renderStatus();
    },
  };
}

export type BuildTerminalController = ReturnType<typeof createBuildTerminal>;
