import { useEffect, useState, type ReactElement } from 'react';
import type { AdminCreditPurchase } from '../../../../net/admin-api';
import { AdminAuthError, listAdminCreditPurchases } from './server-console-api';
import { useServerConsole } from './ServerConsoleContext';
import {
  AdminCard,
  AdminMessage,
  AdminPageHeader,
  AdminToolbar,
  TruncatedCell,
} from './Components';
import { formatCredits, formatDate, formatMoney } from './utils';

const STATUS_FILTERS = ['all', 'pending', 'paid', 'failed', 'refunded', 'disputed'] as const;

export function PurchasesPanel(): ReactElement {
  const { onAuthError } = useServerConsole();
  const [purchases, setPurchases] = useState<AdminCreditPurchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');

  useEffect(() => {
    setPurchases(null);
    setError(null);
    listAdminCreditPurchases(status === 'all' ? undefined : status)
      .then(setPurchases)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load purchases.');
      });
  }, [onAuthError, status]);

  if (error) {
    return (
      <>
        <AdminPageHeader title="Purchases" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const paidTotal = (purchases ?? [])
    .filter((purchase) => purchase.status === 'paid')
    .reduce((sum, purchase) => sum + purchase.priceCents, 0);

  return (
    <>
      <AdminPageHeader
        title="Purchases"
        subtitle={
          purchases
            ? `${purchases.length} record${purchases.length === 1 ? '' : 's'} · ${formatMoney(paidTotal, 'usd')} paid`
            : undefined
        }
      />
      <AdminToolbar>
        <select
          className="sc-admin-select"
          value={status}
          onChange={(event) =>
            setStatusFilter(event.currentTarget.value as (typeof STATUS_FILTERS)[number])
          }
        >
          {STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {value === 'all' ? 'All statuses' : value}
            </option>
          ))}
        </select>
      </AdminToolbar>
      {purchases === null ? (
        <AdminMessage message="Loading purchases..." status />
      ) : (
        <AdminCard>
          <div className="sc-admin-table-wrap">
            <table className="sc-admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Player</th>
                  <th>Pack</th>
                  <th>Paid</th>
                  <th>Credits</th>
                  <th>Status</th>
                  <th>Stripe session</th>
                </tr>
              </thead>
              <tbody>
                {purchases.length === 0 ? (
                  <tr className="is-static">
                    <td colSpan={7} className="sc-admin-empty">
                      No purchases recorded.
                    </td>
                  </tr>
                ) : (
                  purchases.map((purchase) => (
                    <tr key={purchase.id} className="is-static">
                      <td>{formatDate(purchase.createdAt)}</td>
                      <td>{purchase.playerHandle ?? purchase.playerId}</td>
                      <td>{purchase.packName ?? purchase.packId}</td>
                      <td>{formatMoney(purchase.priceCents, purchase.currency)}</td>
                      <td>{formatCredits(purchase.creditsGranted)}</td>
                      <td>{purchase.status}</td>
                      <TruncatedCell text={purchase.providerSessionId ?? '—'} maxLen={20} mono />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}
      <AdminMessage message="" />
    </>
  );
}
