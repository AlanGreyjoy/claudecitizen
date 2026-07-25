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
  if (existing) {
    mountedRoot = existing;
    if (existing.parentElement !== container) container.append(existing);
    return existing;
  }

  const root = document.createElement('div');
  root.id = PLAY_CHROME_ROOT_ID;
  root.className = 'is-hidden';
  root.innerHTML = playChromeMarkup;
  container.append(root);
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
