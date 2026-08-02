import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { fetchPrefabList, type PrefabListEntry } from '../../api';

type StationsPanelProps = {
  hidden: boolean;
  onOpenStation: (id: string) => void | Promise<void>;
};

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Station prefab browser for the top-level Stations editor tab. */
export function StationsPanel({ hidden, onOpenStation }: StationsPanelProps): ReactElement {
  const [stations, setStations] = useState<PrefabListEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');

  const refresh = useCallback(async (): Promise<void> => {
    setLoadState('loading');
    try {
      const prefabs = await fetchPrefabList();
      setStations(prefabs.filter((entry) => entry.kind === 'station'));
      setLoadState('ready');
    } catch {
      setStations([]);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    if (!hidden) void refresh();
  }, [hidden, refresh]);

  return (
    <div className={`ed-scene-panel ed-stations-host${hidden ? ' is-hidden' : ''}`}>
      <div className="ed-stations-page">
        <div className="ed-stations-heading">
          <div>
            <h2 className="ed-base-panel-title">Stations</h2>
            <p className="ed-stations-copy">
              Station prefabs in the open AsteronEngine project.
            </p>
          </div>
          <button type="button" className="ed-btn" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>

        {loadState === 'loading' ? (
          <div className="ed-stations-message">Loading stations…</div>
        ) : null}
        {loadState === 'error' ? (
          <div className="ed-stations-message is-error">
            Could not load station prefabs. Check the editor project connection and retry.
          </div>
        ) : null}
        {loadState === 'ready' && stations.length === 0 ? (
          <div className="ed-stations-message">
            No station prefabs found. Create a prefab with kind Station to add one here.
          </div>
        ) : null}

        <div className="ed-stations-grid">
          {stations.map((station) => (
            <button
              key={station.id}
              type="button"
              className="ed-station-card"
              onClick={() => void onOpenStation(station.id)}
            >
              <span className="ed-station-card-name">{station.name}</span>
              <span className="ed-station-card-id">{station.id}</span>
              <span className="ed-station-card-action">Open prefab →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
