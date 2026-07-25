import {
  discordStartUrl,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  type AuthSession,
} from '../net/api';
import { createUiIcon, UiIcons } from '../ui/icons';

export type SceneName = 'login' | 'register' | 'forgot' | 'reset' | 'signed-in';

const AUTH_TITLE_CLASS = 'sc-title-auth-title';
const AUTH_FORM_CLASS = 'sc-title-auth-form';

export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

export function createButton(label: string, variant: 'primary' | 'secondary' = 'primary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = variant === 'primary' ? 'sc-title-btn' : 'sc-title-btn sc-title-btn-secondary';
  button.textContent = label;
  return button;
}

export function createLinkButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sc-title-link-btn';
  button.textContent = label;
  return button;
}

export function createField(label: string, input: HTMLInputElement): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'sc-title-auth-field';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  input.className = 'sc-title-auth-input';
  field.append(labelEl, input);
  return field;
}

function setPasswordToggleIcon(toggle: HTMLButtonElement, visible: boolean): void {
  toggle.replaceChildren(
    createUiIcon(visible ? UiIcons.eyeOff : UiIcons.eye, {
      className: 'sc-ui-icon',
      size: 18,
    }),
  );
}

export function createPasswordField(label: string, autocomplete: string): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'sc-title-auth-field';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;

  const wrap = document.createElement('div');
  wrap.className = 'sc-title-auth-input-wrap';

  const passwordInput = input('password', 'password', autocomplete);
  passwordInput.className = 'sc-title-auth-input';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sc-title-auth-input-toggle';
  toggle.setAttribute('aria-label', 'Show password');
  toggle.setAttribute('aria-pressed', 'false');
  setPasswordToggleIcon(toggle, false);
  toggle.addEventListener('click', () => {
    const visible = passwordInput.type === 'text';
    passwordInput.type = visible ? 'password' : 'text';
    toggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
    toggle.setAttribute('aria-pressed', visible ? 'false' : 'true');
    setPasswordToggleIcon(toggle, !visible);
  });

  wrap.append(passwordInput, toggle);
  field.append(labelEl, wrap);
  return field;
}

export function input(name: string, type: string, autocomplete: string): HTMLInputElement {
  const element = document.createElement('input');
  element.name = name;
  element.type = type;
  element.setAttribute('autocomplete', autocomplete);
  element.required = true;
  return element;
}

export function formValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function renderLinks(...links: HTMLButtonElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sc-title-auth-links';
  row.append(...links);
  return row;
}

export function renderStatus(message = ''): HTMLElement {
  const status = document.createElement('p');
  status.className = 'sc-title-auth-message';
  status.dataset.authStatus = 'true';
  status.textContent = message;
  return status;
}

function authTitle(text: string): HTMLParagraphElement {
  const title = document.createElement('p');
  title.className = AUTH_TITLE_CLASS;
  title.textContent = text;
  return title;
}

interface AuthSceneHelpers {
  play: (session: AuthSession) => void;
  setStatus: (message: string, isError?: boolean) => void;
  replaceScene: (scene: SceneName, nodes: Node[]) => void;
  renderLogin: (message?: string) => void;
  renderRegister: () => void;
  renderForgot: () => void;
  setLastSession: (session: AuthSession | null) => void;
}

function mountSignedInScene(session: AuthSession, helpers: AuthSceneHelpers): void {
  helpers.setLastSession(session);
  const continueBtn = createButton('Continue');
  continueBtn.addEventListener('click', () => helpers.play(session));
  const logoutBtn = createButton('Logout', 'secondary');
  logoutBtn.addEventListener('click', () => {
    helpers.setStatus('Signing out...');
    logout()
      .then(() => {
        helpers.setLastSession(null);
        helpers.renderLogin();
      })
      .catch((error) => helpers.setStatus((error as Error).message, true));
  });
  helpers.replaceScene('signed-in', [
    authTitle(`Welcome, ${session.player.displayName}`),
    continueBtn,
    logoutBtn,
    renderStatus(),
  ]);
}

function mountLoginScene(message: string, helpers: AuthSceneHelpers): void {
  const form = document.createElement('form');
  form.className = AUTH_FORM_CLASS;
  const identifier = input('identifier', 'text', 'username');
  const submit = createButton('Login');
  submit.type = 'submit';
  const discord = createButton('Login with Discord', 'secondary');
  discord.addEventListener('click', () => {
    window.location.href = discordStartUrl();
  });
  const forgot = createLinkButton('Forgot password');
  forgot.addEventListener('click', () => helpers.renderForgot());
  const create = createLinkButton('Register');
  create.addEventListener('click', () => helpers.renderRegister());
  form.append(
    authTitle('Login'),
    createField('Email or handle', identifier),
    createPasswordField('Password', 'current-password'),
    submit,
    discord,
    renderLinks(forgot, create),
    renderStatus(message),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    helpers.setStatus('Authenticating...');
    login(formValue(form, 'identifier'), formValue(form, 'password'))
      .then(helpers.play)
      .catch((error) => helpers.setStatus((error as Error).message, true));
  });
  helpers.replaceScene('login', [form]);
}

function mountRegisterScene(helpers: AuthSceneHelpers): void {
  const form = document.createElement('form');
  form.className = AUTH_FORM_CLASS;
  const email = input('email', 'email', 'email');
  const username = input('username', 'text', 'username');
  const submit = createButton('Register');
  submit.type = 'submit';
  const back = createLinkButton('Login');
  back.addEventListener('click', () => helpers.renderLogin());
  form.append(
    authTitle('Register'),
    createField('Email', email),
    createField('Handle', username),
    createPasswordField('Password', 'new-password'),
    submit,
    renderLinks(back),
    renderStatus(),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    helpers.setStatus('Creating citizen record...');
    register(formValue(form, 'email'), formValue(form, 'username'), formValue(form, 'password'))
      .then(helpers.play)
      .catch((error) => helpers.setStatus((error as Error).message, true));
  });
  helpers.replaceScene('register', [form]);
}

function mountForgotScene(helpers: AuthSceneHelpers): void {
  const form = document.createElement('form');
  form.className = AUTH_FORM_CLASS;
  const email = input('email', 'email', 'email');
  const submit = createButton('Send Reset');
  submit.type = 'submit';
  const back = createLinkButton('Login');
  back.addEventListener('click', () => helpers.renderLogin());
  form.append(authTitle('Reset Access'), createField('Email', email), submit, renderLinks(back), renderStatus());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    helpers.setStatus('Sending reset link...');
    requestPasswordReset(formValue(form, 'email'))
      .then(() => helpers.setStatus('If that account exists, a reset link is inbound.'))
      .catch((error) => helpers.setStatus((error as Error).message, true));
  });
  helpers.replaceScene('forgot', [form]);
}

function mountResetScene(token: string, helpers: AuthSceneHelpers): void {
  const form = document.createElement('form');
  form.className = AUTH_FORM_CLASS;
  const submit = createButton('Reset');
  submit.type = 'submit';
  const back = createLinkButton('Login');
  back.addEventListener('click', () => helpers.renderLogin());
  form.append(
    authTitle('New Password'),
    createPasswordField('Password', 'new-password'),
    submit,
    renderLinks(back),
    renderStatus(),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    helpers.setStatus('Resetting password...');
    resetPassword(token, formValue(form, 'password'))
      .then(() => {
        window.history.replaceState({}, '', window.location.pathname);
        helpers.renderLogin('Password reset. Log in with the new password.');
      })
      .catch((error) => helpers.setStatus((error as Error).message, true));
  });
  helpers.replaceScene('reset', [form]);
}

export interface TitleAuthRenderers {
  renderSignedIn: (session: AuthSession) => void;
  renderLogin: (message?: string) => void;
  renderRegister: () => void;
  renderForgot: () => void;
  renderReset: (token: string) => void;
  setStatus: (message: string, isError?: boolean) => void;
  getLastSession: () => AuthSession | null;
  getCurrentScene: () => SceneName | null;
}

export function createTitleAuthRenderers(options: {
  actions: HTMLElement;
  play: (session: AuthSession) => void;
}): TitleAuthRenderers {
  let currentScene: SceneName | null = null;
  let lastSession: AuthSession | null = null;

  function setStatus(message: string, isError = false): void {
    const status = options.actions.querySelector<HTMLElement>('[data-auth-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function replaceScene(scene: SceneName, nodes: Node[]): void {
    currentScene = scene;
    options.actions.replaceChildren(...nodes);
  }

  const helpers: AuthSceneHelpers = {
    play: options.play,
    setStatus,
    replaceScene,
    renderLogin: (message = '') => mountLoginScene(message, helpers),
    renderRegister: () => mountRegisterScene(helpers),
    renderForgot: () => mountForgotScene(helpers),
    setLastSession: (session) => { lastSession = session; },
  };

  return {
    renderSignedIn: (session) => mountSignedInScene(session, helpers),
    renderLogin: helpers.renderLogin,
    renderRegister: helpers.renderRegister,
    renderForgot: helpers.renderForgot,
    renderReset: (token) => mountResetScene(token, helpers),
    setStatus,
    getLastSession: () => lastSession,
    getCurrentScene: () => currentScene,
  };
}
