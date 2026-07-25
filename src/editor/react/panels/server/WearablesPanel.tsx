import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { WEARABLE_SLOT_TYPES } from '../../../../player/inventory/types';
import type { WearableDefinition } from '../../../../net/admin-api';
import {
  AdminAuthError,
  createWearableDefinition,
  deleteWearableDefinition,
  ensureItemPrefabs,
  listWearableDefinitions,
  updateWearableDefinition,
} from './server-console-api';
import { DEFAULT_WEARABLE_FORM } from './defaults';
import { IconUrlField } from './FormComponents';
import { readWearableForm } from './form-readers';
import { useServerConsole } from './ServerConsoleContext';
import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminMessage,
  AdminPageHeader,
  AdminSearch,
  AdminToolbar,
} from './Components';
import { normalizeSearchQuery } from './utils';

export function WearablesPanel(): ReactElement {
  const { navigate, onAuthError } = useServerConsole();
  const [wearables, setWearables] = useState<WearableDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setWearables(null);
    setError(null);
    listWearableDefinitions()
      .then(setWearables)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load wearables.');
      });
  }, [onAuthError]);

  if (wearables === null && !error) {
    return <AdminMessage message="Loading wearable catalog..." status />;
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Wearable definitions" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const normalized = normalizeSearchQuery(query);
  const filtered = normalized
    ? (wearables ?? []).filter((wearable) =>
        [
          wearable.name,
          wearable.itemType,
          wearable.subType,
          wearable.wearableSlotType,
          ...wearable.occupiedSlotTypes,
          String(wearable.sidekickPartPresetId),
        ].some((value) => value.toLowerCase().includes(normalized)),
      )
    : (wearables ?? []);

  return (
    <>
      <AdminPageHeader
        title="Wearable definitions"
        subtitle={`${wearables?.length ?? 0} definition${wearables?.length === 1 ? '' : 's'}`}
      />
      <AdminToolbar>
        <AdminSearch placeholder="Search wearables…" value={query} onChange={setQuery} />
        <AdminButton
          type="button"
          onClick={() => navigate({ scene: 'wearable-form', wearableId: null })}
        >
          Create wearable definition
        </AdminButton>
      </AdminToolbar>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          <table className="sc-admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Primary slot</th>
                <th>Coverage</th>
                <th>Sidekick preset</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="is-static">
                  <td colSpan={5} className="sc-admin-empty">
                    No wearable definitions match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((wearable) => (
                  <tr
                    key={wearable.id}
                    onClick={() => navigate({ scene: 'wearable-form', wearableId: wearable.id })}
                  >
                    <td>{wearable.name}</td>
                    <td>{wearable.itemType}</td>
                    <td>{wearable.wearableSlotType}</td>
                    <td>{wearable.occupiedSlotTypes.join(', ')}</td>
                    <td>{String(wearable.sidekickPartPresetId)}</td>
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

export function WearableFormPanel({ wearableId }: { wearableId: string | null }): ReactElement {
  const { navigate, setStatus } = useServerConsole();
  const [existing, setExisting] = useState<WearableDefinition | null | undefined>(undefined);
  const [prefabs, setPrefabs] = useState<Awaited<ReturnType<typeof ensureItemPrefabs>>>([]);
  const [iconUrl, setIconUrl] = useState('');
  const [prefabId, setPrefabId] = useState('');

  useEffect(() => {
    void ensureItemPrefabs().then(setPrefabs);
    if (!wearableId) {
      setExisting(null);
      setIconUrl('');
      setPrefabId('');
      return;
    }
    listWearableDefinitions()
      .then((wearables) => {
        const wearable = wearables.find((entry) => entry.id === wearableId) ?? null;
        setExisting(wearable);
        if (wearable) {
          setIconUrl(wearable.iconUrl ?? '');
          setPrefabId(wearable.prefabId ?? '');
        }
      })
      .catch(() => setExisting(null));
  }, [wearableId]);

  if (existing === undefined) {
    return <AdminMessage message="Loading..." status />;
  }

  const defaults = existing ?? DEFAULT_WEARABLE_FORM;
  const prefabOptions = [
    { value: '', label: 'No item prefab' },
    ...prefabs.map((prefab) => ({
      value: prefab.id,
      label: `${prefab.label} (${prefab.id})`,
    })),
  ];

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const payload = readWearableForm(event.currentTarget);
    if (payload.sidekickPartPresetId <= 0) {
      setStatus('Sidekick preset ID must be positive.', true);
      return;
    }
    setStatus('Saving wearable definition...');
    const request = existing
      ? updateWearableDefinition(existing.id, payload)
      : createWearableDefinition(payload);
    request
      .then(() => navigate({ scene: 'wearables' }))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Save failed.', true);
      });
  };

  const handleDelete = (): void => {
    if (!existing) return;
    if (!window.confirm(`Delete wearable "${existing.name}"? This cannot be undone.`)) return;
    setStatus('Deleting wearable definition...');
    deleteWearableDefinition(existing.id)
      .then(() => navigate({ scene: 'wearables' }))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Delete failed.', true);
      });
  };

  return (
    <>
      <AdminPageHeader
        title={existing ? 'Edit wearable definition' : 'Create wearable definition'}
        subtitle={existing?.name}
        actions={
          <AdminButton
            variant="secondary"
            type="button"
            onClick={() => navigate({ scene: 'wearables' })}
          >
            Back to wearables
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
          <AdminField label="Item type">
            <select className="sc-admin-select" name="itemType" defaultValue={defaults.itemType}>
              <option value="clothing">Clothing</option>
              <option value="armor">Armor</option>
            </select>
          </AdminField>
          <AdminField label="Primary wearable slot">
            <select
              className="sc-admin-select"
              name="wearableSlotType"
              defaultValue={defaults.wearableSlotType}
            >
              {WEARABLE_SLOT_TYPES.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Occupied slots">
            <div className="sc-admin-check-grid">
              {WEARABLE_SLOT_TYPES.map((slot) => (
                <label key={slot}>
                  <input
                    type="checkbox"
                    name="occupiedSlotTypes"
                    value={slot}
                    defaultChecked={defaults.occupiedSlotTypes.includes(slot)}
                  />
                  {` ${slot}`}
                </label>
              ))}
            </div>
          </AdminField>
          <AdminField label="Sidekick part preset ID">
            <input
              className="sc-admin-input"
              name="sidekickPartPresetId"
              type="number"
              defaultValue={defaults.sidekickPartPresetId}
            />
          </AdminField>
          <AdminField label="Sub-type">
            <input
              className="sc-admin-input"
              name="subType"
              type="text"
              defaultValue={defaults.subType}
            />
          </AdminField>
          <AdminField label="Item prefab (optional)">
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
