import type { Biome } from '../../../types';
import { BIOME_TELEPORT_TARGETS } from '../../../world/biome_teleport';

export interface BiomeTeleportPanelCallbacks {
  onTeleport: (biome: Biome) => boolean;
  onStatus?: (text: string) => void;
}

export function createBiomeTeleportPanel(
  rootEl: HTMLElement,
  callbacks: BiomeTeleportPanelCallbacks,
) {
  rootEl.replaceChildren();
  rootEl.classList.add('sc-biome-teleport');

  const title = document.createElement('p');
  title.className = 'sc-biome-teleport-title';
  title.textContent = 'Biome Teleport';
  rootEl.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'sc-biome-teleport-grid';
  rootEl.appendChild(grid);

  for (const biome of BIOME_TELEPORT_TARGETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sc-biome-teleport-btn';
    button.textContent = biome;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = callbacks.onTeleport(biome);
      if (ok) {
        callbacks.onStatus?.(`Teleported to ${biome}.`);
      } else {
        callbacks.onStatus?.(`No ${biome} site found (try again).`);
      }
    });
    grid.appendChild(button);
  }

  function setVisible(visible: boolean): void {
    rootEl.classList.toggle('is-hidden', !visible);
  }

  return { setVisible };
}
