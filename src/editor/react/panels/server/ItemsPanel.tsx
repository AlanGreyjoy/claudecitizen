import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { ITEM_TYPES } from '../../../../player/inventory/types';
import type { ItemDefinition } from '../../../../net/admin-api';
import {
  AdminAuthError,
  createItemDefinition,
  deleteItemDefinition,
  ensureItemPrefabs,
  listBackpackDefinitions,
  listItemDefinitions,
  listWeaponDefinitions,
  listWearableDefinitions,
  routeItemDefinitionType,
  updateItemDefinition,
} from './server-console-api';
import { DEFAULT_ITEM_FORM } from './defaults';
import { IconUrlField } from './FormComponents';
import { readItemForm } from './form-readers';
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

export function ItemsPanel(): ReactElement {
  const { navigate, onAuthError } = useServerConsole();
  const [items, setItems] = useState<ItemDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setItems(null);
    setError(null);
    listItemDefinitions()
      .then(setItems)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load items.');
      });
  }, [onAuthError]);

  const handleRowClick = (item: ItemDefinition): void => {
    void routeItemDefinitionType(item).then((kind) => {
      if (kind === 'weapon') {
        void listWeaponDefinitions().then((weapons) => {
          const weapon = weapons.find((entry) => entry.id === item.id);
          if (weapon) navigate({ scene: 'weapon-form', weaponId: weapon.id });
        });
        return;
      }
      if (kind === 'backpack') {
        void listBackpackDefinitions().then((backpacks) => {
          const backpack = backpacks.find((entry) => entry.id === item.id);
          if (backpack) navigate({ scene: 'backpack-form', backpackId: backpack.id });
        });
        return;
      }
      if (kind === 'wearable') {
        void listWearableDefinitions().then((wearables) => {
          const wearable = wearables.find((entry) => entry.id === item.id);
          if (wearable) navigate({ scene: 'wearable-form', wearableId: wearable.id });
        });
        return;
      }
      navigate({ scene: 'item-form', itemId: item.id });
    });
  };

  if (items === null && !error) {
    return <AdminMessage message="Loading item catalog..." status />;
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Item definitions" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const normalized = normalizeSearchQuery(query);
  const filtered = normalized
    ? (items ?? []).filter(
        (item) =>
          item.name.toLowerCase().includes(normalized) ||
          item.itemType.toLowerCase().includes(normalized) ||
          item.subType.toLowerCase().includes(normalized) ||
          (item.prefabId?.toLowerCase().includes(normalized) ?? false),
      )
    : (items ?? []);

  return (
    <>
      <AdminPageHeader
        title="Item definitions"
        subtitle={`${items?.length ?? 0} definition${items?.length === 1 ? '' : 's'}`}
      />
      <AdminToolbar>
        <AdminSearch placeholder="Search items…" value={query} onChange={setQuery} />
        <AdminButton type="button" onClick={() => navigate({ scene: 'item-form', itemId: null })}>
          Create item definition
        </AdminButton>
      </AdminToolbar>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          <table className="sc-admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Sub-type</th>
                <th>Prefab</th>
                <th>Icon</th>
                <th>Stack max</th>
                <th>Rarity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="is-static">
                  <td colSpan={7} className="sc-admin-empty">
                    No item definitions match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} onClick={() => handleRowClick(item)}>
                    <td>{item.name}</td>
                    <td>{item.itemType}</td>
                    <td>{item.subType}</td>
                    {item.prefabId ? (
                      <TruncatedCell text={item.prefabId} maxLen={20} mono />
                    ) : (
                      <td>—</td>
                    )}
                    <td>{item.iconUrl ? 'yes' : '—'}</td>
                    <td>{String(item.stackMax)}</td>
                    <td>{item.rarity}</td>
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

export function ItemFormPanel({ itemId }: { itemId: string | null }): ReactElement {
  const { navigate, setStatus } = useServerConsole();
  const [existing, setExisting] = useState<ItemDefinition | null | undefined>(undefined);
  const [prefabs, setPrefabs] = useState<Awaited<ReturnType<typeof ensureItemPrefabs>>>([]);
  const [iconUrl, setIconUrl] = useState('');
  const [prefabId, setPrefabId] = useState('');

  useEffect(() => {
    void ensureItemPrefabs().then(setPrefabs);
    if (!itemId) {
      setExisting(null);
      setIconUrl('');
      setPrefabId('');
      return;
    }
    listItemDefinitions()
      .then((items) => {
        const item = items.find((entry) => entry.id === itemId) ?? null;
        setExisting(item);
        if (item) {
          setIconUrl(item.iconUrl ?? '');
          setPrefabId(item.prefabId ?? '');
        }
      })
      .catch(() => setExisting(null));
  }, [itemId]);

  if (existing === undefined) {
    return <AdminMessage message="Loading..." status />;
  }

  const defaults = existing
    ? {
        name: existing.name,
        description: existing.description,
        itemType: existing.itemType,
        subType: existing.subType,
        prefabId: existing.prefabId,
        iconUrl: existing.iconUrl,
        stackMax: existing.stackMax,
        costArc: existing.costArc,
        rarity: existing.rarity,
      }
    : { ...DEFAULT_ITEM_FORM };

  const prefabOptions = [
    { value: '', label: 'None (icon only)' },
    ...prefabs.map((prefab) => ({ value: prefab.id, label: `${prefab.label} (${prefab.id})` })),
  ];

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setStatus('Saving item definition...');
    const payload = readItemForm(event.currentTarget);
    const request = existing
      ? updateItemDefinition(existing.id, payload)
      : createItemDefinition(payload);
    request
      .then(() => navigate({ scene: 'items' }))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Save failed.', true);
      });
  };

  const handleDelete = (): void => {
    if (!existing) return;
    if (!window.confirm(`Delete item "${existing.name}"? This cannot be undone.`)) return;
    setStatus('Deleting item definition...');
    deleteItemDefinition(existing.id)
      .then(() => navigate({ scene: 'items' }))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Delete failed.', true);
      });
  };

  return (
    <>
      <AdminPageHeader
        title={existing ? 'Edit item definition' : 'Create item definition'}
        subtitle={existing?.name}
        actions={
          <AdminButton variant="secondary" type="button" onClick={() => navigate({ scene: 'items' })}>
            Back to items
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
              {ITEM_TYPES.filter(
                (type) =>
                  type !== 'weapon' &&
                  type !== 'backpack' &&
                  type !== 'armor' &&
                  type !== 'clothing',
              ).map((type) => (
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
          <AdminField label="Stack max">
            <input
              className="sc-admin-input"
              name="stackMax"
              type="number"
              defaultValue={defaults.stackMax}
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
