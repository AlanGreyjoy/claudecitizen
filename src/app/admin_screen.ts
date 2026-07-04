import {
  AdminAuthError,
  adminLogin,
  adminLogout,
  createShipDefinition,
  getAdminSession,
  getAdminUser,
  getGameSettings,
  listAdminUsers,
  listShipDefinitions,
  updateGameSettings,
  updateShipDefinition,
  type AdminSession,
  type AdminUserDetail,
  type AdminUserSummary,
  type ShipDefinition,
  type ShipDefinitionInput,
} from '../net/admin_api';
import { listShipPrefabOptions, type ShipPrefabOption } from '../world/prefabs/list_ship_prefabs';

type AdminTab = 'users' | 'ships' | 'settings';
type AdminScene =
  | 'login'
  | 'users'
  | 'user-detail'
  | 'ships'
  | 'ship-form'
  | 'settings';

const DEFAULT_SHIP_FORM: ShipDefinitionInput = {
  name: '',
  description: '',
  prefabId: 'phobos-starhopper',
  costArc: 0,
  maxHp: 1000,
  maxShields: 500,
  shieldRegenPerSec: 25,
  maxSpeedMps: 100,
  throttleAccelMps2: 308,
};

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function createButton(label: string, variant: 'primary' | 'secondary' = 'primary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className =
    variant === 'primary' ? 'sc-title-btn' : 'sc-title-btn sc-title-btn-secondary';
  button.textContent = label;
  return button;
}

function createSmallButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sc-admin-nav-btn';
  button.textContent = label;
  return button;
}

function createField(label: string, input: HTMLElement): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'sc-admin-field';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  field.append(labelEl, input);
  return field;
}

function createTextInput(name: string, value = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'sc-admin-input';
  input.name = name;
  input.type = 'text';
  input.value = value;
  return input;
}

function createNumberInput(name: string, value: number, step = '1'): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'sc-admin-input';
  input.name = name;
  input.type = 'number';
  input.step = step;
  input.value = String(value);
  return input;
}

function createTextArea(name: string, value = ''): HTMLTextAreaElement {
  const input = document.createElement('textarea');
  input.className = 'sc-admin-textarea';
  input.name = name;
  input.value = value;
  return input;
}

function createSelect(name: string, options: Array<{ value: string; label: string }>, value = ''): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'sc-admin-select';
  select.name = name;
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    if (option.value === value) node.selected = true;
    select.append(node);
  }
  return select;
}

function formValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function formNumber(form: HTMLFormElement, name: string): number {
  const raw = formValue(form, name);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function renderMessage(message: string, isError = false): HTMLParagraphElement {
  const node = document.createElement('p');
  node.className = 'sc-admin-message';
  node.dataset.adminStatus = 'true';
  node.textContent = message;
  node.classList.toggle('is-error', isError);
  return node;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatArc(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString()} ARC`;
}

export function showAdminScreen(): void {
  const screen = requireElement<HTMLElement>('admin-screen');
  const shell = requireElement<HTMLElement>('admin-shell');
  document.getElementById('title-screen')?.classList.add('is-hidden');
  screen.classList.remove('is-hidden');

  let session: AdminSession | null = null;
  let currentTab: AdminTab = 'users';
  let currentScene: AdminScene = 'login';
  let shipPrefabs: ShipPrefabOption[] = [];
  let editingShipId: string | null = null;
  let selectedUserId: string | null = null;

  function setStatus(message: string, isError = false): void {
    const status = shell.querySelector<HTMLElement>('[data-admin-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function renderHeader(): void {
    const existing = shell.querySelector('.sc-admin-header');
    if (existing) existing.remove();

    if (!session) return;

    const header = document.createElement('header');
    header.className = 'sc-admin-header';

    const title = document.createElement('h1');
    title.className = 'sc-admin-title';
    title.textContent = 'Admin';

    const nav = document.createElement('nav');
    nav.className = 'sc-admin-nav';
    nav.setAttribute('aria-label', 'Admin sections');

    const tabs: Array<{ id: AdminTab; label: string }> = [
      { id: 'users', label: 'Users' },
      { id: 'ships', label: 'Ships' },
      { id: 'settings', label: 'Game Settings' },
    ];

    for (const tab of tabs) {
      const button = createSmallButton(tab.label);
      button.classList.toggle('is-active', currentTab === tab.id && currentScene !== 'user-detail' && currentScene !== 'ship-form');
      button.addEventListener('click', () => {
        currentTab = tab.id;
        if (tab.id === 'users') void showUsers();
        else if (tab.id === 'ships') void showShips();
        else void showSettings();
      });
      nav.append(button);
    }

    const logoutBtn = createSmallButton('Log out');
    logoutBtn.addEventListener('click', () => {
      setStatus('Signing out...');
      adminLogout()
        .catch(() => undefined)
        .finally(() => {
          session = null;
          renderLogin();
        });
    });

    header.append(title, nav, logoutBtn);
    shell.prepend(header);
  }

  function renderShell(nodes: Node[], scene: AdminScene, tab: AdminTab = currentTab): void {
    currentScene = scene;
    currentTab = tab;

    if (!shell.querySelector('.sc-admin-content')) {
      shell.replaceChildren();
    }

    renderHeader();

    const content = shell.querySelector('.sc-admin-content');
    if (content) {
      content.replaceChildren(...nodes);
      return;
    }

    const contentWrap = document.createElement('div');
    contentWrap.className = 'sc-admin-content';
    contentWrap.append(...nodes);
    shell.append(contentWrap);
  }

  function renderLogin(message = ''): void {
    session = null;
    shell.replaceChildren();

    const form = document.createElement('form');
    form.className = 'sc-title-auth-form sc-admin-form';

    const title = document.createElement('p');
    title.className = 'sc-title-auth-title';
    title.textContent = 'Admin Login';

    const email = createTextInput('email', 'admin@claude-citizen.com');
    email.type = 'email';
    email.placeholder = 'admin@claude-citizen.com';
    email.required = true;
    email.setAttribute('autocomplete', 'username');

    const password = createTextInput('password');
    password.type = 'password';
    password.required = true;
    password.setAttribute('autocomplete', 'current-password');
    password.className = 'sc-title-auth-input';

    const submit = createButton('Sign in');
    submit.type = 'submit';

    form.append(
      title,
      createField('Email', email),
      createField('Password', password),
      submit,
      renderMessage(message),
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus('Authenticating...');
      adminLogin(formValue(form, 'email'), formValue(form, 'password'))
        .then((nextSession) => {
          session = nextSession;
          void showUsers();
        })
        .catch((error) => {
          const messageText =
            error instanceof AdminAuthError || error instanceof Error
              ? error.message
              : 'Login failed.';
          renderLogin(messageText);
        });
    });

    currentScene = 'login';
    shell.replaceChildren(form);
  }

  function renderUsersTable(users: AdminUserSummary[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sc-admin-table-wrap';

    const table = document.createElement('table');
    table.className = 'sc-admin-table';

    table.innerHTML = `
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
    `;

    const body = document.createElement('tbody');
    for (const user of users) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${user.username}</td>
        <td>${user.email ?? '—'}</td>
        <td>${user.displayName}</td>
        <td>${user.player ? formatArc(user.player.arcBalance) : '—'}</td>
        <td>${user.player?.shipCount ?? 0}</td>
        <td>${formatDate(user.player?.starterLoadoutGrantedAt ?? null)}</td>
      `;
      row.addEventListener('click', () => {
        selectedUserId = user.id;
        void showUserDetail(user.id);
      });
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  async function showUsers(): Promise<void> {
    renderShell([renderMessage('Loading users...')], 'users', 'users');
    try {
      const users = await listAdminUsers();
      const title = document.createElement('h2');
      title.className = 'sc-admin-section-title';
      title.textContent = 'Users';
      const meta = document.createElement('p');
      meta.className = 'sc-admin-meta';
      meta.textContent = `${users.length} account${users.length === 1 ? '' : 's'} — read only`;
      renderShell([title, meta, renderUsersTable(users), renderMessage('')], 'users', 'users');
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          renderMessage(error instanceof Error ? error.message : 'Failed to load users.', true),
        ],
        'users',
        'users',
      );
    }
  }

  function renderDetailItem(label: string, value: string): HTMLElement {
    const item = document.createElement('div');
    item.className = 'sc-admin-detail-item';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    item.append(dt, dd);
    return item;
  }

  function renderUserDetailView(user: AdminUserDetail): DocumentFragment {
    const fragment = document.createDocumentFragment();

    const back = createButton('Back to users', 'secondary');
    back.addEventListener('click', () => {
      selectedUserId = null;
      void showUsers();
    });

    const title = document.createElement('h2');
    title.className = 'sc-admin-section-title';
    title.textContent = user.displayName;

    const grid = document.createElement('dl');
    grid.className = 'sc-admin-detail-grid';
    grid.append(
      renderDetailItem('Username', user.username),
      renderDetailItem('Email', user.email ?? '—'),
      renderDetailItem('User ID', user.id),
      renderDetailItem('Created', formatDate(user.createdAt)),
    );

    if (user.player) {
      grid.append(
        renderDetailItem('Player handle', user.player.handle),
        renderDetailItem('Asteron Reserve Credits (ARC)', formatArc(user.player.arcBalance)),
        renderDetailItem('Starter grant', formatDate(user.player.starterLoadoutGrantedAt)),
        renderDetailItem('Current instance', user.player.currentInstanceId),
        renderDetailItem('Current room', user.player.currentRoomId),
      );
    }

    const shipsTitle = document.createElement('h3');
    shipsTitle.className = 'sc-admin-section-title';
    shipsTitle.textContent = 'Owned ships';

    const shipsWrap = document.createElement('div');
    shipsWrap.className = 'sc-admin-table-wrap';

    if (!user.player || user.player.ships.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-admin-meta';
      empty.textContent = 'No owned ships.';
      shipsWrap.append(empty);
    } else {
      const table = document.createElement('table');
      table.className = 'sc-admin-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>Name</th>
            <th>Prefab</th>
            <th>Definition</th>
            <th>HP</th>
            <th>Shields</th>
          </tr>
        </thead>
      `;
      const body = document.createElement('tbody');
      for (const ship of user.player.ships) {
        const row = document.createElement('tr');
        row.className = 'is-static';
        row.innerHTML = `
          <td>${ship.displayName}</td>
          <td>${ship.prefabId}</td>
          <td>${ship.shipDefinition?.name ?? '—'}</td>
          <td>${ship.hp.toFixed(0)} / ${ship.maxHp.toFixed(0)}</td>
          <td>${ship.shields.toFixed(0)} / ${ship.maxShields.toFixed(0)}</td>
        `;
        body.append(row);
      }
      table.append(body);
      shipsWrap.append(table);
    }

    fragment.append(back, title, grid, shipsTitle, shipsWrap, renderMessage(''));
    return fragment;
  }

  async function showUserDetail(userId: string): Promise<void> {
    renderShell([renderMessage('Loading user...')], 'user-detail', 'users');
    try {
      const user = await getAdminUser(userId);
      renderShell([renderUserDetailView(user)], 'user-detail', 'users');
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          renderMessage(error instanceof Error ? error.message : 'Failed to load user.', true),
        ],
        'user-detail',
        'users',
      );
    }
  }

  function renderShipsTable(ships: ShipDefinition[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sc-admin-table-wrap';

    const table = document.createElement('table');
    table.className = 'sc-admin-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th>
          <th>Prefab</th>
          <th>Cost (ARC)</th>
          <th>Max HP</th>
          <th>Max shields</th>
          <th>Max speed</th>
          <th>Accel</th>
        </tr>
      </thead>
    `;

    const body = document.createElement('tbody');
    for (const ship of ships) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${ship.name}</td>
        <td>${ship.prefabId}</td>
        <td>${ship.costArc.toLocaleString()}</td>
        <td>${ship.maxHp}</td>
        <td>${ship.maxShields}</td>
        <td>${ship.maxSpeedMps}</td>
        <td>${ship.throttleAccelMps2}</td>
      `;
      row.addEventListener('click', () => {
        editingShipId = ship.id;
        void showShipForm(ship);
      });
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  async function showShips(): Promise<void> {
    renderShell([renderMessage('Loading ship catalog...')], 'ships', 'ships');
    try {
      const ships = await listShipDefinitions();
      const title = document.createElement('h2');
      title.className = 'sc-admin-section-title';
      title.textContent = 'Ship definitions';

      const createBtn = createButton('Create ship definition');
      createBtn.addEventListener('click', () => {
        editingShipId = null;
        void showShipForm();
      });

      const actions = document.createElement('div');
      actions.className = 'sc-admin-actions';
      actions.append(createBtn);

      renderShell(
        [title, actions, renderShipsTable(ships), renderMessage('')],
        'ships',
        'ships',
      );
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          renderMessage(error instanceof Error ? error.message : 'Failed to load ships.', true),
        ],
        'ships',
        'ships',
      );
    }
  }

  async function ensureShipPrefabs(): Promise<ShipPrefabOption[]> {
    if (shipPrefabs.length > 0) return shipPrefabs;
    shipPrefabs = await listShipPrefabOptions();
    return shipPrefabs;
  }

  function readShipForm(form: HTMLFormElement): ShipDefinitionInput {
    return {
      name: formValue(form, 'name'),
      description: formValue(form, 'description'),
      prefabId: formValue(form, 'prefabId'),
      costArc: Math.round(formNumber(form, 'costArc')),
      maxHp: formNumber(form, 'maxHp'),
      maxShields: formNumber(form, 'maxShields'),
      shieldRegenPerSec: formNumber(form, 'shieldRegenPerSec'),
      maxSpeedMps: formNumber(form, 'maxSpeedMps'),
      throttleAccelMps2: formNumber(form, 'throttleAccelMps2'),
    };
  }

  async function showShipForm(existing?: ShipDefinition): Promise<void> {
    const prefabs = await ensureShipPrefabs();
    const defaults = existing
      ? {
          name: existing.name,
          description: existing.description,
          prefabId: existing.prefabId,
          costArc: existing.costArc,
          maxHp: existing.maxHp,
          maxShields: existing.maxShields,
          shieldRegenPerSec: existing.shieldRegenPerSec,
          maxSpeedMps: existing.maxSpeedMps,
          throttleAccelMps2: existing.throttleAccelMps2,
        }
      : { ...DEFAULT_SHIP_FORM, prefabId: prefabs[0]?.id ?? DEFAULT_SHIP_FORM.prefabId };

    const form = document.createElement('form');
    form.className = 'sc-admin-form sc-admin-form-wide';

    const title = document.createElement('h2');
    title.className = 'sc-admin-section-title';
    title.textContent = existing ? 'Edit ship definition' : 'Create ship definition';

    const back = createButton('Back to ships', 'secondary');
    back.addEventListener('click', () => {
      editingShipId = null;
      void showShips();
    });

    form.append(
      title,
      createField('Name', createTextInput('name', defaults.name)),
      createField('Description', createTextArea('description', defaults.description)),
      createField(
        'Ship prefab',
        createSelect(
          'prefabId',
          prefabs.map((prefab) => ({ value: prefab.id, label: `${prefab.label} (${prefab.id})` })),
          defaults.prefabId,
        ),
      ),
      createField('Cost (ARC)', createNumberInput('costArc', defaults.costArc)),
      createField('Max HP', createNumberInput('maxHp', defaults.maxHp)),
      createField('Max shields', createNumberInput('maxShields', defaults.maxShields)),
      createField('Shield regen / sec', createNumberInput('shieldRegenPerSec', defaults.shieldRegenPerSec, '0.1')),
      createField('Max speed (m/s)', createNumberInput('maxSpeedMps', defaults.maxSpeedMps, '0.1')),
      createField('Throttle accel (m/s²)', createNumberInput('throttleAccelMps2', defaults.throttleAccelMps2, '0.1')),
    );

    const save = createButton(existing ? 'Save changes' : 'Create definition');
    save.type = 'submit';
    const actions = document.createElement('div');
    actions.className = 'sc-admin-actions';
    actions.append(save);
    form.append(actions, renderMessage(''));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus('Saving ship definition...');
      const payload = readShipForm(form);
      const request = existing
        ? updateShipDefinition(existing.id, payload)
        : createShipDefinition(payload);
      request
        .then(() => {
          editingShipId = null;
          void showShips();
        })
        .catch((error) => {
          setStatus(error instanceof Error ? error.message : 'Save failed.', true);
        });
    });

    renderShell([back, form], 'ship-form', 'ships');
  }

  function renderStarterEditor(
    definitions: ShipDefinition[],
    selectedIds: string[],
    onChange: (next: string[]) => void,
  ): HTMLElement {
    const wrap = document.createElement('div');

    const availableTitle = document.createElement('p');
    availableTitle.className = 'sc-admin-meta';
    availableTitle.textContent =
      'Starter ships are granted once on first bootstrap. Order matters — first entry is the default primary ship.';

    const addRow = document.createElement('div');
    addRow.className = 'sc-admin-actions';
    const select = createSelect(
      'starter-add',
      definitions
        .filter((definition) => !selectedIds.includes(definition.id))
        .map((definition) => ({ value: definition.id, label: definition.name })),
    );
    const addBtn = createButton('Add starter ship', 'secondary');
    addBtn.addEventListener('click', () => {
      const id = select.value;
      if (!id || selectedIds.includes(id)) return;
      onChange([...selectedIds, id]);
    });
    addRow.append(select, addBtn);

    const list = document.createElement('ul');
    list.className = 'sc-admin-starter-list';

    selectedIds.forEach((id, index) => {
      const definition = definitions.find((entry) => entry.id === id);
      const item = document.createElement('li');
      item.className = 'sc-admin-starter-item';

      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${definition?.name ?? id}`;

      const up = createSmallButton('Up');
      up.disabled = index === 0;
      up.addEventListener('click', () => {
        const next = [...selectedIds];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        onChange(next);
      });

      const down = createSmallButton('Down');
      down.disabled = index === selectedIds.length - 1;
      down.addEventListener('click', () => {
        const next = [...selectedIds];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        onChange(next);
      });

      const remove = createSmallButton('Remove');
      remove.addEventListener('click', () => {
        onChange(selectedIds.filter((entry) => entry !== id));
      });

      item.append(label, up, down, remove);
      list.append(item);
    });

    wrap.append(availableTitle, addRow, list);
    return wrap;
  }

  async function showSettings(): Promise<void> {
    renderShell([renderMessage('Loading game settings...')], 'settings', 'settings');
    try {
      const [settings, definitions] = await Promise.all([
        getGameSettings(),
        listShipDefinitions(),
      ]);

      let starterIds = [...settings.starterShipDefinitionIds];
      const form = document.createElement('form');
      form.className = 'sc-admin-form sc-admin-form-wide';

      const title = document.createElement('h2');
      title.className = 'sc-admin-section-title';
      title.textContent = 'Game settings';

      const arcField = createField(
        'Starting Asteron Reserve Credits (ARC)',
        createNumberInput('startingArcBalance', settings.startingArcBalance),
      );

      const starterHost = document.createElement('div');
      const renderStarterSection = (): void => {
        starterHost.replaceChildren(
          createField(
            'Starter ships',
            renderStarterEditor(definitions, starterIds, (next) => {
              starterIds = next;
              renderStarterSection();
            }),
          ),
        );
      };
      renderStarterSection();

      const save = createButton('Save settings');
      save.type = 'submit';
      const actions = document.createElement('div');
      actions.className = 'sc-admin-actions';
      actions.append(save);

      form.append(title, arcField, starterHost, actions, renderMessage(''));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        setStatus('Saving settings...');
        updateGameSettings({
          startingArcBalance: Math.round(formNumber(form, 'startingArcBalance')),
          starterShipDefinitionIds: starterIds,
        })
          .then(() => {
            setStatus('Settings saved.');
          })
          .catch((error) => {
            setStatus(error instanceof Error ? error.message : 'Save failed.', true);
          });
      });

      renderShell([form], 'settings', 'settings');
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          renderMessage(error instanceof Error ? error.message : 'Failed to load settings.', true),
        ],
        'settings',
        'settings',
      );
    }
  }

  shell.replaceChildren(renderMessage('Checking admin session...'));
  getAdminSession()
    .then((existing) => {
      if (existing) {
        session = existing;
        if (selectedUserId) void showUserDetail(selectedUserId);
        else if (editingShipId) {
          listShipDefinitions()
            .then((ships) => {
              const ship = ships.find((entry) => entry.id === editingShipId);
              if (ship) void showShipForm(ship);
              else void showShips();
            })
            .catch(() => void showShips());
        } else if (currentTab === 'ships') void showShips();
        else if (currentTab === 'settings') void showSettings();
        else void showUsers();
        return;
      }
      renderLogin();
    })
    .catch(() => renderLogin());
}
