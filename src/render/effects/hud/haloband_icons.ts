import {
  Backpack,
  ClipboardList,
  House,
  Map,
  MessageSquare,
  Rocket,
} from 'lucide';
import { createUiIcon, type UiIconNode } from '../../../ui/icons';

const DOCK_ICON_NODES: Record<string, UiIconNode> = {
  home: House,
  comms: MessageSquare,
  missions: ClipboardList,
  map: Map,
  inventory: Backpack,
  ship: Rocket,
};

export function createHaloBandDockIcon(tabId: string): SVGElement | null {
  const node = DOCK_ICON_NODES[tabId];
  if (!node) return null;
  return createUiIcon(node, {
    className: 'sc-haloband-dock-icon sc-ui-icon',
    size: 22,
    strokeWidth: 1.75,
  });
}

/** Replace any existing dock SVGs with Lucide icons (play HTML + factory). */
export function mountHaloBandDockIcons(rootEl: HTMLElement): void {
  for (const button of rootEl.querySelectorAll<HTMLButtonElement>('[data-haloband-tab]')) {
    const tabId = button.dataset.halobandTab;
    if (!tabId) continue;
    const icon = createHaloBandDockIcon(tabId);
    if (!icon) continue;
    button.querySelectorAll('svg.sc-haloband-dock-icon, svg.lucide').forEach((el) => el.remove());
    const label = button.querySelector('.sc-haloband-dock-label');
    if (label) button.insertBefore(icon, label);
    else button.prepend(icon);
  }
}
