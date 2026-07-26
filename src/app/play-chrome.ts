import playChromeMarkup from './play-chrome.html?raw';
import { mountPlayChromeIcons } from '../ui/icons';

/**
 * In-play HUD chrome (canvas, readouts, reticles, terminals, HaloBand).
 *
 * The markup lives in `play-chrome.html` and is injected into a caller-supplied
 * container so the same tree can host the shipped web game, an in-editor Game
 * panel, or a prefab playtest. Element ids inside stay document-unique, so
 * modules that resolve HUD nodes globally keep working.
 */
const PLAY_CHROME_ROOT_ID = 'app';

let mountedRoot: HTMLElement | null = null;

export function mountPlayChrome(container: HTMLElement): HTMLElement {
  const existing = document.getElementById(PLAY_CHROME_ROOT_ID);
  // Editor Play uses `#editor-play-host` as the Game region. Never steal `#app`
  // onto `document.body` while that host exists — body mount leaves the host as
  // an empty black overlay that eats clicks (no pointer lock, no visible frame).
  const playHost = document.getElementById('editor-play-host');
  const target = playHost ?? container;
  if (existing) {
    mountedRoot = existing;
    if (existing.parentElement !== target) target.append(existing);
    existing.classList.remove('is-hidden');
    return existing;
  }

  const root = document.createElement('div');
  root.id = PLAY_CHROME_ROOT_ID;
  root.className = 'is-hidden';
  root.innerHTML = playChromeMarkup;
  target.append(root);
  mountPlayChromeIcons(root);
  mountedRoot = root;
  return root;
}

export function unmountPlayChrome(): void {
  mountedRoot?.remove();
  mountedRoot = null;
}

export function getPlayChromeRoot(): HTMLElement | null {
  return mountedRoot ?? document.getElementById(PLAY_CHROME_ROOT_ID);
}
