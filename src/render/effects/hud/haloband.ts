import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
} from '../../../settings/game-settings';
import { getKeyboardBindingCodes } from '../../../flight/input-settings';
import type { ItemType } from '../../../player/inventory/types';
import { mountHaloBandDockIcons } from './haloband-icons';
import { createSystemMapPanel, type SystemMapPanel } from './system-map-panel';
import type { HaloBandElements } from './haloband-dom';
import {
  createHaloBandPanels,
  isShipMode,
  type HaloBandNotificationLine,
} from './haloband-panels';
import type {
  HaloBandCallbacks,
  HaloBandOptions,
  HaloBandTab,
  HaloBandUpdateParams,
} from './haloband-types';

export type { HaloBandElements } from './haloband-dom';
export type {
  HaloBandCallbacks,
  HaloBandOptions,
  HaloBandTab,
  HaloBandUpdateParams,
} from './haloband-types';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

export function createHaloBand(
  elements: HaloBandElements,
  callbacks: HaloBandCallbacks,
  options: HaloBandOptions = {},
) {
  // TODO: implement the missions system — data model, persistent store, and
  // backend integration. The Missions tab currently renders a static placeholder.
  const preview = options.preview === true;
  let open = false;
  let activeTab: HaloBandTab = 'home';
  let haloBandCodes: readonly string[] = [];
  let lastRenderedBalance: number | null | undefined;
  const notifications: HaloBandNotificationLine[] = [];
  let lastHomeRenderMs = 0;
  const panelRefs = {
    latestParams: null as HaloBandUpdateParams | null,
    inventoryFilter: 'all' as 'all' | ItemType,
    selectedItemId: null as string | null,
    inventoryFiltersBuilt: false,
  };
  const {
    renderHome,
    renderHomeNotifications,
    renderShipStatus,
    renderInventory,
  } = createHaloBandPanels({
    elements,
    callbacks,
    notifications,
    refs: panelRefs,
  });

  if (preview) {
    elements.rootEl.classList.add('is-embedded');
  }

  mountHaloBandDockIcons(elements.rootEl);

  let systemMapPanel: SystemMapPanel | null = null;

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
    elements.balanceValueEl.textContent = balance.toLocaleString();
  }

  function updateShipTabVisibility(): void {
    const mode = panelRefs.latestParams?.world.mode ?? null;
    const visible = mode ? isShipMode(mode) : false;
    shipNavBtn?.classList.toggle('is-hidden', !visible);
    if (!visible && activeTab === 'ship') {
      setActiveTab('home');
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
    if (tab === 'home') renderHome();
    if (tab === 'ship') renderShipStatus();
    if (tab === 'inventory') renderInventory();
    if (tab === 'map') {
      systemMapPanel ??= createSystemMapPanel(elements.systemMapHostEl);
      systemMapPanel.refresh();
    }
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      if (!preview) {
        document.exitPointerLock?.();
        callbacks.playerControls.setInputSuppressed(true);
      }
      updateShipTabVisibility();
      renderBalance();
      if (activeTab === 'ship' && !isShipTabVisible()) setActiveTab('home');
      else setActiveTab(activeTab);
      if (!preview) {
        if (activeTab === 'comms') {
          elements.chatInputEl.focus({ preventScroll: true });
        } else {
          navButtons.find((btn) => btn.dataset.halobandTab === 'home')?.focus({
            preventScroll: true,
          });
        }
      }
      return;
    }
    if (!preview) {
      callbacks.playerControls.setInputSuppressed(false);
    }
    elements.chatInputEl.blur();
  }

  function appendChatMessage(author: string, text: string): void {
    notifications.push({ author, text });
    if (notifications.length > 40) notifications.splice(0, notifications.length - 40);

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

    if (open && activeTab === 'home') {
      renderHomeNotifications();
    }
  }

  function sendMessage(): void {
    const text = elements.chatInputEl.value.trim();
    if (!text) return;
    callbacks.onSendMessage(text);
    elements.chatInputEl.value = '';
  }

  function update(params: HaloBandUpdateParams): void {
    const modeChanged = panelRefs.latestParams?.world.mode !== params.world.mode;
    panelRefs.latestParams = params;
    if (!open) return;
    renderBalance();
    if (modeChanged) updateShipTabVisibility();
    if (activeTab === 'home') {
      const now = performance.now();
      if (modeChanged || now - lastHomeRenderMs >= 200) {
        lastHomeRenderMs = now;
        renderHome();
      }
    }
    if (activeTab === 'ship' && isShipTabVisible() && modeChanged) {
      renderShipStatus();
    } else if (activeTab === 'ship' && isShipTabVisible()) {
      const now = performance.now();
      if (now - lastHomeRenderMs >= 200) {
        lastHomeRenderMs = now;
        renderShipStatus();
      }
    }
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
  if (!preview) {
    window.addEventListener('keydown', handleKeyDown, true);
  }

  appendChatMessage('SYS', 'HaloBand online.');
  appendChatMessage('SYS', 'Commlink ready.');

  if (preview) {
    setOpen(true);
  }

  return {
    dispose() {
      if (!preview) {
        window.removeEventListener('keydown', handleKeyDown, true);
      }
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
      if (!preview) {
        callbacks.playerControls.setInputSuppressed(false);
      }
      systemMapPanel?.dispose();
      systemMapPanel = null;
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
    setActiveTab,
    appendChatMessage,
    update,
  };
}

export type HaloBandController = ReturnType<typeof createHaloBand>;
