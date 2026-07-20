import {
  AdminAuthError,
  adminLogin,
  adminLogout,
  assignShipToUser,
  createShipDefinition,
  createPropDefinition,
  createItemDefinition,
  createWeaponDefinition,
  createBackpackDefinition,
  createWearableDefinition,
  deleteItemDefinition,
  deleteWeaponDefinition,
  deleteBackpackDefinition,
  deleteWearableDefinition,
  getAdminSession,
  getAdminUser,
  getGameSettings,
  listAdminUsers,
  listItemDefinitions,
  listWeaponDefinitions,
  listBackpackDefinitions,
  listWearableDefinitions,
  listPropDefinitions,
  listShipDefinitions,
  updateGameSettings,
  updateItemDefinition,
  updateWeaponDefinition,
  updateBackpackDefinition,
  updateWearableDefinition,
  updatePropDefinition,
  updateShipDefinition,
  type AdminSession,
  type AdminUserDetail,
  type AdminUserSummary,
  type ItemDefinition,
  type ItemDefinitionInput,
  type WeaponDefinition,
  type WeaponDefinitionInput,
  type BackpackDefinition,
  type BackpackDefinitionInput,
  type WearableDefinition,
  type WearableDefinitionInput,
  type PropDefinition,
  type PropDefinitionInput,
  type ShipDefinition,
  type ShipDefinitionInput,
} from '../net/admin_api';
import { listShipPrefabOptions, type ShipPrefabOption } from '../world/prefabs/list_ship_prefabs';
import { listPropPrefabOptions, type PropPrefabOption } from '../world/prefabs/list_prop_prefabs';
import { listItemPrefabOptions, type ItemPrefabOption } from '../world/prefabs/list_item_prefabs';
import {
  ITEM_TYPES,
  WEARABLE_SLOT_TYPES,
  type WearableSlotType,
} from '../player/inventory/types';
import { WEAPON_SLOT_TYPES, type WeaponSlotType } from '../types/equipment';
import { loadPrefabDocument } from '../world/prefabs/loader';
import { validateBackpackPrefab } from '../world/prefabs/item_runtime';
import { generateItemPrefabScreenshot } from '../render/prefabs/item_prefab_screenshot';

type AdminTab =
  | 'users'
  | 'ships'
  | 'props'
  | 'items'
  | 'weapons'
  | 'backpacks'
  | 'wearables'
  | 'settings';
type AdminScene =
  | 'login'
  | 'users'
  | 'user-detail'
  | 'ships'
  | 'ship-form'
  | 'props'
  | 'prop-form'
  | 'items'
  | 'item-form'
  | 'weapons'
  | 'weapon-form'
  | 'backpacks'
  | 'backpack-form'
  | 'wearables'
  | 'wearable-form'
  | 'settings';

const DEFAULT_ITEM_FORM: ItemDefinitionInput = {
  name: '',
  description: '',
  itemType: 'consumable',
  subType: 'generic',
  prefabId: null,
  iconUrl: null,
  stackMax: 99,
  costArc: 0,
  rarity: 'common',
};

const DEFAULT_WEAPON_FORM: WeaponDefinitionInput = {
  name: '',
  description: '',
  subType: 'generic',
  prefabId: '',
  iconUrl: null,
  costArc: 0,
  rarity: 'common',
  weaponSlotType: 'rifle',
};

const DEFAULT_BACKPACK_FORM: BackpackDefinitionInput = {
  name: '',
  description: '',
  subType: 'generic',
  prefabId: '',
  iconUrl: null,
  costArc: 0,
  rarity: 'common',
  capacityLiters: 0,
  emptyMassKg: 0,
};

const DEFAULT_WEARABLE_FORM: WearableDefinitionInput = {
  name: '',
  description: '',
  itemType: 'clothing',
  subType: 'generic',
  prefabId: null,
  iconUrl: null,
  costArc: 0,
  rarity: 'common',
  wearableSlotType: 'torso',
  occupiedSlotTypes: ['torso'],
  sidekickPartPresetId: 1,
};

const DEFAULT_PROP_FORM: PropDefinitionInput = {
  name: '',
  description: '',
  prefabId: 'hangar-crate-01',
  costArc: 250,
  category: 'decoration',
  maxPerHangar: 8,
  allowRotateY: true,
  snapGridM: 0.5,
};

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
    variant === 'primary' ? 'sc-admin-btn' : 'sc-admin-btn sc-admin-btn-secondary';
  button.textContent = label;
  return button;
}

function createSmallButton(label: string): HTMLButtonElement {
  const button = createButton(label, 'secondary');
  button.classList.add('sc-admin-btn-small');
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

/**
 * Icon URL field with isometric prefab screenshot generation.
 * Reads `prefabId` from the same form; writes a PNG data URL into `iconUrl`.
 */
function createIconUrlField(
  form: HTMLFormElement,
  initialValue: string,
  setStatus: (message: string, isError?: boolean) => void,
): HTMLLabelElement {
  const wrap = document.createElement('div');
  wrap.className = 'sc-admin-icon-url';

  const input = createTextInput('iconUrl', initialValue);
  const row = document.createElement('div');
  row.className = 'sc-admin-icon-url-row';
  const generate = createSmallButton('Generate Screenshot');
  generate.title =
    'Load the selected item prefab and capture an isometric PNG with a transparent background';
  row.append(input, generate);

  const preview = document.createElement('img');
  preview.className = 'sc-admin-icon-preview';
  preview.alt = 'Item icon preview';
  preview.hidden = true;

  const syncPreview = (url: string) => {
    if (!url) {
      preview.removeAttribute('src');
      preview.hidden = true;
      return;
    }
    preview.src = url;
    preview.hidden = false;
  };
  syncPreview(initialValue.trim());
  input.addEventListener('input', () => syncPreview(input.value.trim()));

  generate.addEventListener('click', () => {
    const prefabId = formValue(form, 'prefabId');
    if (!prefabId) {
      setStatus('Select an item prefab before generating a screenshot.', true);
      return;
    }
    generate.disabled = true;
    setStatus(`Generating isometric screenshot for "${prefabId}"...`);
    void generateItemPrefabScreenshot(prefabId)
      .then((dataUrl) => {
        input.value = dataUrl;
        syncPreview(dataUrl);
        setStatus('Screenshot generated. Save the definition to persist the icon.');
      })
      .catch((error) => {
        setStatus(
          error instanceof Error ? error.message : 'Screenshot generation failed.',
          true,
        );
      })
      .finally(() => {
        generate.disabled = false;
      });
  });

  wrap.append(row, preview);
  return createField('Icon URL (optional)', wrap);
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

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function truncateText(text: string, maxLen = 24): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function createTruncatedCell(text: string, maxLen = 24, mono = false): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = mono ? 'sc-admin-cell-truncate sc-admin-cell-mono' : 'sc-admin-cell-truncate';
  td.textContent = truncateText(text, maxLen);
  if (text.length > maxLen) td.title = text;
  return td;
}

function createSearchInput(placeholder: string, onQuery: (query: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'sc-admin-search';
  input.placeholder = placeholder;
  input.addEventListener('input', () => onQuery(input.value));
  return input;
}

  function createPageHeader(
  title: string,
  subtitle?: string,
  actions?: HTMLElement[],
): HTMLElement {
  const header = document.createElement('header');
  header.className = 'sc-admin-page-header';

  const textWrap = document.createElement('div');
  textWrap.className = 'sc-admin-page-header-text';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'sc-admin-page-eyebrow';
  eyebrow.textContent = 'Operator Console';

  const heading = document.createElement('h1');
  heading.textContent = title;
  textWrap.append(eyebrow, heading);

  if (subtitle) {
    const meta = document.createElement('p');
    meta.textContent = subtitle;
    textWrap.append(meta);
  }

  header.append(textWrap);

  if (actions && actions.length > 0) {
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'sc-admin-page-header-actions';
    actionsWrap.append(...actions);
    header.append(actionsWrap);
  }

  return header;
}

function createToolbar(...nodes: HTMLElement[]): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'sc-admin-toolbar';
  toolbar.append(...nodes);
  return toolbar;
}

function wrapInCard(content: HTMLElement): HTMLElement {
  const card = document.createElement('div');
  card.className = 'sc-admin-card';
  card.append(content);
  return card;
}

function isTabActive(tab: AdminTab, currentTab: AdminTab, currentScene: AdminScene): boolean {
  return (
    currentTab === tab &&
    currentScene !== 'user-detail' &&
    currentScene !== 'ship-form' &&
    currentScene !== 'prop-form' &&
    currentScene !== 'item-form' &&
    currentScene !== 'weapon-form' &&
    currentScene !== 'backpack-form' &&
    currentScene !== 'wearable-form'
  );
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
  let propPrefabs: PropPrefabOption[] = [];
  let itemPrefabs: ItemPrefabOption[] = [];
  let editingShipId: string | null = null;
  let editingPropId: string | null = null;
  let editingItemId: string | null = null;
  let editingWeaponId: string | null = null;
  let editingBackpackId: string | null = null;
  let editingWearableId: string | null = null;
  let selectedUserId: string | null = null;

  function setStatus(message: string, isError = false): void {
    const status = shell.querySelector<HTMLElement>('[data-admin-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function ensureLayout(): void {
    if (shell.querySelector('.sc-admin-layout')) return;

    shell.replaceChildren();
    const layout = document.createElement('div');
    layout.className = 'sc-admin-layout';

    const sidebar = document.createElement('aside');
    sidebar.className = 'sc-admin-sidebar';

    const main = document.createElement('main');
    main.className = 'sc-admin-main';

    const content = document.createElement('div');
    content.className = 'sc-admin-content';

    main.append(content);
    layout.append(sidebar, main);
    shell.append(layout);
  }

  function renderSidebar(): void {
    const sidebar = shell.querySelector('.sc-admin-sidebar');
    if (!sidebar || !session) return;

    sidebar.replaceChildren();

    const brand = document.createElement('div');
    brand.className = 'sc-admin-sidebar-brand';

    const brandMark = document.createElement('div');
    brandMark.className = 'sc-admin-sidebar-brand-mark';
    brandMark.setAttribute('aria-hidden', 'true');

    const brandText = document.createElement('div');
    brandText.className = 'sc-admin-sidebar-brand-text';

    const brandTitle = document.createElement('div');
    brandTitle.className = 'sc-admin-sidebar-brand-title';
    brandTitle.textContent = 'ClaudeCitizen';

    const brandSub = document.createElement('div');
    brandSub.className = 'sc-admin-sidebar-subtitle';
    brandSub.textContent = 'Operator Console';

    brandText.append(brandTitle, brandSub);
    brand.append(brandMark, brandText);

    const nav = document.createElement('nav');
    nav.className = 'sc-admin-sidebar-nav';
    nav.setAttribute('aria-label', 'Admin sections');

    const sections: Array<{ heading: string; tabs: Array<{ id: AdminTab; label: string }> }> = [
      {
        heading: 'Intelligence',
        tabs: [{ id: 'users', label: 'Users' }],
      },
      {
        heading: 'Catalog',
        tabs: [
          { id: 'ships', label: 'Ships' },
          { id: 'props', label: 'Props' },
          { id: 'items', label: 'Items' },
          { id: 'weapons', label: 'Weapons' },
          { id: 'backpacks', label: 'Backpacks' },
          { id: 'wearables', label: 'Wearables' },
        ],
      },
      {
        heading: 'Systems',
        tabs: [{ id: 'settings', label: 'Game Settings' }],
      },
    ];

    for (const section of sections) {
      const heading = document.createElement('div');
      heading.className = 'sc-admin-sidebar-section';
      heading.textContent = section.heading;
      nav.append(heading);

      for (const tab of section.tabs) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'sc-admin-sidebar-link';
        link.textContent = tab.label;
        link.classList.toggle('is-active', isTabActive(tab.id, currentTab, currentScene));
        link.addEventListener('click', () => {
          currentTab = tab.id;
          if (tab.id === 'users') void showUsers();
          else if (tab.id === 'ships') void showShips();
          else if (tab.id === 'props') void showProps();
          else if (tab.id === 'items') void showItems();
          else if (tab.id === 'weapons') void showWeapons();
          else if (tab.id === 'backpacks') void showBackpacks();
          else if (tab.id === 'wearables') void showWearables();
          else void showSettings();
        });
        nav.append(link);
      }
    }

    const footer = document.createElement('div');
    footer.className = 'sc-admin-sidebar-footer';

    const sessionLabel = document.createElement('div');
    sessionLabel.className = 'sc-admin-sidebar-session';
    sessionLabel.textContent = session.email;

    const logoutBtn = createButton('Log out', 'secondary');
    logoutBtn.addEventListener('click', () => {
      setStatus('Signing out...');
      adminLogout()
        .catch(() => undefined)
        .finally(() => {
          session = null;
          renderLogin();
        });
    });
    footer.append(sessionLabel, logoutBtn);

    sidebar.append(brand, nav, footer);
  }

  function renderShell(nodes: Node[], scene: AdminScene, tab: AdminTab = currentTab): void {
    currentScene = scene;
    currentTab = tab;

    ensureLayout();
    renderSidebar();

    const content = shell.querySelector('.sc-admin-content');
    if (content) {
      content.replaceChildren(...nodes);
    }
  }

  function renderLogin(message = ''): void {
    session = null;
    shell.replaceChildren();

    const loginWrap = document.createElement('div');
    loginWrap.className = 'sc-admin-login-wrap';

    const card = document.createElement('div');
    card.className = 'sc-admin-login';

    const form = document.createElement('form');
    form.className = 'sc-admin-form';

    const brand = document.createElement('div');
    brand.className = 'sc-admin-login-brand';
    brand.textContent = 'ClaudeCitizen';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'sc-admin-login-eyebrow';
    eyebrow.textContent = 'Restricted Access';

    const title = document.createElement('h1');
    title.textContent = 'Operator Login';

    const tag = document.createElement('p');
    tag.className = 'sc-admin-login-tag';
    tag.textContent = 'Authenticate to manage catalog and player intelligence.';

    const email = createTextInput('email', 'admin@claude-citizen.com');
    email.type = 'email';
    email.placeholder = 'admin@claude-citizen.com';
    email.required = true;
    email.setAttribute('autocomplete', 'username');

    const password = createTextInput('password');
    password.type = 'password';
    password.required = true;
    password.setAttribute('autocomplete', 'current-password');

    const submit = createButton('Authorize');
    submit.type = 'submit';

    form.append(
      brand,
      eyebrow,
      title,
      tag,
      createField('Email', email),
      createField('Password', password),
      submit,
      renderMessage(message),
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const status = form.querySelector<HTMLElement>('[data-admin-status]');
      if (status) status.textContent = 'Authenticating...';
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

    card.append(form);
    loginWrap.append(card);
    shell.append(loginWrap);
    currentScene = 'login';
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

    if (users.length === 0) {
      const row = document.createElement('tr');
      row.className = 'is-static';
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'sc-admin-empty';
      cell.textContent = 'No users match your search.';
      row.append(cell);
      body.append(row);
    } else {
      for (const user of users) {
        const row = document.createElement('tr');
        row.append(
          createTruncatedCell(user.username, 28, true),
          createTruncatedCell(user.email ?? '—', 32),
          createTruncatedCell(user.displayName, 24),
        );
        const arcCell = document.createElement('td');
        arcCell.textContent = user.player ? formatArc(user.player.arcBalance) : '—';
        const shipsCell = document.createElement('td');
        shipsCell.textContent = String(user.player?.shipCount ?? 0);
        const grantCell = document.createElement('td');
        grantCell.textContent = formatDate(user.player?.starterLoadoutGrantedAt ?? null);
        row.append(arcCell, shipsCell, grantCell);
        row.addEventListener('click', () => {
          selectedUserId = user.id;
          void showUserDetail(user.id);
        });
        body.append(row);
      }
    }

    table.append(body);
    wrap.append(table);
    return wrap;
  }

  function buildUsersListView(allUsers: AdminUserSummary[]): HTMLElement[] {
    let query = '';
    const tableHost = document.createElement('div');

    const refresh = (): void => {
      const normalized = normalizeSearchQuery(query);
      const filtered = normalized
        ? allUsers.filter(
            (user) =>
              user.username.toLowerCase().includes(normalized) ||
              user.displayName.toLowerCase().includes(normalized) ||
              (user.email?.toLowerCase().includes(normalized) ?? false),
          )
        : allUsers;
      tableHost.replaceChildren(renderUsersTable(filtered));
    };

    const search = createSearchInput('Search users…', (value) => {
      query = value;
      refresh();
    });

    refresh();

    return [
      createPageHeader('Users', `${allUsers.length} account${allUsers.length === 1 ? '' : 's'}`),
      createToolbar(search),
      wrapInCard(tableHost),
      renderMessage(''),
    ];
  }

  async function showUsers(): Promise<void> {
    renderShell([renderMessage('Loading users...')], 'users', 'users');
    try {
      const users = await listAdminUsers();
      renderShell(buildUsersListView(users), 'users', 'users');
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          createPageHeader('Users'),
          renderMessage(error instanceof Error ? error.message : 'Failed to load users.', true),
        ],
        'users',
        'users',
      );
    }
  }

  function renderDetailItem(label: string, value: string, truncate = false): HTMLElement {
    const item = document.createElement('div');
    item.className = 'sc-admin-detail-item';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    if (truncate && value.length > 36) {
      dd.textContent = truncateText(value, 36);
      dd.title = value;
      dd.className = 'sc-admin-cell-mono';
    } else {
      dd.textContent = value;
    }
    item.append(dt, dd);
    return item;
  }

  function renderUserDetailView(
    user: AdminUserDetail,
    shipDefinitions: ShipDefinition[],
  ): DocumentFragment {
    const fragment = document.createDocumentFragment();

    const back = createButton('Back to users', 'secondary');
    back.addEventListener('click', () => {
      selectedUserId = null;
      void showUsers();
    });

    const header = createPageHeader(user.displayName, user.email ?? undefined, [back]);

    const grid = document.createElement('dl');
    grid.className = 'sc-admin-detail-grid';
    grid.append(
      renderDetailItem('Username', user.username, true),
      renderDetailItem('Email', user.email ?? '—'),
      renderDetailItem('User ID', user.id, true),
      renderDetailItem('Created', formatDate(user.createdAt)),
    );

    if (user.player) {
      grid.append(
        renderDetailItem('Player handle', user.player.handle, true),
        renderDetailItem('Asteron Reserve Credits (ARC)', formatArc(user.player.arcBalance)),
        renderDetailItem('Starter grant', formatDate(user.player.starterLoadoutGrantedAt)),
        renderDetailItem('Current instance', user.player.currentInstanceId ?? '—', true),
        renderDetailItem('Current room', user.player.currentRoomId ?? '—', true),
      );
    }

    const shipsTitle = document.createElement('h3');
    shipsTitle.className = 'sc-admin-section-title';
    shipsTitle.textContent = 'Owned ships';

    const shipsWrap = document.createElement('div');
    shipsWrap.className = 'sc-admin-table-wrap';

    if (!user.player || user.player.ships.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-admin-empty';
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
        const nameCell = document.createElement('td');
        nameCell.textContent = ship.displayName;
        row.append(
          nameCell,
          createTruncatedCell(ship.prefabId, 24, true),
        );
        const defCell = document.createElement('td');
        defCell.textContent = ship.shipDefinition?.name ?? '—';
        const hpCell = document.createElement('td');
        hpCell.textContent = `${ship.hp.toFixed(0)} / ${ship.maxHp.toFixed(0)}`;
        const shieldCell = document.createElement('td');
        shieldCell.textContent = `${ship.shields.toFixed(0)} / ${ship.maxShields.toFixed(0)}`;
        row.append(defCell, hpCell, shieldCell);
        body.append(row);
      }
      table.append(body);
      shipsWrap.append(table);
    }

    const assignMessage = renderMessage('');
    const assignPanel = document.createElement('div');

    if (!user.player) {
      const note = document.createElement('p');
      note.className = 'sc-admin-meta';
      note.textContent =
        'This account has no player record yet. Bootstrap in-game before assigning ships.';
      assignPanel.append(note);
    } else {
      const ownedDefinitionIds = new Set(
        user.player.ships
          .map((ship) => ship.shipDefinitionId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      );
      const ownedPrefabIds = new Set(user.player.ships.map((ship) => ship.prefabId));
      const available = shipDefinitions.filter(
        (definition) =>
          !ownedDefinitionIds.has(definition.id) && !ownedPrefabIds.has(definition.prefabId),
      );

      const note = document.createElement('p');
      note.className = 'sc-admin-meta';
      note.textContent =
        available.length === 0
          ? shipDefinitions.length === 0
            ? 'No ship definitions in the catalog. Create one under Ships first.'
            : 'Player already owns every catalog ship definition (or matching prefab).'
          : 'Assign a catalog ship definition the player does not already own. The ship is parked in their hangar.';

      const actions = document.createElement('div');
      actions.className = 'sc-admin-actions';
      const select = createSelect(
        'assign-ship',
        available.map((definition) => ({
          value: definition.id,
          label: `${definition.name} (${definition.prefabId})`,
        })),
      );
      const assignBtn = createButton('Assign ship');
      assignBtn.disabled = available.length === 0;
      assignBtn.addEventListener('click', () => {
        const shipDefinitionId = select.value;
        if (!shipDefinitionId) return;
        assignBtn.disabled = true;
        void (async () => {
          try {
            await assignShipToUser(user.id, { shipDefinitionId });
            await showUserDetail(user.id);
          } catch (error) {
            if (error instanceof AdminAuthError) {
              renderLogin(error.message);
              return;
            }
            assignBtn.disabled = available.length === 0;
            assignMessage.textContent =
              error instanceof Error ? error.message : 'Failed to assign ship.';
            assignMessage.classList.add('is-error');
          }
        })();
      });
      actions.append(select, assignBtn);
      assignPanel.append(note, actions);
    }

    fragment.append(
      header,
      wrapInCard(grid),
      shipsTitle,
      wrapInCard(shipsWrap),
      wrapInCard(assignPanel),
      assignMessage,
    );
    return fragment;
  }

  async function showUserDetail(userId: string): Promise<void> {
    renderShell([renderMessage('Loading user...')], 'user-detail', 'users');
    try {
      const [user, shipDefinitions] = await Promise.all([
        getAdminUser(userId),
        listShipDefinitions(),
      ]);
      renderShell([renderUserDetailView(user, shipDefinitions)], 'user-detail', 'users');
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          createPageHeader('User detail'),
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

    if (ships.length === 0) {
      const row = document.createElement('tr');
      row.className = 'is-static';
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'sc-admin-empty';
      cell.textContent = 'No ship definitions match your search.';
      row.append(cell);
      body.append(row);
    } else {
      for (const ship of ships) {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = ship.name;
        row.append(nameCell, createTruncatedCell(ship.prefabId, 24, true));
        const costCell = document.createElement('td');
        costCell.textContent = ship.costArc.toLocaleString();
        const hpCell = document.createElement('td');
        hpCell.textContent = String(ship.maxHp);
        const shieldCell = document.createElement('td');
        shieldCell.textContent = String(ship.maxShields);
        const speedCell = document.createElement('td');
        speedCell.textContent = String(ship.maxSpeedMps);
        const accelCell = document.createElement('td');
        accelCell.textContent = String(ship.throttleAccelMps2);
        row.append(costCell, hpCell, shieldCell, speedCell, accelCell);
        row.addEventListener('click', () => {
          editingShipId = ship.id;
          void showShipForm(ship);
        });
        body.append(row);
      }
    }

    table.append(body);
    wrap.append(table);
    return wrap;
  }

  function buildShipsListView(allShips: ShipDefinition[]): HTMLElement[] {
    let query = '';
    const tableHost = document.createElement('div');

    const refresh = (): void => {
      const normalized = normalizeSearchQuery(query);
      const filtered = normalized
        ? allShips.filter(
            (ship) =>
              ship.name.toLowerCase().includes(normalized) ||
              ship.prefabId.toLowerCase().includes(normalized),
          )
        : allShips;
      tableHost.replaceChildren(renderShipsTable(filtered));
    };

    const createBtn = createButton('Create ship definition');
    createBtn.addEventListener('click', () => {
      editingShipId = null;
      void showShipForm();
    });

    const search = createSearchInput('Search ships…', (value) => {
      query = value;
      refresh();
    });

    refresh();

    return [
      createPageHeader(
        'Ship definitions',
        `${allShips.length} definition${allShips.length === 1 ? '' : 's'}`,
      ),
      createToolbar(search, createBtn),
      wrapInCard(tableHost),
      renderMessage(''),
    ];
  }

  async function showShips(): Promise<void> {
    renderShell([renderMessage('Loading ship catalog...')], 'ships', 'ships');
    try {
      const ships = await listShipDefinitions();
      renderShell(buildShipsListView(ships), 'ships', 'ships');
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          createPageHeader('Ship definitions'),
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

    const back = createButton('Back to ships', 'secondary');
    back.addEventListener('click', () => {
      editingShipId = null;
      void showShips();
    });

    const header = createPageHeader(
      existing ? 'Edit ship definition' : 'Create ship definition',
      existing?.name,
      [back],
    );

    form.append(
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

    renderShell([header, wrapInCard(form)], 'ship-form', 'ships');
  }

  function renderPropsTable(props: PropDefinition[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sc-admin-table-wrap';
    const table = document.createElement('table');
    table.className = 'sc-admin-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th>
          <th>Prefab</th>
          <th>Category</th>
          <th>Cost (ARC)</th>
          <th>Max / space</th>
          <th>Grid</th>
        </tr>
      </thead>
    `;
    const body = document.createElement('tbody');

    if (props.length === 0) {
      const row = document.createElement('tr');
      row.className = 'is-static';
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'sc-admin-empty';
      cell.textContent = 'No prop definitions match your search.';
      row.append(cell);
      body.append(row);
    } else {
      for (const prop of props) {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = prop.name;
        row.append(nameCell, createTruncatedCell(prop.prefabId, 24, true));
        const categoryCell = document.createElement('td');
        categoryCell.textContent = prop.category;
        const costCell = document.createElement('td');
        costCell.textContent = prop.costArc.toLocaleString();
        const maxCell = document.createElement('td');
        maxCell.textContent = prop.maxPerHangar !== null ? String(prop.maxPerHangar) : '—';
        const gridCell = document.createElement('td');
        gridCell.textContent = prop.snapGridM !== null ? String(prop.snapGridM) : 'free';
        row.append(categoryCell, costCell, maxCell, gridCell);
        row.addEventListener('click', () => {
          editingPropId = prop.id;
          void showPropForm(prop);
        });
        body.append(row);
      }
    }

    table.append(body);
    wrap.append(table);
    return wrap;
  }

  function buildPropsListView(allProps: PropDefinition[]): HTMLElement[] {
    let query = '';
    const tableHost = document.createElement('div');

    const refresh = (): void => {
      const normalized = normalizeSearchQuery(query);
      const filtered = normalized
        ? allProps.filter(
            (prop) =>
              prop.name.toLowerCase().includes(normalized) ||
              prop.prefabId.toLowerCase().includes(normalized) ||
              prop.category.toLowerCase().includes(normalized),
          )
        : allProps;
      tableHost.replaceChildren(renderPropsTable(filtered));
    };

    const createBtn = createButton('Create prop definition');
    createBtn.addEventListener('click', () => {
      editingPropId = null;
      void showPropForm();
    });

    const search = createSearchInput('Search props…', (value) => {
      query = value;
      refresh();
    });

    refresh();

    return [
      createPageHeader(
        'Prop definitions',
        `${allProps.length} definition${allProps.length === 1 ? '' : 's'}`,
      ),
      createToolbar(search, createBtn),
      wrapInCard(tableHost),
      renderMessage(''),
    ];
  }

  async function showProps(): Promise<void> {
    renderShell([renderMessage('Loading prop catalog...')], 'props', 'props');
    try {
      const props = await listPropDefinitions();
      renderShell(buildPropsListView(props), 'props', 'props');
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          createPageHeader('Prop definitions'),
          renderMessage(error instanceof Error ? error.message : 'Failed to load props.', true),
        ],
        'props',
        'props',
      );
    }
  }

  async function ensurePropPrefabs(): Promise<PropPrefabOption[]> {
    if (propPrefabs.length > 0) return propPrefabs;
    propPrefabs = await listPropPrefabOptions();
    return propPrefabs;
  }

  function readPropForm(form: HTMLFormElement): PropDefinitionInput {
    const maxPerHangarRaw = formValue(form, 'maxPerHangar');
    const snapGridRaw = formValue(form, 'snapGridM');
    return {
      name: formValue(form, 'name'),
      description: formValue(form, 'description'),
      prefabId: formValue(form, 'prefabId'),
      costArc: Math.round(formNumber(form, 'costArc')),
      category: formValue(form, 'category') || 'decoration',
      maxPerHangar: maxPerHangarRaw ? Math.round(Number(maxPerHangarRaw)) : null,
      allowRotateY: formValue(form, 'allowRotateY') !== 'false',
      snapGridM: snapGridRaw ? Number(snapGridRaw) : null,
    };
  }

  async function showPropForm(existing?: PropDefinition): Promise<void> {
    const prefabs = await ensurePropPrefabs();
    const defaults = existing
      ? {
          name: existing.name,
          description: existing.description,
          prefabId: existing.prefabId,
          costArc: existing.costArc,
          category: existing.category,
          maxPerHangar: existing.maxPerHangar,
          allowRotateY: existing.allowRotateY,
          snapGridM: existing.snapGridM,
        }
      : { ...DEFAULT_PROP_FORM, prefabId: prefabs[0]?.id ?? DEFAULT_PROP_FORM.prefabId };

    const form = document.createElement('form');
    form.className = 'sc-admin-form sc-admin-form-wide';
    const back = createButton('Back to props', 'secondary');
    back.addEventListener('click', () => {
      editingPropId = null;
      void showProps();
    });

    const header = createPageHeader(
      existing ? 'Edit prop definition' : 'Create prop definition',
      existing?.name,
      [back],
    );

    form.append(
      createField('Name', createTextInput('name', defaults.name)),
      createField('Description', createTextArea('description', defaults.description)),
      createField(
        'Prop prefab',
        createSelect(
          'prefabId',
          prefabs.map((prefab) => ({ value: prefab.id, label: `${prefab.label} (${prefab.id})` })),
          defaults.prefabId,
        ),
      ),
      createField('Category', createTextInput('category', defaults.category)),
      createField('Cost (ARC)', createNumberInput('costArc', defaults.costArc)),
      createField(
        'Max per space',
        createNumberInput('maxPerHangar', defaults.maxPerHangar ?? 0),
      ),
      createField(
        'Snap grid (m, 0 = free)',
        createNumberInput('snapGridM', defaults.snapGridM ?? 0, '0.1'),
      ),
      createField(
        'Allow Y rotation',
        createSelect(
          'allowRotateY',
          [
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ],
          defaults.allowRotateY ? 'true' : 'false',
        ),
      ),
    );

    const save = createButton(existing ? 'Save changes' : 'Create definition');
    save.type = 'submit';
    const actions = document.createElement('div');
    actions.className = 'sc-admin-actions';
    actions.append(save);
    form.append(actions, renderMessage(''));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus('Saving prop definition...');
      const payload = readPropForm(form);
      const request = existing
        ? updatePropDefinition(existing.id, payload)
        : createPropDefinition(payload);
      request
        .then(() => {
          editingPropId = null;
          void showProps();
        })
        .catch((error) => {
          setStatus(error instanceof Error ? error.message : 'Save failed.', true);
        });
    });

    renderShell([header, wrapInCard(form)], 'prop-form', 'props');
  }

  function renderItemsTable(items: ItemDefinition[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sc-admin-table-wrap';
    const table = document.createElement('table');
    table.className = 'sc-admin-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Sub-type</th>
          <th>Prefab</th>
          <th>Icon</th>
          <th>Stack max</th>
          <th>Rarity</th>
        </tr>
      </thead>
    `;
    const body = document.createElement('tbody');

    if (items.length === 0) {
      const row = document.createElement('tr');
      row.className = 'is-static';
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'sc-admin-empty';
      cell.textContent = 'No item definitions match your search.';
      row.append(cell);
      body.append(row);
    } else {
      for (const item of items) {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = item.name;
        const typeCell = document.createElement('td');
        typeCell.textContent = item.itemType;
        const subTypeCell = document.createElement('td');
        subTypeCell.textContent = item.subType;
        row.append(nameCell, typeCell, subTypeCell);
        if (item.prefabId) {
          row.append(createTruncatedCell(item.prefabId, 20, true));
        } else {
          const emptyPrefab = document.createElement('td');
          emptyPrefab.textContent = '—';
          row.append(emptyPrefab);
        }
        const iconCell = document.createElement('td');
        iconCell.textContent = item.iconUrl ? 'yes' : '—';
        const stackCell = document.createElement('td');
        stackCell.textContent = String(item.stackMax);
        const rarityCell = document.createElement('td');
        rarityCell.textContent = item.rarity;
        row.append(iconCell, stackCell, rarityCell);
        row.addEventListener('click', () => {
          void routeItemDefinition(item);
        });
        body.append(row);
      }
    }

    table.append(body);
    wrap.append(table);
    return wrap;
  }

  function buildItemsListView(allItems: ItemDefinition[]): HTMLElement[] {
    let query = '';
    const tableHost = document.createElement('div');

    const refresh = (): void => {
      const normalized = normalizeSearchQuery(query);
      const filtered = normalized
        ? allItems.filter(
            (item) =>
              item.name.toLowerCase().includes(normalized) ||
              item.itemType.toLowerCase().includes(normalized) ||
              item.subType.toLowerCase().includes(normalized) ||
              (item.prefabId?.toLowerCase().includes(normalized) ?? false),
          )
        : allItems;
      tableHost.replaceChildren(renderItemsTable(filtered));
    };

    const createBtn = createButton('Create item definition');
    createBtn.addEventListener('click', () => {
      editingItemId = null;
      void showItemForm();
    });

    const search = createSearchInput('Search items…', (value) => {
      query = value;
      refresh();
    });

    refresh();

    return [
      createPageHeader(
        'Item definitions',
        `${allItems.length} definition${allItems.length === 1 ? '' : 's'}`,
      ),
      createToolbar(search, createBtn),
      wrapInCard(tableHost),
      renderMessage(''),
    ];
  }

  async function showItems(): Promise<void> {
    renderShell([renderMessage('Loading item catalog...')], 'items', 'items');
    try {
      const items = await listItemDefinitions();
      renderShell(buildItemsListView(items), 'items', 'items');
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          createPageHeader('Item definitions'),
          renderMessage(error instanceof Error ? error.message : 'Failed to load items.', true),
        ],
        'items',
        'items',
      );
    }
  }

  async function ensureItemPrefabs(): Promise<ItemPrefabOption[]> {
    if (!import.meta.env.DEV && itemPrefabs.length > 0) return itemPrefabs;
    itemPrefabs = await listItemPrefabOptions();
    return itemPrefabs;
  }

  async function routeItemDefinition(item: ItemDefinition): Promise<void> {
    if (item.itemType === 'weapon') {
      const weapon = (await listWeaponDefinitions()).find((entry) => entry.id === item.id);
      if (weapon) {
        editingWeaponId = weapon.id;
        await showWeaponForm(weapon);
        return;
      }
    }
    if (item.itemType === 'backpack') {
      const backpack = (await listBackpackDefinitions()).find((entry) => entry.id === item.id);
      if (backpack) {
        editingBackpackId = backpack.id;
        await showBackpackForm(backpack);
        return;
      }
    }
    if (item.itemType === 'armor' || item.itemType === 'clothing') {
      const wearable = (await listWearableDefinitions()).find((entry) => entry.id === item.id);
      if (wearable) {
        editingWearableId = wearable.id;
        await showWearableForm(wearable);
        return;
      }
    }
    editingItemId = item.id;
    await showItemForm(item);
  }

  function readItemForm(form: HTMLFormElement): ItemDefinitionInput {
    const prefabRaw = formValue(form, 'prefabId');
    const iconRaw = formValue(form, 'iconUrl');
    return {
      name: formValue(form, 'name'),
      description: formValue(form, 'description'),
      itemType: formValue(form, 'itemType') || 'misc',
      subType: formValue(form, 'subType') || 'generic',
      prefabId: prefabRaw ? prefabRaw : null,
      iconUrl: iconRaw ? iconRaw : null,
      stackMax: Math.round(formNumber(form, 'stackMax')),
      costArc: Math.round(formNumber(form, 'costArc')),
      rarity: formValue(form, 'rarity') || 'common',
    };
  }

  async function showItemForm(existing?: ItemDefinition): Promise<void> {
    const prefabs = await ensureItemPrefabs();
    const defaults = existing
      ? {
          name: existing.name,
          description: existing.description,
          itemType: existing.itemType,
          subType: existing.subType,
          prefabId: existing.prefabId,
          iconUrl: existing.iconUrl,
          stackMax: existing.stackMax,
          costArc: existing.costArc,
          rarity: existing.rarity,
        }
      : { ...DEFAULT_ITEM_FORM };

    const form = document.createElement('form');
    form.className = 'sc-admin-form sc-admin-form-wide';
    const back = createButton('Back to items', 'secondary');
    back.addEventListener('click', () => {
      editingItemId = null;
      void showItems();
    });

    const header = createPageHeader(
      existing ? 'Edit item definition' : 'Create item definition',
      existing?.name,
      [back],
    );

    const prefabOptions = [
      { value: '', label: 'None (icon only)' },
      ...prefabs.map((prefab) => ({ value: prefab.id, label: `${prefab.label} (${prefab.id})` })),
    ];

    form.append(
      createField('Name', createTextInput('name', defaults.name)),
      createField('Description', createTextArea('description', defaults.description)),
      createField(
        'Item type',
        createSelect(
          'itemType',
          ITEM_TYPES.filter(
            (type) =>
              type !== 'weapon' &&
              type !== 'backpack' &&
              type !== 'armor' &&
              type !== 'clothing',
          ).map((type) => ({ value: type, label: type })),
          defaults.itemType,
        ),
      ),
      createField('Sub-type', createTextInput('subType', defaults.subType)),
      createField(
        'Item prefab',
        createSelect('prefabId', prefabOptions, defaults.prefabId ?? ''),
      ),
      createIconUrlField(form, defaults.iconUrl ?? '', setStatus),
      createField('Stack max', createNumberInput('stackMax', defaults.stackMax)),
      createField('Cost (ARC)', createNumberInput('costArc', defaults.costArc)),
      createField('Rarity', createTextInput('rarity', defaults.rarity)),
    );

    const save = createButton(existing ? 'Save changes' : 'Create definition');
    save.type = 'submit';
    const actions = document.createElement('div');
    actions.className = 'sc-admin-actions';
    actions.append(save);

    if (existing) {
      const deleteBtn = createButton('Delete definition', 'secondary');
      deleteBtn.addEventListener('click', () => {
        if (!window.confirm(`Delete item "${existing.name}"? This cannot be undone.`)) return;
        setStatus('Deleting item definition...');
        deleteItemDefinition(existing.id)
          .then(() => {
            editingItemId = null;
            void showItems();
          })
          .catch((error) => {
            setStatus(error instanceof Error ? error.message : 'Delete failed.', true);
          });
      });
      actions.append(deleteBtn);
    }

    form.append(actions, renderMessage(''));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus('Saving item definition...');
      const payload = readItemForm(form);
      const request = existing
        ? updateItemDefinition(existing.id, payload)
        : createItemDefinition(payload);
      request
        .then(() => {
          editingItemId = null;
          void showItems();
        })
        .catch((error) => {
          setStatus(error instanceof Error ? error.message : 'Save failed.', true);
        });
    });

    renderShell([header, wrapInCard(form)], 'item-form', 'items');
  }

  function renderWeaponsTable(weapons: WeaponDefinition[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sc-admin-table-wrap';
    const table = document.createElement('table');
    table.className = 'sc-admin-table';
    table.innerHTML = `
      <thead><tr><th>Name</th><th>Slot type</th><th>Sub-type</th><th>Prefab</th><th>Rarity</th></tr></thead>
    `;
    const body = document.createElement('tbody');
    if (weapons.length === 0) {
      const row = document.createElement('tr');
      row.className = 'is-static';
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'sc-admin-empty';
      cell.textContent = 'No weapon definitions match your search.';
      row.append(cell);
      body.append(row);
    }
    for (const weapon of weapons) {
      const row = document.createElement('tr');
      for (const value of [weapon.name, weapon.weaponSlotType, weapon.subType]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      row.append(createTruncatedCell(weapon.prefabId ?? '—', 24, true));
      const rarity = document.createElement('td');
      rarity.textContent = weapon.rarity;
      row.append(rarity);
      row.addEventListener('click', () => {
        editingWeaponId = weapon.id;
        void showWeaponForm(weapon);
      });
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  async function showWeapons(): Promise<void> {
    renderShell([renderMessage('Loading weapon catalog...')], 'weapons', 'weapons');
    try {
      const weapons = await listWeaponDefinitions();
      let query = '';
      const host = document.createElement('div');
      const refresh = (): void => {
        const needle = normalizeSearchQuery(query);
        host.replaceChildren(
          renderWeaponsTable(
            needle
              ? weapons.filter((weapon) =>
                  [weapon.name, weapon.weaponSlotType, weapon.subType, weapon.prefabId ?? ''].some(
                    (value) => value.toLowerCase().includes(needle),
                  ),
                )
              : weapons,
          ),
        );
      };
      const create = createButton('Create weapon definition');
      create.addEventListener('click', () => {
        editingWeaponId = null;
        void showWeaponForm();
      });
      const search = createSearchInput('Search weapons…', (value) => {
        query = value;
        refresh();
      });
      refresh();
      renderShell(
        [
          createPageHeader(
            'Weapon definitions',
            `${weapons.length} definition${weapons.length === 1 ? '' : 's'}`,
          ),
          createToolbar(search, create),
          wrapInCard(host),
          renderMessage(''),
        ],
        'weapons',
        'weapons',
      );
    } catch (error) {
      if (error instanceof AdminAuthError) return renderLogin(error.message);
      renderShell(
        [createPageHeader('Weapon definitions'), renderMessage(error instanceof Error ? error.message : 'Failed to load weapons.', true)],
        'weapons',
        'weapons',
      );
    }
  }

  function readWeaponForm(form: HTMLFormElement): WeaponDefinitionInput {
    const iconUrl = formValue(form, 'iconUrl');
    const weaponSlotTypeRaw = formValue(form, 'weaponSlotType') as WeaponSlotType;
    return {
      name: formValue(form, 'name'),
      description: formValue(form, 'description'),
      subType: formValue(form, 'subType') || 'generic',
      prefabId: formValue(form, 'prefabId'),
      iconUrl: iconUrl || null,
      costArc: Math.round(formNumber(form, 'costArc')),
      rarity: formValue(form, 'rarity') || 'common',
      weaponSlotType: WEAPON_SLOT_TYPES.includes(weaponSlotTypeRaw) ? weaponSlotTypeRaw : 'rifle',
    };
  }

  async function showWeaponForm(existing?: WeaponDefinition): Promise<void> {
    const prefabs = await ensureItemPrefabs();
    const defaults = existing ?? DEFAULT_WEAPON_FORM;
    const form = document.createElement('form');
    form.className = 'sc-admin-form sc-admin-form-wide';
    const back = createButton('Back to weapons', 'secondary');
    back.addEventListener('click', () => {
      editingWeaponId = null;
      void showWeapons();
    });
    const prefabOptions = [
      { value: '', label: 'Select an item prefab' },
      ...prefabs.map((prefab) => ({ value: prefab.id, label: `${prefab.label} (${prefab.id})` })),
    ];
    form.append(
      createField('Name', createTextInput('name', defaults.name)),
      createField('Description', createTextArea('description', defaults.description)),
      createField(
        'Weapon slot type',
        createSelect(
          'weaponSlotType',
          WEAPON_SLOT_TYPES.map((type) => ({ value: type, label: type })),
          defaults.weaponSlotType,
        ),
      ),
      createField('Sub-type', createTextInput('subType', defaults.subType)),
      createField('Item prefab', createSelect('prefabId', prefabOptions, defaults.prefabId ?? undefined)),
      createIconUrlField(form, defaults.iconUrl ?? '', setStatus),
      createField('Cost (ARC)', createNumberInput('costArc', defaults.costArc)),
      createField('Rarity', createTextInput('rarity', defaults.rarity)),
    );
    const actions = document.createElement('div');
    actions.className = 'sc-admin-actions';
    const save = createButton(existing ? 'Save changes' : 'Create definition');
    save.type = 'submit';
    actions.append(save);
    if (existing) {
      const remove = createButton('Delete definition', 'secondary');
      remove.addEventListener('click', () => {
        if (!window.confirm(`Delete weapon "${existing.name}"? This cannot be undone.`)) return;
        setStatus('Deleting weapon definition...');
        deleteWeaponDefinition(existing.id)
          .then(() => {
            editingWeaponId = null;
            void showWeapons();
          })
          .catch((error) => setStatus(error instanceof Error ? error.message : 'Delete failed.', true));
      });
      actions.append(remove);
    }
    form.append(actions, renderMessage(''));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const payload = readWeaponForm(form);
      if (!payload.prefabId) return setStatus('Select an item prefab before saving.', true);
      setStatus('Saving weapon definition...');
      const request = existing
        ? updateWeaponDefinition(existing.id, payload)
        : createWeaponDefinition(payload);
      request
        .then(() => {
          editingWeaponId = null;
          void showWeapons();
        })
        .catch((error) => setStatus(error instanceof Error ? error.message : 'Save failed.', true));
    });
    renderShell(
      [
        createPageHeader(existing ? 'Edit weapon definition' : 'Create weapon definition', existing?.name, [back]),
        wrapInCard(form),
      ],
      'weapon-form',
      'weapons',
    );
  }

  function renderBackpacksTable(backpacks: BackpackDefinition[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sc-admin-table-wrap';
    const table = document.createElement('table');
    table.className = 'sc-admin-table';
    table.innerHTML = `
      <thead><tr><th>Name</th><th>Capacity</th><th>Empty mass</th><th>Sub-type</th><th>Prefab</th></tr></thead>
    `;
    const body = document.createElement('tbody');
    if (backpacks.length === 0) {
      const row = document.createElement('tr');
      row.className = 'is-static';
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'sc-admin-empty';
      cell.textContent = 'No backpack definitions match your search.';
      row.append(cell);
      body.append(row);
    }
    for (const backpack of backpacks) {
      const row = document.createElement('tr');
      const values = [
        backpack.name,
        `${backpack.capacityLiters} L`,
        `${backpack.emptyMassKg} kg`,
        backpack.subType,
      ];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      row.append(createTruncatedCell(backpack.prefabId ?? '—', 24, true));
      row.addEventListener('click', () => {
        editingBackpackId = backpack.id;
        void showBackpackForm(backpack);
      });
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  async function showBackpacks(): Promise<void> {
    renderShell([renderMessage('Loading backpack catalog...')], 'backpacks', 'backpacks');
    try {
      const backpacks = await listBackpackDefinitions();
      let query = '';
      const host = document.createElement('div');
      const refresh = (): void => {
        const needle = normalizeSearchQuery(query);
        host.replaceChildren(
          renderBackpacksTable(
            needle
              ? backpacks.filter((backpack) =>
                  [backpack.name, backpack.subType, backpack.prefabId ?? ''].some((value) =>
                    value.toLowerCase().includes(needle),
                  ),
                )
              : backpacks,
          ),
        );
      };
      const create = createButton('Create backpack definition');
      create.addEventListener('click', () => {
        editingBackpackId = null;
        void showBackpackForm();
      });
      const search = createSearchInput('Search backpacks…', (value) => {
        query = value;
        refresh();
      });
      refresh();
      renderShell(
        [
          createPageHeader(
            'Backpack definitions',
            `${backpacks.length} definition${backpacks.length === 1 ? '' : 's'}`,
          ),
          createToolbar(search, create),
          wrapInCard(host),
          renderMessage(''),
        ],
        'backpacks',
        'backpacks',
      );
    } catch (error) {
      if (error instanceof AdminAuthError) return renderLogin(error.message);
      renderShell(
        [createPageHeader('Backpack definitions'), renderMessage(error instanceof Error ? error.message : 'Failed to load backpacks.', true)],
        'backpacks',
        'backpacks',
      );
    }
  }

  function readBackpackForm(form: HTMLFormElement): BackpackDefinitionInput {
    const iconUrl = formValue(form, 'iconUrl');
    return {
      name: formValue(form, 'name'),
      description: formValue(form, 'description'),
      subType: formValue(form, 'subType') || 'generic',
      prefabId: formValue(form, 'prefabId'),
      iconUrl: iconUrl || null,
      costArc: Math.round(formNumber(form, 'costArc')),
      rarity: formValue(form, 'rarity') || 'common',
      capacityLiters: formNumber(form, 'capacityLiters'),
      emptyMassKg: formNumber(form, 'emptyMassKg'),
    };
  }

  async function showBackpackForm(existing?: BackpackDefinition): Promise<void> {
    const prefabs = await ensureItemPrefabs();
    const defaults = existing ?? DEFAULT_BACKPACK_FORM;
    const form = document.createElement('form');
    form.className = 'sc-admin-form sc-admin-form-wide';
    const back = createButton('Back to backpacks', 'secondary');
    back.addEventListener('click', () => {
      editingBackpackId = null;
      void showBackpacks();
    });
    const prefabOptions = [
      { value: '', label: 'Select an item prefab' },
      ...prefabs.map((prefab) => ({ value: prefab.id, label: `${prefab.label} (${prefab.id})` })),
    ];
    form.append(
      createField('Name', createTextInput('name', defaults.name)),
      createField('Description', createTextArea('description', defaults.description)),
      createField('Sub-type', createTextInput('subType', defaults.subType)),
      createField('Item prefab', createSelect('prefabId', prefabOptions, defaults.prefabId ?? undefined)),
      createField('Capacity (liters)', createNumberInput('capacityLiters', defaults.capacityLiters, '0.1')),
      createField('Empty mass (kg)', createNumberInput('emptyMassKg', defaults.emptyMassKg, '0.1')),
      createIconUrlField(form, defaults.iconUrl ?? '', setStatus),
      createField('Cost (ARC)', createNumberInput('costArc', defaults.costArc)),
      createField('Rarity', createTextInput('rarity', defaults.rarity)),
    );
    const actions = document.createElement('div');
    actions.className = 'sc-admin-actions';
    const save = createButton(existing ? 'Save changes' : 'Create definition');
    save.type = 'submit';
    actions.append(save);
    if (existing) {
      const remove = createButton('Delete definition', 'secondary');
      remove.addEventListener('click', () => {
        if (!window.confirm(`Delete backpack "${existing.name}"? This cannot be undone.`)) return;
        setStatus('Deleting backpack definition...');
        deleteBackpackDefinition(existing.id)
          .then(() => {
            editingBackpackId = null;
            void showBackpacks();
          })
          .catch((error) => setStatus(error instanceof Error ? error.message : 'Delete failed.', true));
      });
      actions.append(remove);
    }
    form.append(actions, renderMessage(''));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void (async () => {
        const payload = readBackpackForm(form);
        if (!payload.prefabId) {
          setStatus('Select an item prefab before saving.', true);
          return;
        }
        setStatus('Validating backpack prefab...');
        const prefab = await loadPrefabDocument(payload.prefabId);
        const errors = prefab
          ? validateBackpackPrefab(prefab)
          : [`Item prefab "${payload.prefabId}" could not be loaded.`];
        if (errors.length > 0) {
          setStatus(`Backpack cannot be saved: ${errors.join(' ')}`, true);
          return;
        }
        setStatus('Saving backpack definition...');
        const request = existing
          ? updateBackpackDefinition(existing.id, payload)
          : createBackpackDefinition(payload);
        await request;
        editingBackpackId = null;
        await showBackpacks();
      })().catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Save failed.', true);
      });
    });
    renderShell(
      [
        createPageHeader(existing ? 'Edit backpack definition' : 'Create backpack definition', existing?.name, [back]),
        wrapInCard(form),
      ],
      'backpack-form',
      'backpacks',
    );
  }

  function renderWearablesTable(wearables: WearableDefinition[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sc-admin-table-wrap';
    const table = document.createElement('table');
    table.className = 'sc-admin-table';
    table.innerHTML = `
      <thead><tr><th>Name</th><th>Type</th><th>Primary slot</th><th>Coverage</th><th>Sidekick preset</th></tr></thead>
    `;
    const body = document.createElement('tbody');
    if (wearables.length === 0) {
      const row = document.createElement('tr');
      row.className = 'is-static';
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'sc-admin-empty';
      cell.textContent = 'No wearable definitions match your search.';
      row.append(cell);
      body.append(row);
    }
    for (const wearable of wearables) {
      const row = document.createElement('tr');
      for (const value of [
        wearable.name,
        wearable.itemType,
        wearable.wearableSlotType,
        wearable.occupiedSlotTypes.join(', '),
        String(wearable.sidekickPartPresetId),
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      row.addEventListener('click', () => {
        editingWearableId = wearable.id;
        void showWearableForm(wearable);
      });
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  async function showWearables(): Promise<void> {
    renderShell([renderMessage('Loading wearable catalog...')], 'wearables', 'wearables');
    try {
      const wearables = await listWearableDefinitions();
      let query = '';
      const host = document.createElement('div');
      const refresh = (): void => {
        const needle = normalizeSearchQuery(query);
        host.replaceChildren(
          renderWearablesTable(
            needle
              ? wearables.filter((wearable) =>
                  [
                    wearable.name,
                    wearable.itemType,
                    wearable.subType,
                    wearable.wearableSlotType,
                    ...wearable.occupiedSlotTypes,
                    String(wearable.sidekickPartPresetId),
                  ].some((value) => value.toLowerCase().includes(needle)),
                )
              : wearables,
          ),
        );
      };
      const create = createButton('Create wearable definition');
      create.addEventListener('click', () => {
        editingWearableId = null;
        void showWearableForm();
      });
      const search = createSearchInput('Search wearables…', (value) => {
        query = value;
        refresh();
      });
      refresh();
      renderShell(
        [
          createPageHeader(
            'Wearable definitions',
            `${wearables.length} definition${wearables.length === 1 ? '' : 's'}`,
          ),
          createToolbar(search, create),
          wrapInCard(host),
          renderMessage(''),
        ],
        'wearables',
        'wearables',
      );
    } catch (error) {
      if (error instanceof AdminAuthError) return renderLogin(error.message);
      renderShell(
        [
          createPageHeader('Wearable definitions'),
          renderMessage(
            error instanceof Error ? error.message : 'Failed to load wearables.',
            true,
          ),
        ],
        'wearables',
        'wearables',
      );
    }
  }

  function readWearableForm(form: HTMLFormElement): WearableDefinitionInput {
    const primaryRaw = formValue(form, 'wearableSlotType') as WearableSlotType;
    const primary = WEARABLE_SLOT_TYPES.includes(primaryRaw) ? primaryRaw : 'torso';
    const checked = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="occupiedSlotTypes"]:checked'),
    )
      .map((input) => input.value as WearableSlotType)
      .filter((slot): slot is WearableSlotType => WEARABLE_SLOT_TYPES.includes(slot));
    const occupiedSlotTypes = [
      primary,
      ...checked.filter((slot) => slot !== primary),
    ];
    const prefabId = formValue(form, 'prefabId');
    const iconUrl = formValue(form, 'iconUrl');
    const itemType = formValue(form, 'itemType');
    return {
      name: formValue(form, 'name'),
      description: formValue(form, 'description'),
      itemType: itemType === 'armor' ? 'armor' : 'clothing',
      subType: formValue(form, 'subType') || 'generic',
      prefabId: prefabId || null,
      iconUrl: iconUrl || null,
      costArc: Math.round(formNumber(form, 'costArc')),
      rarity: formValue(form, 'rarity') || 'common',
      wearableSlotType: primary,
      occupiedSlotTypes,
      sidekickPartPresetId: Math.round(formNumber(form, 'sidekickPartPresetId')),
    };
  }

  async function showWearableForm(existing?: WearableDefinition): Promise<void> {
    const prefabs = await ensureItemPrefabs();
    const defaults = existing ?? DEFAULT_WEARABLE_FORM;
    const form = document.createElement('form');
    form.className = 'sc-admin-form sc-admin-form-wide';
    const back = createButton('Back to wearables', 'secondary');
    back.addEventListener('click', () => {
      editingWearableId = null;
      void showWearables();
    });
    const prefabOptions = [
      { value: '', label: 'No item prefab' },
      ...prefabs.map((prefab) => ({
        value: prefab.id,
        label: `${prefab.label} (${prefab.id})`,
      })),
    ];
    const coverage = document.createElement('div');
    coverage.className = 'sc-admin-check-grid';
    for (const slot of WEARABLE_SLOT_TYPES) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'occupiedSlotTypes';
      input.value = slot;
      input.checked = defaults.occupiedSlotTypes.includes(slot);
      label.append(input, document.createTextNode(` ${slot}`));
      coverage.append(label);
    }
    form.append(
      createField('Name', createTextInput('name', defaults.name)),
      createField('Description', createTextArea('description', defaults.description)),
      createField(
        'Item type',
        createSelect(
          'itemType',
          [
            { value: 'clothing', label: 'Clothing' },
            { value: 'armor', label: 'Armor' },
          ],
          defaults.itemType,
        ),
      ),
      createField(
        'Primary wearable slot',
        createSelect(
          'wearableSlotType',
          WEARABLE_SLOT_TYPES.map((slot) => ({ value: slot, label: slot })),
          defaults.wearableSlotType,
        ),
      ),
      createField('Occupied slots', coverage),
      createField(
        'Sidekick part preset ID',
        createNumberInput('sidekickPartPresetId', defaults.sidekickPartPresetId),
      ),
      createField('Sub-type', createTextInput('subType', defaults.subType)),
      createField(
        'Item prefab (optional)',
        createSelect('prefabId', prefabOptions, defaults.prefabId ?? undefined),
      ),
      createIconUrlField(form, defaults.iconUrl ?? '', setStatus),
      createField('Cost (ARC)', createNumberInput('costArc', defaults.costArc)),
      createField('Rarity', createTextInput('rarity', defaults.rarity)),
    );
    const actions = document.createElement('div');
    actions.className = 'sc-admin-actions';
    const save = createButton(existing ? 'Save changes' : 'Create definition');
    save.type = 'submit';
    actions.append(save);
    if (existing) {
      const remove = createButton('Delete definition', 'secondary');
      remove.addEventListener('click', () => {
        if (!window.confirm(`Delete wearable "${existing.name}"? This cannot be undone.`)) return;
        setStatus('Deleting wearable definition...');
        deleteWearableDefinition(existing.id)
          .then(() => {
            editingWearableId = null;
            void showWearables();
          })
          .catch((error) =>
            setStatus(error instanceof Error ? error.message : 'Delete failed.', true),
          );
      });
      actions.append(remove);
    }
    form.append(actions, renderMessage(''));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const payload = readWearableForm(form);
      if (payload.sidekickPartPresetId <= 0) {
        setStatus('Sidekick preset ID must be positive.', true);
        return;
      }
      setStatus('Saving wearable definition...');
      const request = existing
        ? updateWearableDefinition(existing.id, payload)
        : createWearableDefinition(payload);
      request
        .then(() => {
          editingWearableId = null;
          void showWearables();
        })
        .catch((error) =>
          setStatus(error instanceof Error ? error.message : 'Save failed.', true),
        );
    });
    renderShell(
      [
        createPageHeader(
          existing ? 'Edit wearable definition' : 'Create wearable definition',
          existing?.name,
          [back],
        ),
        wrapInCard(form),
      ],
      'wearable-form',
      'wearables',
    );
  }

  function renderStarterEditor(
    definitions: Array<{ id: string; name: string }>,
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
      const [settings, definitions, propDefinitions, itemDefinitions] = await Promise.all([
        getGameSettings(),
        listShipDefinitions(),
        listPropDefinitions(),
        listItemDefinitions(),
      ]);

      let starterIds = [...settings.starterShipDefinitionIds];
      let starterPropIds = [...settings.starterPropDefinitionIds];
      let starterItemIds = [...settings.starterItemDefinitionIds];
      const form = document.createElement('form');
      form.className = 'sc-admin-form sc-admin-form-wide';

      const header = createPageHeader(
        'Game settings',
        'Configure starting balances and starter loadouts for new players',
      );

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

      const propStarterHost = document.createElement('div');
      const renderPropStarterSection = (): void => {
        propStarterHost.replaceChildren(
          createField(
            'Starter props',
            renderStarterEditor(propDefinitions, starterPropIds, (next) => {
              starterPropIds = next;
              renderPropStarterSection();
            }),
          ),
        );
      };
      renderPropStarterSection();

      const itemStarterHost = document.createElement('div');
      const renderItemStarterSection = (): void => {
        itemStarterHost.replaceChildren(
          createField(
            'Starter items',
            renderStarterEditor(itemDefinitions, starterItemIds, (next) => {
              starterItemIds = next;
              renderItemStarterSection();
            }),
          ),
        );
      };
      renderItemStarterSection();

      const save = createButton('Save settings');
      save.type = 'submit';
      const actions = document.createElement('div');
      actions.className = 'sc-admin-actions';
      actions.append(save);

      form.append(arcField, starterHost, propStarterHost, itemStarterHost, actions, renderMessage(''));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        setStatus('Saving settings...');
        updateGameSettings({
          startingArcBalance: Math.round(formNumber(form, 'startingArcBalance')),
          starterShipDefinitionIds: starterIds,
          starterPropDefinitionIds: starterPropIds,
          starterItemDefinitionIds: starterItemIds,
        })
          .then(() => {
            setStatus('Settings saved.');
          })
          .catch((error) => {
            setStatus(error instanceof Error ? error.message : 'Save failed.', true);
          });
      });

      renderShell([header, wrapInCard(form)], 'settings', 'settings');
    } catch (error) {
      if (error instanceof AdminAuthError) {
        renderLogin(error.message);
        return;
      }
      renderShell(
        [
          createPageHeader('Game settings'),
          renderMessage(error instanceof Error ? error.message : 'Failed to load settings.', true),
        ],
        'settings',
        'settings',
      );
    }
  }

  const loginWrap = document.createElement('div');
  loginWrap.className = 'sc-admin-login-wrap';
  const loadingCard = document.createElement('div');
  loadingCard.className = 'sc-admin-login';
  loadingCard.append(renderMessage('Checking admin session...'));
  loginWrap.append(loadingCard);
  shell.replaceChildren(loginWrap);
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
        } else if (editingPropId) {
          listPropDefinitions()
            .then((props) => {
              const prop = props.find((entry) => entry.id === editingPropId);
              if (prop) void showPropForm(prop);
              else void showProps();
            })
            .catch(() => void showProps());
        } else if (editingItemId) {
          listItemDefinitions()
            .then((items) => {
              const item = items.find((entry) => entry.id === editingItemId);
              if (item) void showItemForm(item);
              else void showItems();
            })
            .catch(() => void showItems());
        } else if (editingWeaponId) {
          listWeaponDefinitions()
            .then((weapons) => {
              const weapon = weapons.find((entry) => entry.id === editingWeaponId);
              if (weapon) void showWeaponForm(weapon);
              else void showWeapons();
            })
            .catch(() => void showWeapons());
        } else if (editingBackpackId) {
          listBackpackDefinitions()
            .then((backpacks) => {
              const backpack = backpacks.find((entry) => entry.id === editingBackpackId);
              if (backpack) void showBackpackForm(backpack);
              else void showBackpacks();
            })
            .catch(() => void showBackpacks());
        } else if (editingWearableId) {
          listWearableDefinitions()
            .then((wearables) => {
              const wearable = wearables.find((entry) => entry.id === editingWearableId);
              if (wearable) void showWearableForm(wearable);
              else void showWearables();
            })
            .catch(() => void showWearables());
        } else if (currentTab === 'ships') void showShips();
        else if (currentTab === 'props') void showProps();
        else if (currentTab === 'items') void showItems();
        else if (currentTab === 'weapons') void showWeapons();
        else if (currentTab === 'backpacks') void showBackpacks();
        else if (currentTab === 'wearables') void showWearables();
        else if (currentTab === 'settings') void showSettings();
        else void showUsers();
        return;
      }
      renderLogin();
    })
    .catch(() => renderLogin());
}
