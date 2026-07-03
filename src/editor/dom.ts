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
