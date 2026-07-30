/** Tiny DOM builder used by the editor panels. */

import { createUiIcon, UiIcons, type CreateUiIconOptions, type UiIconNode } from '../ui/icons';

type ElementProps = {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<string, (event: Event) => void>>;
};

type DomChild = HTMLElement | SVGElement | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: DomChild[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  if (props.title) element.title = props.title;
  if (props.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) {
      element.setAttribute(name, value);
    }
  }
  if (props.on) {
    for (const [eventName, handler] of Object.entries(props.on)) {
      if (handler) element.addEventListener(eventName, handler);
    }
  }
  for (const child of children) {
    element.append(child);
  }
  return element;
}

export function iconEl(
  icon: UiIconNode,
  options: CreateUiIconOptions = { className: 'ed-ui-icon', size: 14 },
): SVGElement {
  return createUiIcon(icon, {
    className: options.className ?? 'ed-ui-icon',
    size: options.size ?? 14,
    strokeWidth: options.strokeWidth ?? 2,
  });
}

export function chevronIcon(expanded: boolean): SVGElement {
  return iconEl(expanded ? UiIcons.chevronDown : UiIcons.chevronRight, {
    className: 'ed-ui-icon',
    size: 14,
  });
}

export function closeIcon(): SVGElement {
  return iconEl(UiIcons.x, { className: 'ed-ui-icon', size: 12 });
}

export function clearChildren(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

let toastElement: HTMLElement | null = null;
let toastTimer: number | null = null;

export function showToast(message: string, isError = false, durationMs = 2600): void {
  if (!toastElement) {
    toastElement = el('div', { className: 'ed-toast' });
    document.body.appendChild(toastElement);
  }
  toastElement.textContent = message;
  toastElement.classList.toggle('is-error', isError);
  toastElement.classList.add('is-visible');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = null;
  if (durationMs <= 0) return;
  toastTimer = window.setTimeout(() => {
    toastElement?.classList.remove('is-visible');
  }, durationMs);
}

export interface ContextMenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  children?: ContextMenuEntry[];
  panel?: () => ContextMenuPanel;
}

export type ContextMenuEntry = ContextMenuItem | 'sep';
export type ContextMenuPanel = HTMLElement & { focusSearch?: () => void };

let activeContextMenu: HTMLElement | null = null;
let closeContextMenuListeners: (() => void) | null = null;

export function closeContextMenu(): void {
  activeContextMenu?.remove();
  activeContextMenu = null;
  closeContextMenuListeners?.();
  closeContextMenuListeners = null;
}

/** Floating right-click menu at viewport coordinates; one open at a time. */
export function showContextMenu(x: number, y: number, entries: ContextMenuEntry[]): void {
  closeContextMenu();

  const menu = el('div', { className: 'ed-menu-dropdown ed-context-menu' });

  function appendEntries(host: HTMLElement, items: ContextMenuEntry[]): void {
    for (const entry of items) {
      if (entry === 'sep') {
        host.append(el('div', { className: 'ed-menu-sep' }));
        continue;
      }
      if ((entry.children && entry.children.length > 0) || entry.panel) {
        const submenuWrap = el('div', { className: 'ed-menu-submenu' });
        const trigger = el(
          'button',
          { className: 'ed-menu-item ed-menu-submenu-trigger' },
          [
            el('span', { className: 'ed-menu-item-label', text: entry.label }),
            chevronIcon(false),
          ],
        );
        const flyout = el('div', {
          className: `ed-menu-dropdown ed-menu-flyout${entry.panel ? ' ed-open-flyout' : ''}`,
        });
        const panel = entry.panel?.();
        if (panel) flyout.append(panel);
        else if (entry.children) appendEntries(flyout, entry.children);
        submenuWrap.append(trigger, flyout);
        const openSubmenu = (): void => {
          // Siblings only — a descendant query would also close the ancestor
          // flyout this submenu lives in, collapsing the whole chain.
          for (const node of host.querySelectorAll(':scope > .ed-menu-submenu')) {
            if (node !== submenuWrap) node.classList.remove('is-open');
          }
          submenuWrap.classList.add('is-open');
          panel?.focusSearch?.();
        };
        trigger.addEventListener('mouseenter', openSubmenu);
        trigger.addEventListener('click', (event) => {
          event.stopPropagation();
          openSubmenu();
        });
        submenuWrap.addEventListener('mouseleave', () => {
          submenuWrap.classList.remove('is-open');
        });
        host.append(submenuWrap);
        continue;
      }
      const button = el(
        'button',
        {
          className: 'ed-menu-item',
          on: {
            click: () => {
              if (entry.disabled) return;
              closeContextMenu();
              entry.action?.();
            },
          },
        },
        [el('span', { className: 'ed-menu-item-label', text: entry.label })],
      );
      button.disabled = entry.disabled ?? false;
      host.append(button);
    }
  }

  appendEntries(menu, entries);

  const host = document.getElementById('editor-root') ?? document.body;
  host.append(menu);
  activeContextMenu = menu;

  // Clamp inside the viewport once the size is known.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    closeContextMenu();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeContextMenu();
  };
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', closeContextMenu);
  closeContextMenuListeners = () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', closeContextMenu);
  };
}

export type ConfirmDialogOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

let activeConfirmDialog: { finish: (confirmed: boolean) => void } | null = null;

export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  if (activeConfirmDialog) activeConfirmDialog.finish(false);

  return new Promise((resolve) => {
    // Defer until after the triggering click finishes (e.g. File menu items).
    window.setTimeout(() => {
      const title = options.title ?? 'Confirm';
      const confirmLabel = options.confirmLabel ?? 'OK';
      const cancelLabel = options.cancelLabel ?? 'Cancel';
      const destructive = options.destructive ?? false;

      // Mount on body — #editor-root is z-index 250 stacking context; dialogs
      // inside it sit under play host / HUD and inherit user-select: none.
      const overlay = el('div', { className: 'ed-dialog-overlay' });
      const dialog = el('div', {
        className: 'ed-dialog',
        attrs: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'ed-dialog-title',
        },
      });

      const cancelBtn = el('button', {
        className: 'ed-btn ed-dialog-btn-cancel',
        text: cancelLabel,
        attrs: { type: 'button' },
        on: { click: () => finish(false) },
      });

      const confirmBtn = el('button', {
        className: `ed-btn ed-dialog-btn-confirm${destructive ? ' ed-btn-accent' : ''}`,
        text: confirmLabel,
        attrs: { type: 'button' },
        on: { click: () => finish(true) },
      });

      dialog.append(
        el('h2', { className: 'ed-dialog-title', text: title, attrs: { id: 'ed-dialog-title' } }),
        el('p', { className: 'ed-dialog-message', text: options.message }),
        el('div', { className: 'ed-dialog-actions' }, [cancelBtn, confirmBtn]),
      );
      overlay.append(dialog);
      document.body.append(overlay);

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      };

      const onOverlayClick = (event: Event): void => {
        if (event.target === overlay) finish(false);
      };

      overlay.addEventListener('click', onOverlayClick);
      window.addEventListener('keydown', onKeyDown);
      requestAnimationFrame(() => {
        overlay.classList.add('is-visible');
        cancelBtn.focus();
      });

      function cleanup(): void {
        overlay.removeEventListener('click', onOverlayClick);
        window.removeEventListener('keydown', onKeyDown);
        overlay.classList.remove('is-visible');
        window.setTimeout(() => overlay.remove(), 150);
        activeConfirmDialog = null;
      }

      function finish(confirmed: boolean): void {
        if (!activeConfirmDialog) return;
        activeConfirmDialog = null;
        cleanup();
        resolve(confirmed);
      }

      activeConfirmDialog = { finish };
    }, 0);
  });
}

export type SaveDiscardCancelResult = 'save' | 'discard' | 'cancel';

/**
 * Three-way confirm used when leaving a dirty prefab isolation layer.
 * Escape / overlay click → cancel.
 */
export function showSaveDiscardCancelDialog(options: {
  title?: string;
  message: string;
  saveLabel?: string;
  discardLabel?: string;
  cancelLabel?: string;
}): Promise<SaveDiscardCancelResult> {
  if (activeConfirmDialog) activeConfirmDialog.finish(false);

  return new Promise((resolve) => {
    window.setTimeout(() => {
      const title = options.title ?? 'Unsaved changes';
      const saveLabel = options.saveLabel ?? 'Save';
      const discardLabel = options.discardLabel ?? "Don't Save";
      const cancelLabel = options.cancelLabel ?? 'Cancel';

      const overlay = el('div', { className: 'ed-dialog-overlay' });
      const dialog = el('div', {
        className: 'ed-dialog',
        attrs: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'ed-dialog-title',
        },
      });

      const cancelBtn = el('button', {
        className: 'ed-btn ed-dialog-btn-cancel',
        text: cancelLabel,
        attrs: { type: 'button' },
        on: { click: () => finish('cancel') },
      });
      const discardBtn = el('button', {
        className: 'ed-btn ed-dialog-btn-cancel',
        text: discardLabel,
        attrs: { type: 'button' },
        on: { click: () => finish('discard') },
      });
      const saveBtn = el('button', {
        className: 'ed-btn ed-dialog-btn-confirm ed-btn-accent',
        text: saveLabel,
        attrs: { type: 'button' },
        on: { click: () => finish('save') },
      });

      dialog.append(
        el('h2', { className: 'ed-dialog-title', text: title, attrs: { id: 'ed-dialog-title' } }),
        el('p', { className: 'ed-dialog-message', text: options.message }),
        el('div', { className: 'ed-dialog-actions' }, [cancelBtn, discardBtn, saveBtn]),
      );
      overlay.append(dialog);
      document.body.append(overlay);

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish('cancel');
        }
      };
      const onOverlayClick = (event: Event): void => {
        if (event.target === overlay) finish('cancel');
      };

      overlay.addEventListener('click', onOverlayClick);
      window.addEventListener('keydown', onKeyDown);
      requestAnimationFrame(() => {
        overlay.classList.add('is-visible');
        cancelBtn.focus();
      });

      function cleanup(): void {
        overlay.removeEventListener('click', onOverlayClick);
        window.removeEventListener('keydown', onKeyDown);
        overlay.classList.remove('is-visible');
        window.setTimeout(() => overlay.remove(), 150);
        activeConfirmDialog = null;
      }

      function finish(result: SaveDiscardCancelResult): void {
        if (!activeConfirmDialog) return;
        activeConfirmDialog = null;
        cleanup();
        resolve(result);
      }

      // Compat with showConfirmDialog's singleton — Escape path uses finish(false)
      // only when that API owns the dialog; here we map cancel via our finish.
      activeConfirmDialog = {
        finish: (confirmed) => finish(confirmed ? 'save' : 'cancel'),
      };
    }, 0);
  });
}

export type PromptDialogOptions = {
  title?: string;
  message: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
};

let activePromptDialog: { finish: (value: string | null) => void } | null = null;

/** Electron blocks `window.prompt()` — use this in-editor text prompt instead. */
export function showPromptDialog(options: PromptDialogOptions): Promise<string | null> {
  if (activePromptDialog) activePromptDialog.finish(null);

  return new Promise((resolve) => {
    window.setTimeout(() => {
      const title = options.title ?? 'Input';
      const confirmLabel = options.confirmLabel ?? 'OK';
      const cancelLabel = options.cancelLabel ?? 'Cancel';
      const defaultValue = options.defaultValue ?? '';

      // Mount on body — same as React modals. Inside #editor-root the overlay
      // loses to higher body stacking contexts and inherits user-select: none,
      // so the New Folder field looks focused but never receives keys.
      const overlay = el('div', { className: 'ed-dialog-overlay' });
      const dialog = el('div', {
        className: 'ed-dialog',
        attrs: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'ed-dialog-title',
        },
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'ed-input ed-dialog-input';
      input.value = defaultValue;
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (options.placeholder) input.placeholder = options.placeholder;
      // Global shortcuts (W/E/R, Delete, Ctrl+Z) listen on window — don't leak.
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(input.value);
        }
      });

      const cancelBtn = el('button', {
        className: 'ed-btn ed-dialog-btn-cancel',
        text: cancelLabel,
        attrs: { type: 'button' },
        on: { click: () => finish(null) },
      });

      const confirmBtn = el('button', {
        className: 'ed-btn ed-dialog-btn-confirm',
        text: confirmLabel,
        attrs: { type: 'button' },
        on: { click: () => finish(input.value) },
      });

      dialog.append(
        el('h2', { className: 'ed-dialog-title', text: title, attrs: { id: 'ed-dialog-title' } }),
        el('p', { className: 'ed-dialog-message', text: options.message }),
        input,
        el('div', { className: 'ed-dialog-actions' }, [cancelBtn, confirmBtn]),
      );
      overlay.append(dialog);
      document.body.append(overlay);

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      };

      const onOverlayClick = (event: Event): void => {
        if (event.target === overlay) finish(null);
      };

      overlay.addEventListener('click', onOverlayClick);
      window.addEventListener('keydown', onKeyDown);
      requestAnimationFrame(() => {
        overlay.classList.add('is-visible');
        input.focus();
        input.select();
      });

      function cleanup(): void {
        overlay.removeEventListener('click', onOverlayClick);
        window.removeEventListener('keydown', onKeyDown);
        overlay.classList.remove('is-visible');
        window.setTimeout(() => overlay.remove(), 150);
        activePromptDialog = null;
      }

      function finish(value: string | null): void {
        if (!activePromptDialog) return;
        activePromptDialog = null;
        cleanup();
        resolve(value === null ? null : value.trim() || null);
      }

      activePromptDialog = { finish };
    }, 0);
  });
}
