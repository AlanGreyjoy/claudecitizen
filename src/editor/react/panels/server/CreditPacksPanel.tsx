import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { CreditPack } from '../../../../net/admin-api';
import {
  AdminAuthError,
  createCreditPack,
  deleteCreditPack,
  listCreditPacks,
  updateCreditPack,
} from './server-console-api';
import { readCreditPackForm } from './form-readers';
import { DEFAULT_CREDIT_PACK_FORM } from './defaults';
import { useServerConsole } from './ServerConsoleContext';
import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminMessage,
  AdminPageHeader,
  AdminToolbar,
} from './Components';
import { formatCredits, formatMoney } from './utils';

/** Value per dollar, so an operator can see the ladder stays monotonic as they edit it. */
function creditsPerDollar(pack: CreditPack): string {
  if (pack.priceCents <= 0) return '—';
  return (pack.totalCredits / (pack.priceCents / 100)).toFixed(0);
}

function bonusPercent(pack: CreditPack): string {
  if (pack.credits <= 0) return '—';
  return `${Math.round((pack.bonusCredits / pack.credits) * 100)}%`;
}

export function CreditPacksPanel(): ReactElement {
  const { navigate, onAuthError, setStatus } = useServerConsole();
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setPacks(null);
    setError(null);
    listCreditPacks()
      .then(setPacks)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load credit packs.');
      });
  }, [onAuthError, reloadKey]);

  if (packs === null && !error) return <AdminMessage message="Loading credit packs..." status />;

  if (error) {
    return (
      <>
        <AdminPageHeader title="Credit packs" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const handleDelete = (pack: CreditPack): void => {
    setStatus(`Removing ${pack.name}...`);
    deleteCreditPack(pack.id)
      .then(() => {
        // Packs with purchase history are deactivated rather than deleted, so reload either way.
        setStatus(`${pack.name} removed.`);
        setReloadKey((key) => key + 1);
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Remove failed.', true));
  };

  return (
    <>
      <AdminPageHeader
        title="Credit packs"
        subtitle="Real-money bundles of AsteronCredits, sold through Stripe Checkout."
      />
      <AdminToolbar>
        <AdminButton
          type="button"
          onClick={() => navigate({ scene: 'credit-pack-form', packId: null })}
        >
          Create credit pack
        </AdminButton>
      </AdminToolbar>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          <table className="sc-admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Credits</th>
                <th>Bonus</th>
                <th>AC / $</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {(packs ?? []).length === 0 ? (
                <tr className="is-static">
                  <td colSpan={7} className="sc-admin-empty">
                    No credit packs yet.
                  </td>
                </tr>
              ) : (
                (packs ?? []).map((pack) => (
                  <tr
                    key={pack.id}
                    onClick={() => navigate({ scene: 'credit-pack-form', packId: pack.id })}
                  >
                    <td>{pack.name}</td>
                    <td>{formatMoney(pack.priceCents, pack.currency)}</td>
                    <td>{formatCredits(pack.totalCredits)}</td>
                    <td>{bonusPercent(pack)}</td>
                    <td>{creditsPerDollar(pack)}</td>
                    <td>{pack.active ? 'Active' : 'Hidden'}</td>
                    <td>
                      <AdminButton
                        variant="secondary"
                        small
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDelete(pack);
                        }}
                      >
                        Remove
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

export function CreditPackFormPanel({ packId }: { packId: string | null }): ReactElement {
  const { navigate, setStatus } = useServerConsole();
  const [existing, setExisting] = useState<CreditPack | null | undefined>(undefined);

  useEffect(() => {
    if (!packId) {
      setExisting(null);
      return;
    }
    listCreditPacks()
      .then((packs) => setExisting(packs.find((pack) => pack.id === packId) ?? null))
      .catch(() => setExisting(null));
  }, [packId]);

  if (existing === undefined) return <AdminMessage message="Loading..." status />;

  const defaults = existing ?? DEFAULT_CREDIT_PACK_FORM;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setStatus('Saving credit pack...');
    const payload = readCreditPackForm(event.currentTarget);
    const request = existing
      ? updateCreditPack(existing.id, payload)
      : createCreditPack(payload);
    request
      .then(() => navigate({ scene: 'credit-packs' }))
      .catch((error) => setStatus(error instanceof Error ? error.message : 'Save failed.', true));
  };

  return (
    <>
      <AdminPageHeader
        title={existing ? 'Edit credit pack' : 'Create credit pack'}
        subtitle={existing?.name}
        actions={
          <AdminButton
            variant="secondary"
            type="button"
            onClick={() => navigate({ scene: 'credit-packs' })}
          >
            Back to packs
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
          <AdminField label="Price (cents)">
            <input
              className="sc-admin-input"
              name="priceCents"
              type="number"
              min="1"
              defaultValue={defaults.priceCents}
            />
          </AdminField>
          <AdminField label="Currency (ISO code)">
            <input
              className="sc-admin-input"
              name="currency"
              type="text"
              defaultValue={defaults.currency}
            />
          </AdminField>
          <AdminField label="Base credits">
            <input
              className="sc-admin-input"
              name="credits"
              type="number"
              min="1"
              defaultValue={defaults.credits}
            />
          </AdminField>
          <AdminField label="Bonus credits">
            <input
              className="sc-admin-input"
              name="bonusCredits"
              type="number"
              min="0"
              defaultValue={defaults.bonusCredits}
            />
          </AdminField>
          <AdminField label="Stripe price ID (blank creates an inline price)">
            <input
              className="sc-admin-input"
              name="stripePriceId"
              type="text"
              defaultValue={defaults.stripePriceId ?? ''}
              placeholder="price_…"
            />
          </AdminField>
          <AdminField label="Icon URL">
            <input
              className="sc-admin-input"
              name="iconUrl"
              type="text"
              defaultValue={defaults.iconUrl ?? ''}
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
          <AdminField label="Visible in the mall">
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
            <AdminButton type="submit">{existing ? 'Save changes' : 'Create pack'}</AdminButton>
          </div>
          <AdminMessage message="" status />
        </form>
      </AdminCard>
    </>
  );
}
