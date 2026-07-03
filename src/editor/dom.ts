/** Tiny DOM builder used by the editor panels. */

type ElementProps = {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<string, (event: Event) => void>>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: (HTMLElement | string)[] = [],
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

export function clearChildren(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

let toastElement: HTMLElement | null = null;
let toastTimer: number | null = null;

export function showToast(message: string, isError = false): void {
  if (!toastElement) {
    toastElement = el('div', { className: 'ed-toast' });
    document.body.appendChild(toastElement);
  }
  toastElement.textContent = message;
  toastElement.classList.toggle('is-error', isError);
  toastElement.classList.add('is-visible');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastElement?.classList.remove('is-visible');
  }, 2600);
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

      const host = document.getElementById('editor-root') ?? document.body;
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
      host.append(overlay);

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      };

      const onOverlayClick = (event: Event): void => {
        if (event.target === overlay) finish(false);
      };

      overlay.addEventListener('click', onOverlayClick);
      window.addEventListener('keydown', onKeyDown);
      requestAnimationFrame(() => overlay.classList.add('is-visible'));

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
      cancelBtn.focus();
    }, 0);
  });
}
