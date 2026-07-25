import {
  getSession,
  type AuthSession,
} from '../net/api';
import { ensureTitleScreenMarkup } from '../ui/screens/mount';
import {
  createTitleAuthRenderers,
  renderStatus,
  requireElement,
  type TitleAuthRenderers,
} from './title-screen-helpers';

export interface TitleScreenOptions {
  onPlay: (session: AuthSession) => void;
}

interface TitleScreenController {
  renderSignedIn: (session: AuthSession) => void;
  renderLogin: (message?: string) => void;
}

let titleScreenController: TitleScreenController | null = null;

export function restoreTitleScreen(session?: AuthSession | null): void {
  document.getElementById('app')?.classList.add('is-hidden');
  ensureTitleScreenMarkup().classList.remove('is-hidden');
  if (!titleScreenController) return;
  if (session) {
    titleScreenController.renderSignedIn(session);
    return;
  }
  titleScreenController.renderLogin();
}

function bootTitleAuthSession(
  actions: HTMLElement,
  auth: TitleAuthRenderers,
  play: (session: AuthSession) => void,
): void {
  const params = new URLSearchParams(window.location.search);
  const authMode = params.get('auth');
  if (authMode === 'reset') {
    auth.renderReset(params.get('token') ?? '');
    return;
  }

  actions.replaceChildren(renderStatus('Checking credentials...'));
  getSession()
    .then((session) => {
      if (session) {
        if (authMode === 'discord-success') {
          window.history.replaceState({}, '', window.location.pathname);
          play(session);
          return;
        }
        auth.renderSignedIn(session);
        return;
      }
      if (authMode === 'discord-error') {
        auth.renderLogin(params.get('reason') ?? 'Discord login failed.');
        return;
      }
      auth.renderLogin();
    })
    .catch(() => {
      if (auth.getCurrentScene() === null && auth.getLastSession() === null) auth.renderLogin();
    });
}

export function showTitleScreen(options: TitleScreenOptions): void {
  const screen = ensureTitleScreenMarkup();
  const actions = requireElement<HTMLElement>('title-actions');

  screen.classList.remove('is-hidden');

  function play(session: AuthSession): void {
    screen.classList.add('is-hidden');
    options.onPlay(session);
  }

  const auth = createTitleAuthRenderers({ actions, play });
  bootTitleAuthSession(actions, auth, play);

  titleScreenController = {
    renderSignedIn: auth.renderSignedIn,
    renderLogin: auth.renderLogin,
  };
}
