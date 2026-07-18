import type { HangarBuildController } from '../../../player/hangar_build/build_controller';
import {
  findDefinition,
  inventoryQuantity,
  type BuildToolMode,
} from '../../../player/hangar_build/types';

export interface BuildTerminalElements {
  rootEl: HTMLElement;
  kickerEl?: HTMLElement;
  versionEl?: HTMLElement;
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
  noteEl?: HTMLElement;
}

export interface BuildTerminalOptions {
  controller: HangarBuildController;
}

export function createBuildTerminal(elements: BuildTerminalElements, options: BuildTerminalOptions) {
  let open = false;
  let controller = options.controller;

  function areaNoun(): string {
    return controller.getContext().state.area === 'apartment' ? 'apartment' : 'hangar bay';
  }

  function renderChrome(): void {
    const isApartment = controller.getContext().state.area === 'apartment';
    if (elements.kickerEl) {
      elements.kickerEl.textContent = isApartment ? 'Apartment Workshop' : 'Hangar Workshop';
    }
    if (elements.versionEl) {
      elements.versionEl.textContent = isApartment ? 'Hab layout' : 'Bay layout';
    }
    if (elements.noteEl) {
      elements.noteEl.textContent = `Place, move, rotate (R), and delete props in your private ${areaNoun()}.`;
    }
  }

  function renderPropList(): void {
    const context = controller.getContext();
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

        const metaWrap = document.createElement('div');
        metaWrap.className = 'sc-avms-ship-meta-wrap';

        const name = document.createElement('div');
        name.className = 'sc-avms-ship-name';
        name.textContent = entry.name;

        const meta = document.createElement('div');
        meta.className = 'sc-avms-ship-meta';
        meta.textContent = entry.prefabId;
        metaWrap.append(name, meta);

        const qty = document.createElement('span');
        qty.className = 'sc-build-qty';
        qty.textContent = `×${inventoryQuantity(context, entry.id)}`;

        row.append(metaWrap, qty);
        row.addEventListener('click', () => {
          controller.selectDefinition(entry.id);
          renderPropList();
          renderDetail();
        });
        elements.propListEl.append(row);
      }
    }
  }

  function renderDetail(): void {
    const context = controller.getContext();
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
    elements.statusEl.textContent = controller.getContext().statusMessage;
  }

  function setController(next: HangarBuildController): void {
    if (controller === next) return;
    if (open) controller.closeCatalog();
    controller = next;
    if (!open) return;
    controller.openCatalog();
    renderChrome();
    renderPropList();
    renderDetail();
    renderStatus();
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      controller.openCatalog();
      renderChrome();
      renderPropList();
      renderDetail();
      renderStatus();
      elements.closeBtnEl.focus();
      return;
    }
    controller.closeCatalog();
    elements.rootEl.blur();
  }

  function startTool(mode: BuildToolMode): void {
    controller.setToolMode(mode);
    setOpen(false);
  }

  elements.purchaseBtnEl.addEventListener('click', () => {
    void controller.purchaseSelected().then(() => {
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
    open(nextController?: HangarBuildController) {
      if (nextController) setController(nextController);
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    refresh() {
      if (!open) return;
      renderChrome();
      renderPropList();
      renderDetail();
      renderStatus();
    },
  };
}

export type BuildTerminalController = ReturnType<typeof createBuildTerminal>;
