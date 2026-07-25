import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { AdminSession } from '../../../../net/admin-api';
import type { AdminScene, AdminTab, ServerConsoleStatus, ServerRoute } from './types';

export type ServerConsoleContextValue = {
  session: AdminSession | null;
  setSession: (session: AdminSession | null) => void;
  route: ServerRoute;
  navigate: (route: ServerRoute) => void;
  currentTab: AdminTab;
  currentScene: AdminScene;
  status: ServerConsoleStatus;
  setStatus: (message: string, isError?: boolean) => void;
  onAuthError: (message: string) => void;
};

const ServerConsoleContext = createContext<ServerConsoleContextValue | null>(null);

export function ServerConsoleProvider({
  value,
  children,
}: {
  value: ServerConsoleContextValue;
  children: ReactNode;
}): ReactElement {
  return <ServerConsoleContext.Provider value={value}>{children}</ServerConsoleContext.Provider>;
}

export function useServerConsole(): ServerConsoleContextValue {
  const ctx = useContext(ServerConsoleContext);
  if (!ctx) {
    throw new Error('useServerConsole must be used within ServerConsoleProvider');
  }
  return ctx;
}
