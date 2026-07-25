/** Clone play HUD menu markup from `index.html` for Menu Manager previews. */

import { mountPlayChromeIcons } from '../../ui/icons';

export function clonePlayMenuTemplate(sourceId: string): HTMLElement {
  const source = document.getElementById(sourceId);
  if (!source) {
    throw new Error(`Missing menu template #${sourceId} in index.html`);
  }
  const clone = source.cloneNode(true) as HTMLElement;
  stampOrigIds(clone);
  for (const input of clone.querySelectorAll('input[name]')) {
    const name = input.getAttribute('name');
    if (name) input.setAttribute('name', `ed-preview-${name}`);
  }
  clone.classList.add('is-embedded');
  clone.classList.remove('is-open');
  clone.setAttribute('aria-hidden', 'true');
  mountPlayChromeIcons(clone);
  return clone;
}

function stampOrigIds(root: HTMLElement): void {
  if (root.id) {
    root.dataset.origId = root.id;
    root.removeAttribute('id');
  }
  for (const node of root.querySelectorAll('[id]')) {
    const el = node as HTMLElement;
    el.dataset.origId = el.id;
    el.removeAttribute('id');
  }
}

export function requireOrig<T extends HTMLElement>(root: HTMLElement, origId: string): T {
  if (root.dataset.origId === origId) return root as T;
  const match = root.querySelector(`[data-orig-id="${CSS.escape(origId)}"]`);
  if (!(match instanceof HTMLElement)) {
    throw new Error(`Missing [data-orig-id="${origId}"] in cloned menu`);
  }
  return match as T;
}
