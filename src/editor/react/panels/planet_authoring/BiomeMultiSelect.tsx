import type { ReactElement } from 'react';
import { biomeDisplayName } from '../../../../world/climate';
import { BIOME_KEYS } from '../../../../world/planets/schema';
import type { Biome } from '../../../../types';

export function BiomeMultiSelect({
  selected,
  onChange,
  label = 'Biomes',
}: {
  selected: readonly Biome[];
  onChange: (next: Biome[]) => void;
  label?: string;
}): ReactElement {
  const selectedSet = new Set(selected);
  return (
    <div className="ed-planet-biome-row">
      <span className="ed-planet-biome-label">{label}</span>
      <div className="ed-planet-biome-chips">
        {BIOME_KEYS.map((biome) => {
          const active = selectedSet.has(biome);
          return (
            <button
              key={biome}
              type="button"
              className={`ed-planet-biome-chip${active ? ' is-active' : ''}`}
              title={biome}
              onClick={() => {
                const next = new Set(selectedSet);
                if (next.has(biome)) next.delete(biome);
                else next.add(biome);
                onChange(BIOME_KEYS.filter((key) => next.has(key)));
              }}
            >
              {biomeDisplayName(biome)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
