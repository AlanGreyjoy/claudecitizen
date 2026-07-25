import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { PropDefinition } from '../../../../net/admin-api';
import {
  AdminAuthError,
  createPropDefinition,
  ensurePropPrefabs,
  listPropDefinitions,
  updatePropDefinition,
} from './server-console-api';
import { DEFAULT_PROP_FORM } from './defaults';
import { readPropForm } from './form-readers';
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

export function PropsPanel(): ReactElement {
  const { navigate, onAuthError } = useServerConsole();
  const [props, setProps] = useState<PropDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setProps(null);
    setError(null);
    listPropDefinitions()
      .then(setProps)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load props.');
      });
  }, [onAuthError]);

  if (props === null && !error) {
    return <AdminMessage message="Loading prop catalog..." status />;
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Prop definitions" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const normalized = normalizeSearchQuery(query);
  const filtered = normalized
    ? (props ?? []).filter(
        (prop) =>
          prop.name.toLowerCase().includes(normalized) ||
          prop.prefabId.toLowerCase().includes(normalized) ||
          prop.category.toLowerCase().includes(normalized),
      )
    : (props ?? []);

  return (
    <>
      <AdminPageHeader
        title="Prop definitions"
        subtitle={`${props?.length ?? 0} definition${props?.length === 1 ? '' : 's'}`}
      />
      <AdminToolbar>
        <AdminSearch placeholder="Search props…" value={query} onChange={setQuery} />
        <AdminButton type="button" onClick={() => navigate({ scene: 'prop-form', propId: null })}>
          Create prop definition
        </AdminButton>
      </AdminToolbar>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          <table className="sc-admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefab</th>
                <th>Category</th>
                <th>Cost (ARC)</th>
                <th>Max / space</th>
                <th>Grid</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="is-static">
                  <td colSpan={6} className="sc-admin-empty">
                    No prop definitions match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((prop) => (
                  <tr key={prop.id} onClick={() => navigate({ scene: 'prop-form', propId: prop.id })}>
                    <td>{prop.name}</td>
                    <TruncatedCell text={prop.prefabId} maxLen={24} mono />
                    <td>{prop.category}</td>
                    <td>{prop.costArc.toLocaleString()}</td>
                    <td>{prop.maxPerHangar !== null ? String(prop.maxPerHangar) : '—'}</td>
                    <td>{prop.snapGridM !== null ? String(prop.snapGridM) : 'free'}</td>
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

export function PropFormPanel({ propId }: { propId: string | null }): ReactElement {
  const { navigate, setStatus } = useServerConsole();
  const [existing, setExisting] = useState<PropDefinition | null | undefined>(undefined);
  const [prefabs, setPrefabs] = useState<Awaited<ReturnType<typeof ensurePropPrefabs>>>([]);

  useEffect(() => {
    void ensurePropPrefabs().then(setPrefabs);
    if (!propId) {
      setExisting(null);
      return;
    }
    listPropDefinitions()
      .then((props) => setExisting(props.find((entry) => entry.id === propId) ?? null))
      .catch(() => setExisting(null));
  }, [propId]);

  if (existing === undefined) {
    return <AdminMessage message="Loading..." status />;
  }

  const defaults = existing
    ? {
        name: existing.name,
        description: existing.description,
        prefabId: existing.prefabId,
        costArc: existing.costArc,
        category: existing.category,
        maxPerHangar: existing.maxPerHangar,
        allowRotateY: existing.allowRotateY,
        snapGridM: existing.snapGridM,
      }
    : { ...DEFAULT_PROP_FORM, prefabId: prefabs[0]?.id ?? DEFAULT_PROP_FORM.prefabId };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setStatus('Saving prop definition...');
    const payload = readPropForm(event.currentTarget);
    const request = existing
      ? updatePropDefinition(existing.id, payload)
      : createPropDefinition(payload);
    request
      .then(() => navigate({ scene: 'props' }))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Save failed.', true);
      });
  };

  return (
    <>
      <AdminPageHeader
        title={existing ? 'Edit prop definition' : 'Create prop definition'}
        subtitle={existing?.name}
        actions={
          <AdminButton variant="secondary" type="button" onClick={() => navigate({ scene: 'props' })}>
            Back to props
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
          <AdminField label="Prop prefab">
            <select className="sc-admin-select" name="prefabId" defaultValue={defaults.prefabId}>
              {prefabs.map((prefab) => (
                <option key={prefab.id} value={prefab.id}>
                  {prefab.label} ({prefab.id})
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Category">
            <input
              className="sc-admin-input"
              name="category"
              type="text"
              defaultValue={defaults.category}
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
          <AdminField label="Max per space">
            <input
              className="sc-admin-input"
              name="maxPerHangar"
              type="number"
              defaultValue={defaults.maxPerHangar ?? 0}
            />
          </AdminField>
          <AdminField label="Snap grid (m, 0 = free)">
            <input
              className="sc-admin-input"
              name="snapGridM"
              type="number"
              step="0.1"
              defaultValue={defaults.snapGridM ?? 0}
            />
          </AdminField>
          <AdminField label="Allow Y rotation">
            <select
              className="sc-admin-select"
              name="allowRotateY"
              defaultValue={defaults.allowRotateY ? 'true' : 'false'}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
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
