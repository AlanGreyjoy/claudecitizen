import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AdminSession } from '../../../../net/admin-api';
import { getAdminSession, resetPrefabCaches } from './server-console-api';
import { ServerConsoleProvider } from './ServerConsoleContext';
import { LoginPanel, ServerLayout } from './Layout';
import { AdminMessage } from './Components';
import { UsersPanel, UserDetailPanel } from './UsersPanel';
import { ShipsPanel, ShipFormPanel } from './ShipsPanel';
import { PropsPanel, PropFormPanel } from './PropsPanel';
import { ItemsPanel, ItemFormPanel } from './ItemsPanel';
import { WeaponsPanel, WeaponFormPanel } from './WeaponsPanel';
import { BackpacksPanel, BackpackFormPanel } from './BackpacksPanel';
import { WearablesPanel, WearableFormPanel } from './WearablesPanel';
import { SettingsPanel } from './SettingsPanel';
import { PaymentsPanel } from './PaymentsPanel';
import { CreditPacksPanel, CreditPackFormPanel } from './CreditPacksPanel';
import { MallPanel, MallListingFormPanel } from './MallPanel';
import { PurchasesPanel } from './PurchasesPanel';
import type { ServerRoute } from './types';
import { routeScene, routeTab } from './types';

type ServerConsolePanelProps = {
  active: boolean;
};

/** Commerce routes, split out so the main switch stays under the complexity ceiling. */
function CommerceRoute({ route }: { route: ServerRoute }): ReactElement | null {
  switch (route.scene) {
    case 'payments':
      return <PaymentsPanel />;
    case 'credit-packs':
      return <CreditPacksPanel />;
    case 'credit-pack-form':
      return <CreditPackFormPanel packId={route.packId} />;
    case 'mall':
      return <MallPanel />;
    case 'mall-form':
      return <MallListingFormPanel listingId={route.listingId} />;
    case 'purchases':
      return <PurchasesPanel />;
    default:
      return null;
  }
}

function RouteContent({ route }: { route: ServerRoute }): ReactElement {
  const commerce = CommerceRoute({ route });
  if (commerce) return commerce;
  switch (route.scene) {
    case 'users':
      return <UsersPanel />;
    case 'user-detail':
      return <UserDetailPanel userId={route.userId} />;
    case 'ships':
      return <ShipsPanel />;
    case 'ship-form':
      return <ShipFormPanel shipId={route.shipId} />;
    case 'props':
      return <PropsPanel />;
    case 'prop-form':
      return <PropFormPanel propId={route.propId} />;
    case 'items':
      return <ItemsPanel />;
    case 'item-form':
      return <ItemFormPanel itemId={route.itemId} />;
    case 'weapons':
      return <WeaponsPanel />;
    case 'weapon-form':
      return <WeaponFormPanel weaponId={route.weaponId} />;
    case 'backpacks':
      return <BackpacksPanel />;
    case 'backpack-form':
      return <BackpackFormPanel backpackId={route.backpackId} />;
    case 'wearables':
      return <WearablesPanel />;
    case 'wearable-form':
      return <WearableFormPanel wearableId={route.wearableId} />;
    case 'settings':
      return <SettingsPanel />;
    default:
      return <LoginPanel />;
  }
}

export function ServerConsolePanel({ active }: ServerConsolePanelProps): ReactElement | null {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [route, setRoute] = useState<ServerRoute>({ scene: 'login' });
  const [status, setStatusState] = useState({ message: '', isError: false });
  const [booting, setBooting] = useState(true);

  const setStatus = useCallback((message: string, isError = false): void => {
    setStatusState({ message, isError });
  }, []);

  const onAuthError = useCallback((message: string): void => {
    setSession(null);
    setRoute({ scene: 'login' });
    setStatus(message, true);
  }, [setStatus]);

  const navigate = useCallback((nextRoute: ServerRoute): void => {
    setRoute(nextRoute);
    setStatusState({ message: '', isError: false });
  }, []);

  useEffect(() => {
    if (!active) {
      setBooting(true);
      setSession(null);
      setRoute({ scene: 'login' });
      setStatusState({ message: '', isError: false });
      resetPrefabCaches();
      return;
    }

    setBooting(true);
    getAdminSession()
      .then((existing) => {
        if (!active) return;
        if (existing) {
          setSession(existing);
          setRoute({ scene: 'users' });
        } else {
          setSession(null);
          setRoute({ scene: 'login' });
        }
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setRoute({ scene: 'login' });
      })
      .finally(() => {
        if (active) setBooting(false);
      });
  }, [active]);

  const contextValue = useMemo(
    () => ({
      session,
      setSession,
      route,
      navigate,
      currentTab: routeTab(route),
      currentScene: routeScene(route),
      status,
      setStatus,
      onAuthError,
    }),
    [session, route, navigate, status, setStatus, onAuthError],
  );

  if (!active) return null;

  return (
    <div className="sc-admin-screen ed-server-console ed-scene-panel ed-server-console-host">
      <ServerConsoleProvider value={contextValue}>
        {booting ? (
          <div className="sc-admin-login-wrap">
            <div className="sc-admin-login">
              <AdminMessage message="Checking admin session..." status />
            </div>
          </div>
        ) : route.scene === 'login' || !session ? (
          <LoginPanel />
        ) : (
          <ServerLayout>
            <RouteContent route={route} />
            {status.message ? (
              <AdminMessage message={status.message} isError={status.isError} status />
            ) : null}
          </ServerLayout>
        )}
      </ServerConsoleProvider>
    </div>
  );
}
