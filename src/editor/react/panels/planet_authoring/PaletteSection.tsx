import type { ReactElement } from 'react';
import { biomeDisplayName } from '../../../../world/climate';
import { SURFACE_PALETTE_KEYS, type SurfacePaletteKey } from '../../../../world/planets/schema';
import { PlanetColorField } from './Fields';
import type { PlanetAuthoringSectionProps } from './section-types';

function paletteDisplayName(key: SurfacePaletteKey): string {
  if (key === 'coast') return 'coast';
  if (key === 'ocean' || key === 'lake' || key === 'river') return key;
  return biomeDisplayName(key);
}

export function PaletteSection({ doc, onMarkDirty }: PlanetAuthoringSectionProps): ReactElement {
  return (
    <>
      {SURFACE_PALETTE_KEYS.map((key) => (
        <PlanetColorField
          key={key}
          label={paletteDisplayName(key)}
          value={doc.palette[key]}
          onChange={(value) => {
            doc.palette[key] = value;
            onMarkDirty();
          }}
        />
      ))}
    </>
  );
}
