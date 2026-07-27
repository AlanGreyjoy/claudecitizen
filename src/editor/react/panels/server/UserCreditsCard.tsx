import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { AdminUserDetail, PlayerCreditLedger } from '../../../../net/admin-api';
import { AdminAuthError, getPlayerCreditLedger, grantPlayerCredits } from './server-console-api';
import { AdminButton, AdminCard, AdminField, AdminMessage } from './Components';
import { formatCredits, formatDate } from './utils';

/**
 * AsteronCredit balance, hand-grant form, and audit trail for one player.
 *
 * Every entry here came through `apply_credit_delta` on the server, so this table is the
 * complete history of a balance — including refunds and chargebacks the operator did not make.
 */
export function UserCreditsCard({
  user,
  onAuthError,
}: {
  user: AdminUserDetail;
  onAuthError: (message: string) => void;
}): ReactElement | null {
  const playerId = user.player?.id ?? null;
  const [ledger, setLedger] = useState<PlayerCreditLedger | null>(null);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!playerId) return;
    getPlayerCreditLedger(playerId)
      .then(setLedger)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setMessage(err instanceof Error ? err.message : 'Failed to load credit ledger.');
        setIsError(true);
      });
  }, [playerId, onAuthError]);

  useEffect(() => {
    setLedger(null);
    setMessage('');
    setIsError(false);
    load();
  }, [load]);

  if (!playerId) return null;

  const handleGrant = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const delta = Math.round(Number(form.get('delta') ?? 0));
    if (!Number.isFinite(delta) || delta === 0) {
      setMessage('Enter a non-zero amount. Negative values claw credits back.');
      setIsError(true);
      return;
    }
    setBusy(true);
    setMessage('Applying credit adjustment...');
    setIsError(false);
    grantPlayerCredits(playerId, {
      delta,
      reason: String(form.get('reason') ?? '').trim() || undefined,
      reasonCode: String(form.get('reasonCode') ?? 'grant') === 'award' ? 'award' : 'grant',
    })
      .then((result) => {
        setMessage(`Balance is now ${formatCredits(result.creditBalance)}.`);
        setIsError(false);
        load();
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : 'Credit adjustment failed.');
        setIsError(true);
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <h3 className="sc-admin-section-title">AsteronCredits</h3>
      <AdminCard>
        <p className="sc-admin-meta">
          Balance: <strong>{formatCredits(ledger?.creditBalance)}</strong>
        </p>
        <form className="sc-admin-form sc-admin-form-wide" onSubmit={handleGrant}>
          <AdminField label="Amount (negative claws back)">
            <input className="sc-admin-input" name="delta" type="number" defaultValue={0} />
          </AdminField>
          <AdminField label="Classification">
            <select className="sc-admin-select" name="reasonCode" defaultValue="grant">
              <option value="grant">Grant — support or compensation</option>
              <option value="award">Award — promotion or in-game prize</option>
            </select>
          </AdminField>
          <AdminField label="Note (recorded in the ledger)">
            <input
              className="sc-admin-input"
              name="reason"
              type="text"
              placeholder="e.g. support ticket 1284"
            />
          </AdminField>
          <div className="sc-admin-actions">
            <AdminButton type="submit" disabled={busy}>
              Apply adjustment
            </AdminButton>
          </div>
        </form>
        {message ? <AdminMessage message={message} isError={isError} /> : null}
      </AdminCard>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          {!ledger || ledger.entries.length === 0 ? (
            <p className="sc-admin-empty">No credit activity yet.</p>
          ) : (
            <table className="sc-admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Reason</th>
                  <th>Change</th>
                  <th>Balance after</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {ledger.entries.map((entry) => (
                  <tr key={entry.id} className="is-static">
                    <td>{formatDate(entry.createdAt)}</td>
                    <td>{entry.reason}</td>
                    <td>{entry.delta > 0 ? `+${entry.delta}` : String(entry.delta)}</td>
                    <td>{formatCredits(entry.balanceAfter)}</td>
                    <td>{entry.refId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </AdminCard>
    </>
  );
}
