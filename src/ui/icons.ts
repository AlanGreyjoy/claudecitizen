/**
 * Shared Lucide icon helpers for vanilla DOM UI (no React).
 */
import {
  BookOpen,
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  createElement,
  Droplets,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  Hammer,
  PersonStanding,
  Power,
  Satellite,
  Utensils,
  Video,
  X,
  type IconNode,
} from 'lucide';

export type UiIconNode = IconNode;

export interface CreateUiIconOptions {
  className?: string;
  size?: number;
  strokeWidth?: number;
}

export function createUiIcon(
  icon: IconNode,
  options: CreateUiIconOptions = {},
): SVGElement {
  const { className = '', size = 18, strokeWidth = 1.75 } = options;
  return createElement(icon, {
    class: className,
    width: size,
    height: size,
    'stroke-width': strokeWidth,
    'aria-hidden': 'true',
  });
}

/** Clear host and append a Lucide icon (for icon-only buttons). */
export function setUiIcon(
  host: HTMLElement,
  icon: IconNode,
  options: CreateUiIconOptions = {},
): void {
  host.replaceChildren(createUiIcon(icon, options));
}

export const UiIcons = {
  bug: Bug,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  externalLink: ExternalLink,
  eye: Eye,
  eyeOff: EyeOff,
  film: Film,
  hammer: Hammer,
  personStanding: PersonStanding,
  power: Power,
  bookOpen: BookOpen,
  satellite: Satellite,
  droplets: Droplets,
  utensils: Utensils,
  x: X,
  youtube: Video,
} as const;

/** Stamp Lucide into static play chrome buttons in `index.html`. */
export function mountPlayChromeIcons(root: ParentNode = document): void {
  const find = (id: string): HTMLElement | null =>
    root.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ??
    root.querySelector<HTMLElement>(`[data-orig-id="${CSS.escape(id)}"]`);

  const fill = (id: string, icon: IconNode, size = 18): void => {
    const el = find(id);
    if (el) setUiIcon(el, icon, { className: 'sc-ui-icon', size });
  };

  fill('hud-debug-btn', Bug, 18);
  fill('hud-build-btn', Hammer, 18);
  fill('avms-power-btn', Power);
  fill('avms-close-btn', X);
  fill('build-close-btn', X);
  fill('es-back-btn', ChevronLeft);
  fill('es-power-btn', Power);
  fill('es-close-btn', X);
  fill('weapon-shop-power-btn', Power);
  fill('weapon-shop-close-btn', X);
  fill('outfitters-power-btn', Power);
  fill('outfitters-close-btn', X);
  fill('personal-inventory-close', X, 16);

  const esApps: Array<{ id: string; icon: IconNode }> = [
    { id: 'es-docs-tile', icon: BookOpen },
    { id: 'es-youtube-tile', icon: Video },
    { id: 'es-nasa-tile', icon: Satellite },
    { id: 'es-localnow-tile', icon: Film },
  ];
  for (const { id, icon } of esApps) {
    const tile = find(id);
    const host = tile?.querySelector<HTMLElement>('.sc-es-app-icon');
    if (host) {
      setUiIcon(host, icon, { className: 'sc-ui-icon sc-es-app-icon-svg', size: 32 });
    }
  }

  for (const expand of root.querySelectorAll<HTMLElement>('.sc-haloband-tile-expand')) {
    setUiIcon(expand, ExternalLink, {
      className: 'sc-ui-icon',
      size: 10,
      strokeWidth: 2,
    });
  }
}
