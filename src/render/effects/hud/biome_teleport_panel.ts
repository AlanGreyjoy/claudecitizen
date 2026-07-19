import {
  SURFACE_DESTINATION_TARGETS,
  surfaceDestinationDisplayName,
  type SurfaceDestination,
} from '../../../world/biome_teleport';

export interface SurfaceTeleportPanelCallbacks {
  onTeleport: (destination: SurfaceDestination) => boolean;
  onStatus?: (text: string) => void;
}

export function createSurfaceTeleportPanel(
  rootEl: HTMLElement,
  callbacks: SurfaceTeleportPanelCallbacks,
) {
  rootEl.replaceChildren();
  rootEl.classList.add('sc-biome-teleport');

  const title = document.createElement('p');
  title.className = 'sc-biome-teleport-title';
  title.textContent = 'Surface Teleport';
  rootEl.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'sc-biome-teleport-grid';
  rootEl.appendChild(grid);

  for (const destination of SURFACE_DESTINATION_TARGETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sc-biome-teleport-btn';
    const label = surfaceDestinationDisplayName(destination);
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = callbacks.onTeleport(destination);
      if (ok) {
        callbacks.onStatus?.(`Teleported to ${label}.`);
      } else {
        callbacks.onStatus?.(`No ${label} site found (try again).`);
      }
    });
    grid.appendChild(button);
  }

  function setVisible(visible: boolean): void {
    rootEl.classList.toggle('is-hidden', !visible);
  }

  return { setVisible };
}
