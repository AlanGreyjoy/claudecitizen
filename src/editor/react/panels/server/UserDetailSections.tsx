import type { ReactElement } from 'react';
import type { AdminUserDetail, ShipDefinition } from '../../../../net/admin-api';
import { AdminCard, DetailItem, TruncatedCell } from './Components';
import { formatArc, formatDate } from './utils';

export function UserPlayerDetails({ user }: { user: AdminUserDetail }): ReactElement | null {
  if (!user.player) return null;

  return (
    <>
      <DetailItem label="Player handle" value={user.player.handle} truncate />
      <DetailItem
        label="Asteron Reserve Credits (ARC)"
        value={formatArc(user.player.arcBalance)}
      />
      <DetailItem
        label="Starter grant"
        value={formatDate(user.player.starterLoadoutGrantedAt)}
      />
      <DetailItem
        label="Current instance"
        value={user.player.currentInstanceId ?? '—'}
        truncate
      />
      <DetailItem label="Current room" value={user.player.currentRoomId ?? '—'} truncate />
    </>
  );
}

export function UserOwnedShipsTable({ user }: { user: AdminUserDetail }): ReactElement {
  return (
    <>
      <h3 className="sc-admin-section-title">Owned ships</h3>
      <AdminCard>
        <div className="sc-admin-table-wrap">
          {!user.player || user.player.ships.length === 0 ? (
            <p className="sc-admin-empty">No owned ships.</p>
          ) : (
            <table className="sc-admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefab</th>
                  <th>Definition</th>
                  <th>HP</th>
                  <th>Shields</th>
                </tr>
              </thead>
              <tbody>
                {user.player.ships.map((ship) => (
                  <tr key={ship.id} className="is-static">
                    <td>{ship.displayName}</td>
                    <TruncatedCell text={ship.prefabId} maxLen={24} mono />
                    <td>{ship.shipDefinition?.name ?? '—'}</td>
                    <td>
                      {ship.hp.toFixed(0)} / {ship.maxHp.toFixed(0)}
                    </td>
                    <td>
                      {ship.shields.toFixed(0)} / {ship.maxShields.toFixed(0)}
                    </td>
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

export function filterAvailableShipDefinitions(
  user: AdminUserDetail,
  shipDefinitions: ShipDefinition[],
): ShipDefinition[] {
  const ownedDefinitionIds = new Set(
    user.player?.ships
      .map((ship) => ship.shipDefinitionId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0) ?? [],
  );
  const ownedPrefabIds = new Set(user.player?.ships.map((ship) => ship.prefabId) ?? []);
  return shipDefinitions.filter(
    (definition) =>
      !ownedDefinitionIds.has(definition.id) && !ownedPrefabIds.has(definition.prefabId),
  );
}

export function assignShipHelpText(
  availableCount: number,
  catalogCount: number,
): string {
  if (availableCount === 0) {
    return catalogCount === 0
      ? 'No ship definitions in the catalog. Create one under Ships first.'
      : 'Player already owns every catalog ship definition (or matching prefab).';
  }
  return 'Assign a catalog ship definition the player does not already own. The ship is parked in their hangar.';
}
