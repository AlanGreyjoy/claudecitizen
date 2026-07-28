import titleScreenMarkup from './title-screen.html?raw';
import loadingScreenMarkup from './loading-screen.html?raw';
import brandLogoUrl from '../../assets/generated/claudecitizen-logo-transparent.png';

/**
 * Full-screen game shells (title/auth, loading). Each fragment carries its own
 * root id and starts hidden, so the existing screen controllers keep toggling
 * `is-hidden` exactly as they did when this markup lived in `index.html`.
 *
 * In-editor Play mounts into `#editor-play-host` (inset below the toolbar, with
 * a CSS transform that contains `position: fixed`). Body mount would cover
 * Play/Stop at z-index 300+.
 */
function shellMountParent(): HTMLElement {
  return document.getElementById('editor-play-host') ?? document.body;
}

function ensureFragment(id: string, markup: string): HTMLElement {
  const parent = shellMountParent();
  const existing = document.getElementById(id);
  if (existing) {
    if (existing.parentElement !== parent) parent.append(existing);
    return existing;
  }
  const holder = document.createElement('div');
  holder.innerHTML = markup.trim();
  const root = holder.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error(`Screen markup for #${id} produced no root element`);
  }
  // Raw markup bypasses Vite's HTML asset rewriting, so bundle the logo here.
  for (const image of root.querySelectorAll<HTMLImageElement>('img[data-brand-logo]')) {
    image.src = brandLogoUrl;
  }
  parent.append(root);
  return root;
}

export function ensureTitleScreenMarkup(): HTMLElement {
  return ensureFragment('title-screen', titleScreenMarkup);
}

export function ensureLoadingScreenMarkup(): HTMLElement {
  return ensureFragment('loading-screen', loadingScreenMarkup);
}
