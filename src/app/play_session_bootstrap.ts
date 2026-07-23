import type { LoadingScreenHandle } from './loading_screen';
import {
  fetchGameBootstrap,
  getSession,
  type AuthSession,
  type GameBootstrap,
} from '../net/api';
import type { StartPlaySessionOptions } from './play_session';

export interface PlaySessionBootstrap {
  session: AuthSession | null;
  bootstrap: GameBootstrap | null;
}

export async function resolvePlaySessionBootstrap(
  loading: LoadingScreenHandle | undefined,
  options: StartPlaySessionOptions,
): Promise<PlaySessionBootstrap> {
  const requireAuth = options.requireAuth ?? true;
  let session: AuthSession | null = options.session ?? null;
  let bootstrap: GameBootstrap | null = options.bootstrap ?? null;

  if (!requireAuth) {
    return { session, bootstrap };
  }

  loading?.setStatus('Checking credentials...');
  session = session ?? (await getSession());
  if (!session) throw new Error('Login required.');
  if (!bootstrap) {
    loading?.setStatus('Loading citizen record...');
    bootstrap = await fetchGameBootstrap();
  }
  return { session, bootstrap };
}
