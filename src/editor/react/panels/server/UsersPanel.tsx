import { useEffect, useState, type ReactElement } from 'react';
import type { AdminUserDetail, AdminUserSummary, ShipDefinition } from '../../../../net/admin-api';
import {
  AdminAuthError,
  assignShipToUser,
  getAdminUser,
  listAdminUsers,
  listShipDefinitions,
} from './server-console-api';
import { useServerConsole } from './ServerConsoleContext';
import {
  AdminButton,
  AdminCard,
  AdminMessage,
  AdminPageHeader,
  AdminSearch,
  AdminToolbar,
  DetailItem,
  TruncatedCell,
} from './Components';
import {
  assignShipHelpText,
  filterAvailableShipDefinitions,
  UserOwnedShipsTable,
  UserPlayerDetails,
} from './UserDetailSections';
import { formatArc, formatDate, normalizeSearchQuery } from './utils';

export function UsersPanel(): ReactElement {
  const { navigate, onAuthError } = useServerConsole();
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setUsers(null);
    setError(null);
    listAdminUsers()
      .then(setUsers)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load users.');
      });
  }, [onAuthError]);

  if (users === null && !error) {
    return <AdminMessage message="Loading users..." status />;
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Users" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const normalized = normalizeSearchQuery(query);
  const filtered = normalized
    ? (users ?? []).filter(
        (user) =>
          user.username.toLowerCase().includes(normalized) ||
          user.displayName.toLowerCase().includes(normalized) ||
          (user.email?.toLowerCase().includes(normalized) ?? false),
      )
    : (users ?? []);

  return (
    <>
      <AdminPageHeader
        title="Users"
        subtitle={`${users?.length ?? 0} account${users?.length === 1 ? '' : 's'}`}
      />
      <AdminToolbar>
        <AdminSearch placeholder="Search users…" value={query} onChange={setQuery} />
      </AdminToolbar>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          <table className="sc-admin-table">
            <thead>
              <tr>
                <th>Handle</th>
                <th>Email</th>
                <th>Display name</th>
                <th>ARC balance</th>
                <th>Ships</th>
                <th>Starter grant</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="is-static">
                  <td colSpan={6} className="sc-admin-empty">
                    No users match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <tr key={user.id} onClick={() => navigate({ scene: 'user-detail', userId: user.id })}>
                    <TruncatedCell text={user.username} maxLen={28} mono />
                    <TruncatedCell text={user.email ?? '—'} maxLen={32} />
                    <TruncatedCell text={user.displayName} maxLen={24} />
                    <td>{user.player ? formatArc(user.player.arcBalance) : '—'}</td>
                    <td>{String(user.player?.shipCount ?? 0)}</td>
                    <td>{formatDate(user.player?.starterLoadoutGrantedAt ?? null)}</td>
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

type UserAssignShipCardProps = {
  user: AdminUserDetail;
  shipDefinitions: ShipDefinition[];
  onAuthError: (message: string) => void;
  onAssigned: () => void;
  onAssignError: (message: string) => void;
};

function UserAssignShipCard({
  user,
  shipDefinitions,
  onAuthError,
  onAssigned,
  onAssignError,
}: UserAssignShipCardProps): ReactElement {
  const [selectedShipId, setSelectedShipId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const available = filterAvailableShipDefinitions(user, shipDefinitions);

  const handleAssign = (): void => {
    if (!selectedShipId) return;
    setAssigning(true);
    void assignShipToUser(user.id, { shipDefinitionId: selectedShipId })
      .then(() => onAssigned())
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        onAssignError(err instanceof Error ? err.message : 'Failed to assign ship.');
      })
      .finally(() => {
        setAssigning(false);
      });
  };

  if (!user.player) {
    return (
      <AdminCard>
        <p className="sc-admin-meta">
          This account has no player record yet. Bootstrap in-game before assigning ships.
        </p>
      </AdminCard>
    );
  }

  return (
    <AdminCard>
      <p className="sc-admin-meta">
        {assignShipHelpText(available.length, shipDefinitions.length)}
      </p>
      <div className="sc-admin-actions">
        <select
          className="sc-admin-select"
          name="assign-ship"
          value={selectedShipId || available[0]?.id || ''}
          onChange={(event) => setSelectedShipId(event.currentTarget.value)}
        >
          {available.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.name} ({definition.prefabId})
            </option>
          ))}
        </select>
        <AdminButton
          type="button"
          disabled={available.length === 0 || assigning}
          onClick={handleAssign}
        >
          Assign ship
        </AdminButton>
      </div>
    </AdminCard>
  );
}

export function UserDetailPanel({ userId }: { userId: string }): ReactElement {
  const { navigate, onAuthError } = useServerConsole();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [shipDefinitions, setShipDefinitions] = useState<ShipDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState('');
  const [assignError, setAssignError] = useState(false);

  const load = (): void => {
    setUser(null);
    setError(null);
    Promise.all([getAdminUser(userId), listShipDefinitions()])
      .then(([nextUser, definitions]) => {
        setUser(nextUser);
        setShipDefinitions(definitions);
      })
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load user.');
      });
  };

  useEffect(() => {
    load();
  }, [userId]);

  if (!user && !error) {
    return <AdminMessage message="Loading user..." status />;
  }

  if (error || !user) {
    return (
      <>
        <AdminPageHeader title="User detail" />
        <AdminMessage message={error ?? 'Failed to load user.'} isError status />
      </>
    );
  }

  return (
    <>
      <AdminPageHeader
        title={user.displayName}
        subtitle={user.email ?? undefined}
        actions={
          <AdminButton
            variant="secondary"
            type="button"
            onClick={() => navigate({ scene: 'users' })}
          >
            Back to users
          </AdminButton>
        }
      />
      <AdminCard>
        <dl className="sc-admin-detail-grid">
          <DetailItem label="Username" value={user.username} truncate />
          <DetailItem label="Email" value={user.email ?? '—'} />
          <DetailItem label="User ID" value={user.id} truncate />
          <DetailItem label="Created" value={formatDate(user.createdAt)} />
          <UserPlayerDetails user={user} />
        </dl>
      </AdminCard>
      <UserOwnedShipsTable user={user} />
      <UserAssignShipCard
        user={user}
        shipDefinitions={shipDefinitions}
        onAuthError={onAuthError}
        onAssigned={load}
        onAssignError={(message) => {
          setAssignMessage(message);
          setAssignError(true);
        }}
      />
      {assignMessage ? <AdminMessage message={assignMessage} isError={assignError} /> : null}
    </>
  );
}
