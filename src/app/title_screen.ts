import {
  discordStartUrl,
  getSession,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  type AuthSession,
} from '../net/api';

export interface TitleScreenOptions {
  onPlay: (session: AuthSession) => void;
  /** Editor entry - only provided in dev builds; button stays hidden otherwise. */
  onEditor?: () => void;
}

type SceneName = 'login' | 'register' | 'forgot' | 'reset' | 'signed-in';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function createButton(label: string, variant: 'primary' | 'secondary' = 'primary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = variant === 'primary' ? 'sc-title-btn' : 'sc-title-btn sc-title-btn-secondary';
  button.textContent = label;
  return button;
}

function createLinkButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sc-title-link-btn';
  button.textContent = label;
  return button;
}

function createField(label: string, input: HTMLInputElement): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'sc-title-auth-field';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  input.className = 'sc-title-auth-input';
  field.append(labelEl, input);
  return field;
}

function input(name: string, type: string, autocomplete: string): HTMLInputElement {
  const element = document.createElement('input');
  element.name = name;
  element.type = type;
  element.setAttribute('autocomplete', autocomplete);
  element.required = true;
  return element;
}

function formValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function showTitleScreen(options: TitleScreenOptions): void {
  const screen = requireElement<HTMLElement>('title-screen');
  const actions = requireElement<HTMLElement>('title-actions');
  const editorBtn = requireElement<HTMLButtonElement>('title-editor-btn');
  const editorAccess = document.getElementById('title-editor-access');
  let currentScene: SceneName | null = null;
  let lastSession: AuthSession | null = null;

  screen.classList.remove('is-hidden');

  if (options.onEditor) {
    const onEditor = options.onEditor;
    editorAccess?.classList.remove('is-hidden');
    editorBtn.addEventListener(
      'click',
      () => {
        screen.classList.add('is-hidden');
        onEditor();
      },
      { once: true },
    );
  }

  function setStatus(message: string, isError = false): void {
    const status = actions.querySelector<HTMLElement>('[data-auth-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function play(session: AuthSession): void {
    screen.classList.add('is-hidden');
    options.onPlay(session);
  }

  function renderLinks(...links: HTMLButtonElement[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sc-title-auth-links';
    row.append(...links);
    return row;
  }

  function renderStatus(message = ''): HTMLElement {
    const status = document.createElement('p');
    status.className = 'sc-title-auth-message';
    status.dataset.authStatus = 'true';
    status.textContent = message;
    return status;
  }

  function replaceScene(scene: SceneName, nodes: Node[]): void {
    currentScene = scene;
    actions.replaceChildren(...nodes);
  }

  function renderSignedIn(session: AuthSession): void {
    lastSession = session;
    const title = document.createElement('p');
    title.className = 'sc-title-auth-title';
    title.textContent = `Welcome, ${session.player.displayName}`;

    const continueBtn = createButton('Continue');
    continueBtn.addEventListener('click', () => play(session));

    const logoutBtn = createButton('Logout', 'secondary');
    logoutBtn.addEventListener('click', () => {
      setStatus('Signing out...');
      logout()
        .then(() => {
          lastSession = null;
          renderLogin();
        })
        .catch((error) => setStatus((error as Error).message, true));
    });

    replaceScene('signed-in', [title, continueBtn, logoutBtn, renderStatus()]);
  }

  function renderLogin(message = ''): void {
    const form = document.createElement('form');
    form.className = 'sc-title-auth-form';
    const title = document.createElement('p');
    title.className = 'sc-title-auth-title';
    title.textContent = 'Login';

    const identifier = input('identifier', 'text', 'username');
    const password = input('password', 'password', 'current-password');
    const submit = createButton('Login');
    submit.type = 'submit';
    const discord = createButton('Login with Discord', 'secondary');
    discord.addEventListener('click', () => {
      window.location.href = discordStartUrl();
    });
    const forgot = createLinkButton('Forgot password');
    forgot.addEventListener('click', () => renderForgot());
    const create = createLinkButton('Register');
    create.addEventListener('click', () => renderRegister());

    form.append(
      title,
      createField('Email or handle', identifier),
      createField('Password', password),
      submit,
      discord,
      renderLinks(forgot, create),
      renderStatus(message),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus('Authenticating...');
      login(formValue(form, 'identifier'), formValue(form, 'password'))
        .then(play)
        .catch((error) => setStatus((error as Error).message, true));
    });
    replaceScene('login', [form]);
  }

  function renderRegister(): void {
    const form = document.createElement('form');
    form.className = 'sc-title-auth-form';
    const title = document.createElement('p');
    title.className = 'sc-title-auth-title';
    title.textContent = 'Register';

    const email = input('email', 'email', 'email');
    const username = input('username', 'text', 'username');
    const password = input('password', 'password', 'new-password');
    const submit = createButton('Register');
    submit.type = 'submit';
    const back = createLinkButton('Login');
    back.addEventListener('click', () => renderLogin());

    form.append(
      title,
      createField('Email', email),
      createField('Handle', username),
      createField('Password', password),
      submit,
      renderLinks(back),
      renderStatus(),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus('Creating citizen record...');
      register(formValue(form, 'email'), formValue(form, 'username'), formValue(form, 'password'))
        .then(play)
        .catch((error) => setStatus((error as Error).message, true));
    });
    replaceScene('register', [form]);
  }

  function renderForgot(): void {
    const form = document.createElement('form');
    form.className = 'sc-title-auth-form';
    const title = document.createElement('p');
    title.className = 'sc-title-auth-title';
    title.textContent = 'Reset Access';

    const email = input('email', 'email', 'email');
    const submit = createButton('Send Reset');
    submit.type = 'submit';
    const back = createLinkButton('Login');
    back.addEventListener('click', () => renderLogin());

    form.append(title, createField('Email', email), submit, renderLinks(back), renderStatus());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus('Sending reset link...');
      requestPasswordReset(formValue(form, 'email'))
        .then(() => setStatus('If that account exists, a reset link is inbound.'))
        .catch((error) => setStatus((error as Error).message, true));
    });
    replaceScene('forgot', [form]);
  }

  function renderReset(token: string): void {
    const form = document.createElement('form');
    form.className = 'sc-title-auth-form';
    const title = document.createElement('p');
    title.className = 'sc-title-auth-title';
    title.textContent = 'New Password';

    const password = input('password', 'password', 'new-password');
    const submit = createButton('Reset');
    submit.type = 'submit';
    const back = createLinkButton('Login');
    back.addEventListener('click', () => renderLogin());

    form.append(title, createField('Password', password), submit, renderLinks(back), renderStatus());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus('Resetting password...');
      resetPassword(token, formValue(form, 'password'))
        .then(() => {
          window.history.replaceState({}, '', window.location.pathname);
          renderLogin('Password reset. Log in with the new password.');
        })
        .catch((error) => setStatus((error as Error).message, true));
    });
    replaceScene('reset', [form]);
  }

  const params = new URLSearchParams(window.location.search);
  const authMode = params.get('auth');
  if (authMode === 'reset') {
    renderReset(params.get('token') ?? '');
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
        renderSignedIn(session);
        return;
      }
      if (authMode === 'discord-error') {
        renderLogin(params.get('reason') ?? 'Discord login failed.');
        return;
      }
      renderLogin();
    })
    .catch(() => {
      if (currentScene === null && lastSession === null) renderLogin();
    });
}
