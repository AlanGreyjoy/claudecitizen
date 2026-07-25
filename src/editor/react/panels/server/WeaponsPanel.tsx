import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { WEAPON_FIRE_MODES } from '../../../../player/inventory/types';
import { WEAPON_SLOT_TYPES } from '../../../../types/equipment';
import type { WeaponDefinition } from '../../../../net/admin-api';
import {
  AdminAuthError,
  createWeaponDefinition,
  deleteWeaponDefinition,
  ensureItemPrefabs,
  listItemDefinitions,
  listWeaponDefinitions,
  updateWeaponDefinition,
} from './server-console-api';
import { DEFAULT_WEAPON_FORM } from './defaults';
import { IconUrlField } from './FormComponents';
import { readWeaponForm } from './form-readers';
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

export function WeaponsPanel(): ReactElement {
  const { navigate, onAuthError } = useServerConsole();
  const [weapons, setWeapons] = useState<WeaponDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setWeapons(null);
    setError(null);
    listWeaponDefinitions()
      .then(setWeapons)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load weapons.');
      });
  }, [onAuthError]);

  if (weapons === null && !error) {
    return <AdminMessage message="Loading weapon catalog..." status />;
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Weapon definitions" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const normalized = normalizeSearchQuery(query);
  const filtered = normalized
    ? (weapons ?? []).filter((weapon) =>
        [
          weapon.name,
          weapon.weaponSlotType,
          weapon.subType,
          weapon.ammoItemDefinitionId ?? '',
          weapon.fireModes.join(' '),
          weapon.prefabId ?? '',
        ].some((value) => value.toLowerCase().includes(normalized)),
      )
    : (weapons ?? []);

  return (
    <>
      <AdminPageHeader
        title="Weapon definitions"
        subtitle={`${weapons?.length ?? 0} definition${weapons?.length === 1 ? '' : 's'}`}
      />
      <AdminToolbar>
        <AdminSearch placeholder="Search weapons…" value={query} onChange={setQuery} />
        <AdminButton type="button" onClick={() => navigate({ scene: 'weapon-form', weaponId: null })}>
          Create weapon definition
        </AdminButton>
      </AdminToolbar>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          <table className="sc-admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slot type</th>
                <th>Ammo</th>
                <th>Magazine</th>
                <th>Modes</th>
                <th>Prefab</th>
                <th>Rarity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="is-static">
                  <td colSpan={7} className="sc-admin-empty">
                    No weapon definitions match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((weapon) => (
                  <tr
                    key={weapon.id}
                    onClick={() => navigate({ scene: 'weapon-form', weaponId: weapon.id })}
                  >
                    <td>{weapon.name}</td>
                    <td>{weapon.weaponSlotType}</td>
                    <TruncatedCell text={weapon.ammoItemDefinitionId ?? '—'} maxLen={22} mono />
                    <td>{String(weapon.magazineSize)}</td>
                    <td>{weapon.fireModes.join(', ')}</td>
                    <TruncatedCell text={weapon.prefabId ?? '—'} maxLen={24} mono />
                    <td>{weapon.rarity}</td>
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

export function WeaponFormPanel({ weaponId }: { weaponId: string | null }): ReactElement {
  const { navigate, setStatus } = useServerConsole();
  const [existing, setExisting] = useState<WeaponDefinition | null | undefined>(undefined);
  const [prefabs, setPrefabs] = useState<Awaited<ReturnType<typeof ensureItemPrefabs>>>([]);
  const [ammoItems, setAmmoItems] = useState<Awaited<ReturnType<typeof listItemDefinitions>>>([]);
  const [iconUrl, setIconUrl] = useState('');
  const [prefabId, setPrefabId] = useState('');

  useEffect(() => {
    void Promise.all([ensureItemPrefabs(), listItemDefinitions()]).then(([nextPrefabs, items]) => {
      setPrefabs(nextPrefabs);
      setAmmoItems(items);
    });
    if (!weaponId) {
      setExisting(null);
      setIconUrl('');
      setPrefabId('');
      return;
    }
    listWeaponDefinitions()
      .then((weapons) => {
        const weapon = weapons.find((entry) => entry.id === weaponId) ?? null;
        setExisting(weapon);
        if (weapon) {
          setIconUrl(weapon.iconUrl ?? '');
          setPrefabId(weapon.prefabId ?? '');
        }
      })
      .catch(() => setExisting(null));
  }, [weaponId]);

  if (existing === undefined) {
    return <AdminMessage message="Loading..." status />;
  }

  const defaults = existing ?? DEFAULT_WEAPON_FORM;
  const prefabOptions = [
    { value: '', label: 'Select an item prefab' },
    ...prefabs.map((prefab) => ({ value: prefab.id, label: `${prefab.label} (${prefab.id})` })),
  ];
  const ammoOptions = [
    { value: '', label: 'No ammo (weapon cannot fire)' },
    ...ammoItems
      .filter((item) => item.itemType === 'ammo')
      .map((item) => ({ value: item.id, label: `${item.name} (${item.subType})` })),
  ];

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const payload = readWeaponForm(event.currentTarget);
    if (!payload.prefabId) {
      setStatus('Select an item prefab before saving.', true);
      return;
    }
    if (payload.fireModes.length === 0) {
      setStatus('Select at least one fire mode before saving.', true);
      return;
    }
    setStatus('Saving weapon definition...');
    const request = existing
      ? updateWeaponDefinition(existing.id, payload)
      : createWeaponDefinition(payload);
    request
      .then(() => navigate({ scene: 'weapons' }))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Save failed.', true);
      });
  };

  const handleDelete = (): void => {
    if (!existing) return;
    if (!window.confirm(`Delete weapon "${existing.name}"? This cannot be undone.`)) return;
    setStatus('Deleting weapon definition...');
    deleteWeaponDefinition(existing.id)
      .then(() => navigate({ scene: 'weapons' }))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Delete failed.', true);
      });
  };

  return (
    <>
      <AdminPageHeader
        title={existing ? 'Edit weapon definition' : 'Create weapon definition'}
        subtitle={existing?.name}
        actions={
          <AdminButton variant="secondary" type="button" onClick={() => navigate({ scene: 'weapons' })}>
            Back to weapons
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
          <AdminField label="Weapon slot type">
            <select
              className="sc-admin-select"
              name="weaponSlotType"
              defaultValue={defaults.weaponSlotType}
            >
              {WEAPON_SLOT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Sub-type">
            <input
              className="sc-admin-input"
              name="subType"
              type="text"
              defaultValue={defaults.subType}
            />
          </AdminField>
          <AdminField label="Item prefab">
            <select
              className="sc-admin-select"
              name="prefabId"
              value={prefabId || defaults.prefabId || ''}
              onChange={(event) => setPrefabId(event.currentTarget.value)}
            >
              {prefabOptions.map((option) => (
                <option key={option.value || 'none'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </AdminField>
          <IconUrlField value={iconUrl} onChange={setIconUrl} prefabId={prefabId} />
          <AdminField label="Ammo item definition">
            <select
              className="sc-admin-select"
              name="ammoItemDefinitionId"
              defaultValue={defaults.ammoItemDefinitionId ?? ''}
            >
              {ammoOptions.map((option) => (
                <option key={option.value || 'none'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Magazine size">
            <input
              className="sc-admin-input"
              name="magazineSize"
              type="number"
              defaultValue={defaults.magazineSize}
            />
          </AdminField>
          <AdminField label="Fire modes">
            <div className="sc-admin-check-grid">
              {WEAPON_FIRE_MODES.map((mode) => (
                <label key={mode}>
                  <input
                    type="checkbox"
                    name="fireModes"
                    value={mode}
                    defaultChecked={defaults.fireModes.includes(mode)}
                  />
                  {` ${mode}`}
                </label>
              ))}
            </div>
          </AdminField>
          <AdminField label="Rounds per minute">
            <input
              className="sc-admin-input"
              name="roundsPerMinute"
              type="number"
              defaultValue={defaults.roundsPerMinute}
            />
          </AdminField>
          <AdminField label="Muzzle velocity (m/s)">
            <input
              className="sc-admin-input"
              name="muzzleVelocityMps"
              type="number"
              step="0.1"
              defaultValue={defaults.muzzleVelocityMps}
            />
          </AdminField>
          <AdminField label="Bullet gravity (m/s²)">
            <input
              className="sc-admin-input"
              name="bulletGravityMps2"
              type="number"
              step="0.01"
              defaultValue={defaults.bulletGravityMps2}
            />
          </AdminField>
          <AdminField label="Maximum range (m)">
            <input
              className="sc-admin-input"
              name="maxRangeMeters"
              type="number"
              step="0.1"
              defaultValue={defaults.maxRangeMeters}
            />
          </AdminField>
          <AdminField label="Damage (future)">
            <input
              className="sc-admin-input"
              name="damage"
              type="number"
              step="0.1"
              defaultValue={defaults.damage}
            />
          </AdminField>
          <AdminField label="Cost (ARC)">
            <input
              className="sc-admin-input"
              name="costArc"
              type="number"
              defaultValue={defaults.costArc}
            />
          </AdminField>
          <AdminField label="Rarity">
            <input
              className="sc-admin-input"
              name="rarity"
              type="text"
              defaultValue={defaults.rarity}
            />
          </AdminField>
          <div className="sc-admin-actions">
            <AdminButton type="submit">
              {existing ? 'Save changes' : 'Create definition'}
            </AdminButton>
            {existing ? (
              <AdminButton variant="secondary" type="button" onClick={handleDelete}>
                Delete definition
              </AdminButton>
            ) : null}
          </div>
          <AdminMessage message="" status />
        </form>
      </AdminCard>
    </>
  );
}
