import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { BackpackDefinition } from '../../../../net/admin-api';
import {
  AdminAuthError,
  createBackpackDefinition,
  deleteBackpackDefinition,
  ensureItemPrefabs,
  listBackpackDefinitions,
  updateBackpackDefinition,
  validateBackpackPrefabId,
} from './server-console-api';
import { DEFAULT_BACKPACK_FORM } from './defaults';
import { IconUrlField } from './FormComponents';
import { readBackpackForm } from './form-readers';
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

export function BackpacksPanel(): ReactElement {
  const { navigate, onAuthError } = useServerConsole();
  const [backpacks, setBackpacks] = useState<BackpackDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setBackpacks(null);
    setError(null);
    listBackpackDefinitions()
      .then(setBackpacks)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load backpacks.');
      });
  }, [onAuthError]);

  if (backpacks === null && !error) {
    return <AdminMessage message="Loading backpack catalog..." status />;
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Backpack definitions" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const normalized = normalizeSearchQuery(query);
  const filtered = normalized
    ? (backpacks ?? []).filter((backpack) =>
        [backpack.name, backpack.subType, backpack.prefabId ?? ''].some((value) =>
          value.toLowerCase().includes(normalized),
        ),
      )
    : (backpacks ?? []);

  return (
    <>
      <AdminPageHeader
        title="Backpack definitions"
        subtitle={`${backpacks?.length ?? 0} definition${backpacks?.length === 1 ? '' : 's'}`}
      />
      <AdminToolbar>
        <AdminSearch placeholder="Search backpacks…" value={query} onChange={setQuery} />
        <AdminButton
          type="button"
          onClick={() => navigate({ scene: 'backpack-form', backpackId: null })}
        >
          Create backpack definition
        </AdminButton>
      </AdminToolbar>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          <table className="sc-admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Capacity</th>
                <th>Empty mass</th>
                <th>Sub-type</th>
                <th>Prefab</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="is-static">
                  <td colSpan={5} className="sc-admin-empty">
                    No backpack definitions match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((backpack) => (
                  <tr
                    key={backpack.id}
                    onClick={() => navigate({ scene: 'backpack-form', backpackId: backpack.id })}
                  >
                    <td>{backpack.name}</td>
                    <td>{`${backpack.capacityLiters} L`}</td>
                    <td>{`${backpack.emptyMassKg} kg`}</td>
                    <td>{backpack.subType}</td>
                    <TruncatedCell text={backpack.prefabId ?? '—'} maxLen={24} mono />
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

export function BackpackFormPanel({ backpackId }: { backpackId: string | null }): ReactElement {
  const { navigate, setStatus } = useServerConsole();
  const [existing, setExisting] = useState<BackpackDefinition | null | undefined>(undefined);
  const [prefabs, setPrefabs] = useState<Awaited<ReturnType<typeof ensureItemPrefabs>>>([]);
  const [iconUrl, setIconUrl] = useState('');
  const [prefabId, setPrefabId] = useState('');

  useEffect(() => {
    void ensureItemPrefabs().then(setPrefabs);
    if (!backpackId) {
      setExisting(null);
      setIconUrl('');
      setPrefabId('');
      return;
    }
    listBackpackDefinitions()
      .then((backpacks) => {
        const backpack = backpacks.find((entry) => entry.id === backpackId) ?? null;
        setExisting(backpack);
        if (backpack) {
          setIconUrl(backpack.iconUrl ?? '');
          setPrefabId(backpack.prefabId ?? '');
        }
      })
      .catch(() => setExisting(null));
  }, [backpackId]);

  if (existing === undefined) {
    return <AdminMessage message="Loading..." status />;
  }

  const defaults = existing ?? DEFAULT_BACKPACK_FORM;
  const prefabOptions = [
    { value: '', label: 'Select an item prefab' },
    ...prefabs.map((prefab) => ({ value: prefab.id, label: `${prefab.label} (${prefab.id})` })),
  ];

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void (async () => {
      const payload = readBackpackForm(event.currentTarget);
      if (!payload.prefabId) {
        setStatus('Select an item prefab before saving.', true);
        return;
      }
      setStatus('Validating backpack prefab...');
      const errors = await validateBackpackPrefabId(payload.prefabId);
      if (errors.length > 0) {
        setStatus(`Backpack cannot be saved: ${errors.join(' ')}`, true);
        return;
      }
      setStatus('Saving backpack definition...');
      const request = existing
        ? updateBackpackDefinition(existing.id, payload)
        : createBackpackDefinition(payload);
      await request;
      navigate({ scene: 'backpacks' });
    })().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Save failed.', true);
    });
  };

  const handleDelete = (): void => {
    if (!existing) return;
    if (!window.confirm(`Delete backpack "${existing.name}"? This cannot be undone.`)) return;
    setStatus('Deleting backpack definition...');
    deleteBackpackDefinition(existing.id)
      .then(() => navigate({ scene: 'backpacks' }))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Delete failed.', true);
      });
  };

  return (
    <>
      <AdminPageHeader
        title={existing ? 'Edit backpack definition' : 'Create backpack definition'}
        subtitle={existing?.name}
        actions={
          <AdminButton
            variant="secondary"
            type="button"
            onClick={() => navigate({ scene: 'backpacks' })}
          >
            Back to backpacks
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
          <AdminField label="Capacity (liters)">
            <input
              className="sc-admin-input"
              name="capacityLiters"
              type="number"
              step="0.1"
              defaultValue={defaults.capacityLiters}
            />
          </AdminField>
          <AdminField label="Empty mass (kg)">
            <input
              className="sc-admin-input"
              name="emptyMassKg"
              type="number"
              step="0.1"
              defaultValue={defaults.emptyMassKg}
            />
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
