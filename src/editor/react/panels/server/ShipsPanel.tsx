import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { ShipDefinition } from '../../../../net/admin-api';
import {
  AdminAuthError,
  createShipDefinition,
  ensureShipPrefabs,
  listShipDefinitions,
  updateShipDefinition,
} from './server-console-api';
import { DEFAULT_SHIP_FORM } from './defaults';
import { readShipForm } from './form-readers';
import { IconUrlField } from './FormComponents';
import { useServerConsole } from './ServerConsoleContext';
import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminMessage,
  AdminPageHeader,
  AdminSearch,
  AdminToolbar,
  TruncatedCell,
} from './Components';
import { normalizeSearchQuery } from './utils';

export function ShipsPanel(): ReactElement {
  const { navigate, onAuthError } = useServerConsole();
  const [ships, setShips] = useState<ShipDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setShips(null);
    setError(null);
    listShipDefinitions()
      .then(setShips)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load ships.');
      });
  }, [onAuthError]);

  if (ships === null && !error) {
    return <AdminMessage message="Loading ship catalog..." status />;
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Ship definitions" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const normalized = normalizeSearchQuery(query);
  const filtered = normalized
    ? (ships ?? []).filter(
        (ship) =>
          ship.name.toLowerCase().includes(normalized) ||
          ship.prefabId.toLowerCase().includes(normalized),
      )
    : (ships ?? []);

  return (
    <>
      <AdminPageHeader
        title="Ship definitions"
        subtitle={`${ships?.length ?? 0} definition${ships?.length === 1 ? '' : 's'}`}
      />
      <AdminToolbar>
        <AdminSearch placeholder="Search ships…" value={query} onChange={setQuery} />
        <AdminButton type="button" onClick={() => navigate({ scene: 'ship-form', shipId: null })}>
          Create ship definition
        </AdminButton>
      </AdminToolbar>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          <table className="sc-admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefab</th>
                <th>Cost (ARC)</th>
                <th>Max HP</th>
                <th>Max shields</th>
                <th>Max speed</th>
                <th>Accel</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="is-static">
                  <td colSpan={7} className="sc-admin-empty">
                    No ship definitions match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((ship) => (
                  <tr key={ship.id} onClick={() => navigate({ scene: 'ship-form', shipId: ship.id })}>
                    <td>{ship.name}</td>
                    <TruncatedCell text={ship.prefabId} maxLen={24} mono />
                    <td>{ship.costArc.toLocaleString()}</td>
                    <td>{String(ship.maxHp)}</td>
                    <td>{String(ship.maxShields)}</td>
                    <td>{String(ship.maxSpeedMps)}</td>
                    <td>{String(ship.throttleAccelMps2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminCard>
      <AdminMessage message="" />
    </>
  );
}

export function ShipFormPanel({ shipId }: { shipId: string | null }): ReactElement {
  const { navigate, setStatus } = useServerConsole();
  const [existing, setExisting] = useState<ShipDefinition | null | undefined>(undefined);
  const [prefabs, setPrefabs] = useState<Awaited<ReturnType<typeof ensureShipPrefabs>>>([]);
  const [iconUrl, setIconUrl] = useState('');
  const [prefabId, setPrefabId] = useState('');

  useEffect(() => {
    void ensureShipPrefabs().then(setPrefabs);
    if (!shipId) {
      setExisting(null);
      setIconUrl('');
      setPrefabId('');
      return;
    }
    listShipDefinitions()
      .then((ships) => {
        const ship = ships.find((entry) => entry.id === shipId) ?? null;
        setExisting(ship);
        if (ship) {
          setIconUrl(ship.iconUrl ?? '');
          setPrefabId(ship.prefabId);
        }
      })
      .catch(() => setExisting(null));
  }, [shipId]);

  if (existing === undefined) {
    return <AdminMessage message="Loading..." status />;
  }

  const defaults = existing
    ? {
        name: existing.name,
        description: existing.description,
        prefabId: existing.prefabId,
        iconUrl: existing.iconUrl,
        costArc: existing.costArc,
        maxHp: existing.maxHp,
        maxShields: existing.maxShields,
        shieldRegenPerSec: existing.shieldRegenPerSec,
        maxSpeedMps: existing.maxSpeedMps,
        throttleAccelMps2: existing.throttleAccelMps2,
      }
    : { ...DEFAULT_SHIP_FORM, prefabId: prefabs[0]?.id ?? DEFAULT_SHIP_FORM.prefabId };

  const activePrefabId = prefabId || defaults.prefabId;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setStatus('Saving ship definition...');
    const payload = readShipForm(event.currentTarget);
    const request = existing
      ? updateShipDefinition(existing.id, payload)
      : createShipDefinition(payload);
    request
      .then(() => navigate({ scene: 'ships' }))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Save failed.', true);
      });
  };

  return (
    <>
      <AdminPageHeader
        title={existing ? 'Edit ship definition' : 'Create ship definition'}
        subtitle={existing?.name}
        actions={
          <AdminButton variant="secondary" type="button" onClick={() => navigate({ scene: 'ships' })}>
            Back to ships
          </AdminButton>
        }
      />
      <AdminCard>
        <form className="sc-admin-form sc-admin-form-wide" onSubmit={handleSubmit}>
          <AdminField label="Name">
            <input className="sc-admin-input" name="name" type="text" defaultValue={defaults.name} />
          </AdminField>
          <AdminField label="Description">
            <textarea
              className="sc-admin-textarea"
              name="description"
              defaultValue={defaults.description}
            />
          </AdminField>
          <AdminField label="Ship prefab">
            <select
              className="sc-admin-select"
              name="prefabId"
              value={activePrefabId}
              onChange={(event) => setPrefabId(event.currentTarget.value)}
            >
              {prefabs.map((prefab) => (
                <option key={prefab.id} value={prefab.id}>
                  {prefab.label} ({prefab.id})
                </option>
              ))}
            </select>
          </AdminField>
          <IconUrlField
            value={iconUrl}
            onChange={setIconUrl}
            prefabId={activePrefabId}
            prefabKind="ship"
          />
          <AdminField label="Cost (ARC)">
            <input
              className="sc-admin-input"
              name="costArc"
              type="number"
              defaultValue={defaults.costArc}
            />
          </AdminField>
          <AdminField label="Max HP">
            <input
              className="sc-admin-input"
              name="maxHp"
              type="number"
              defaultValue={defaults.maxHp}
            />
          </AdminField>
          <AdminField label="Max shields">
            <input
              className="sc-admin-input"
              name="maxShields"
              type="number"
              defaultValue={defaults.maxShields}
            />
          </AdminField>
          <AdminField label="Shield regen / sec">
            <input
              className="sc-admin-input"
              name="shieldRegenPerSec"
              type="number"
              step="0.1"
              defaultValue={defaults.shieldRegenPerSec}
            />
          </AdminField>
          <AdminField label="Max speed (m/s)">
            <input
              className="sc-admin-input"
              name="maxSpeedMps"
              type="number"
              step="0.1"
              defaultValue={defaults.maxSpeedMps}
            />
          </AdminField>
          <AdminField label="Throttle accel (m/s²)">
            <input
              className="sc-admin-input"
              name="throttleAccelMps2"
              type="number"
              step="0.1"
              defaultValue={defaults.throttleAccelMps2}
            />
          </AdminField>
          <div className="sc-admin-actions">
            <AdminButton type="submit">
              {existing ? 'Save changes' : 'Create definition'}
            </AdminButton>
          </div>
          <AdminMessage message="" status />
        </form>
      </AdminCard>
    </>
  );
}
