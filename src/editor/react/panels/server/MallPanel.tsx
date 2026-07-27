import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { AdminMallListing, ItemDefinition } from '../../../../net/admin-api';
import {
  AdminAuthError,
  createMallListing,
  deleteMallListing,
  listAdminMallListings,
  listItemDefinitions,
  updateMallListing,
} from './server-console-api';
import { readMallListingForm } from './form-readers';
import { DEFAULT_MALL_LISTING_FORM, MALL_SELLABLE_ITEM_TYPES } from './defaults';
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
import { formatCredits, normalizeSearchQuery } from './utils';

export function MallPanel(): ReactElement {
  const { navigate, onAuthError, setStatus } = useServerConsole();
  const [listings, setListings] = useState<AdminMallListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setListings(null);
    setError(null);
    listAdminMallListings()
      .then(setListings)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load the Item Mall.');
      });
  }, [onAuthError, reloadKey]);

  if (listings === null && !error) return <AdminMessage message="Loading Item Mall..." status />;

  if (error) {
    return (
      <>
        <AdminPageHeader title="Item Mall" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const normalized = normalizeSearchQuery(query);
  const filtered = normalized
    ? (listings ?? []).filter(
        (listing) =>
          listing.itemName.toLowerCase().includes(normalized) ||
          listing.itemDefinitionId.toLowerCase().includes(normalized) ||
          listing.category.toLowerCase().includes(normalized),
      )
    : (listings ?? []);

  const handleDelist = (listing: AdminMallListing): void => {
    setStatus(`Delisting ${listing.itemName}...`);
    deleteMallListing(listing.id)
      .then(() => {
        setStatus(`${listing.itemName} delisted. The item definition itself is unchanged.`);
        setReloadKey((key) => key + 1);
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Delist failed.', true));
  };

  return (
    <>
      <AdminPageHeader
        title="Item Mall"
        subtitle={`${listings?.length ?? 0} listing${listings?.length === 1 ? '' : 's'} priced in AsteronCredits`}
      />
      <AdminToolbar>
        <AdminSearch placeholder="Search listings…" value={query} onChange={setQuery} />
        <AdminButton
          type="button"
          onClick={() => navigate({ scene: 'mall-form', listingId: null })}
        >
          List an item
        </AdminButton>
      </AdminToolbar>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          <table className="sc-admin-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Price (AC)</th>
                <th>ARC price</th>
                <th>Hold limit</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="is-static">
                  <td colSpan={7} className="sc-admin-empty">
                    No listings match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((listing) => (
                  <tr
                    key={listing.id}
                    onClick={() => navigate({ scene: 'mall-form', listingId: listing.id })}
                  >
                    <td>
                      {listing.itemName}
                      {listing.featured ? ' ★' : ''}
                    </td>
                    <td>{listing.itemType}</td>
                    <td>{formatCredits(listing.priceCredits)}</td>
                    <td>{listing.costArc.toLocaleString()}</td>
                    <td>{listing.limitPerPlayer !== null ? String(listing.limitPerPlayer) : '—'}</td>
                    <td>{listing.active ? 'Live' : 'Hidden'}</td>
                    <td>
                      <AdminButton
                        variant="secondary"
                        small
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDelist(listing);
                        }}
                      >
                        Delist
                      </AdminButton>
                    </td>
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

export function MallListingFormPanel({ listingId }: { listingId: string | null }): ReactElement {
  const { navigate, setStatus } = useServerConsole();
  const [existing, setExisting] = useState<AdminMallListing | null | undefined>(undefined);
  const [items, setItems] = useState<ItemDefinition[]>([]);

  useEffect(() => {
    // Only item types the mall is allowed to sell are offered, so a listing cannot be created
    // that the purchase endpoint would then reject.
    void listItemDefinitions()
      .then((all) => all.filter((item) => MALL_SELLABLE_ITEM_TYPES.includes(item.itemType)))
      .then(setItems)
      .catch(() => setItems([]));
    if (!listingId) {
      setExisting(null);
      return;
    }
    listAdminMallListings()
      .then((listings) => setExisting(listings.find((entry) => entry.id === listingId) ?? null))
      .catch(() => setExisting(null));
  }, [listingId]);

  if (existing === undefined) return <AdminMessage message="Loading..." status />;

  const defaults = existing
    ? {
        itemDefinitionId: existing.itemDefinitionId,
        priceCredits: existing.priceCredits,
        category: existing.category,
        sortOrder: existing.sortOrder,
        featured: existing.featured,
        active: existing.active,
        limitPerPlayer: existing.limitPerPlayer,
      }
    : {
        ...DEFAULT_MALL_LISTING_FORM,
        itemDefinitionId: items[0]?.id ?? '',
      };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setStatus('Saving mall listing...');
    const payload = readMallListingForm(event.currentTarget);
    const request = existing
      ? updateMallListing(existing.id, payload)
      : createMallListing(payload);
    request
      .then(() => navigate({ scene: 'mall' }))
      .catch((error) => setStatus(error instanceof Error ? error.message : 'Save failed.', true));
  };

  return (
    <>
      <AdminPageHeader
        title={existing ? 'Edit mall listing' : 'List an item'}
        subtitle={existing?.itemName}
        actions={
          <AdminButton variant="secondary" type="button" onClick={() => navigate({ scene: 'mall' })}>
            Back to mall
          </AdminButton>
        }
      />
      <AdminCard>
        <form className="sc-admin-form sc-admin-form-wide" onSubmit={handleSubmit}>
          <AdminField label="Item">
            {existing ? (
              <input
                className="sc-admin-input sc-admin-cell-mono"
                readOnly
                value={existing.itemDefinitionId}
              />
            ) : (
              <select
                className="sc-admin-select"
                name="itemDefinitionId"
                defaultValue={defaults.itemDefinitionId}
              >
                {items.length === 0 ? (
                  <option value="">No sellable items in the catalog yet</option>
                ) : (
                  items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.itemType})
                    </option>
                  ))
                )}
              </select>
            )}
          </AdminField>
          <AdminField label="Price (AsteronCredits)">
            <input
              className="sc-admin-input"
              name="priceCredits"
              type="number"
              min="0"
              defaultValue={defaults.priceCredits}
            />
          </AdminField>
          <AdminField label="Category">
            <input
              className="sc-admin-input"
              name="category"
              type="text"
              defaultValue={defaults.category}
            />
          </AdminField>
          <AdminField label="Hold limit per player (0 = unlimited)">
            <input
              className="sc-admin-input"
              name="limitPerPlayer"
              type="number"
              min="0"
              defaultValue={defaults.limitPerPlayer ?? 0}
            />
          </AdminField>
          <AdminField label="Sort order">
            <input
              className="sc-admin-input"
              name="sortOrder"
              type="number"
              defaultValue={defaults.sortOrder}
            />
          </AdminField>
          <AdminField label="Featured">
            <select
              className="sc-admin-select"
              name="featured"
              defaultValue={defaults.featured ? 'true' : 'false'}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </AdminField>
          <AdminField label="Live in the mall">
            <select
              className="sc-admin-select"
              name="active"
              defaultValue={defaults.active ? 'true' : 'false'}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </AdminField>
          <div className="sc-admin-actions">
            <AdminButton type="submit">{existing ? 'Save changes' : 'Create listing'}</AdminButton>
          </div>
          <p className="sc-admin-hint">
            Listing an item does not change its ARC price or remove it from station shops.
          </p>
          <AdminMessage message="" status />
        </form>
      </AdminCard>
    </>
  );
}
