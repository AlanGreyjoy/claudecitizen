/** Previewable play menus for Menu Manager / File → Open Menus. */

export interface MenuCatalogEntry {
  id: string;
  name: string;
  /** Source element id in `index.html` under `#app`, or null when built in code. */
  templateId: string | null;
  description: string;
}

export const MENU_CATALOG: readonly MenuCatalogEntry[] = [
  {
    id: 'haloband',
    name: 'HaloBand',
    templateId: null,
    description: 'Personal device — Home dashboard + Comms, Missions, Map, Inventory, Ship',
  },
  {
    id: 'game-menu',
    name: 'Game Menu',
    templateId: 'game-menu',
    description: 'Esc pause — Video, Audio, Controls, Exit',
  },
  {
    id: 'personal-inventory',
    name: 'Personal Inventory',
    templateId: 'personal-inventory',
    description: 'I-key inventory + loadout (mock catalog)',
  },
  {
    id: 'weapon-shop',
    name: 'Weapon Shop',
    templateId: 'weapon-shop',
    description: 'Station weapon vendor screen',
  },
  {
    id: 'food-shop',
    name: 'Food Shop / Canteen',
    templateId: 'food-shop',
    description: 'Station food, drinks, and canteen vendor screen',
  },
  {
    id: 'outfitters',
    name: 'Outfitters',
    templateId: 'outfitters',
    description: 'Station gear vendor screen',
  },
  {
    id: 'avms',
    name: 'AVMS Terminal',
    templateId: 'avms-terminal',
    description: 'Hangar vehicle management',
  },
  {
    id: 'build-terminal',
    name: 'Build Terminal',
    templateId: 'build-terminal',
    description: 'Hangar / apartment build mode UI',
  },
  {
    id: 'entertainment',
    name: 'Entertainment System',
    templateId: 'entertainment-system',
    description: 'Bunk mini-TV / entertainment panel',
  },
] as const;

export type MenuPreviewId = (typeof MENU_CATALOG)[number]['id'];

export function findMenuCatalogEntry(id: string): MenuCatalogEntry | undefined {
  return MENU_CATALOG.find((entry) => entry.id === id);
}
