import {
  buildPlayerSidekickDefinition,
  type PlayerCharacterAppearanceV1,
} from '../player/character_creator/player-character-appearance';
import { loadSidekickCatalog } from '../player/character_creator/sidekick-catalog';
import { savePlayerCharacter } from '../net/api';
import {
  createSidekickPreviewStage,
  type SidekickPreviewStage,
} from '../render/characters/sidekick/preview-stage';

export interface StyleControl {
  key: 'headVariant' | 'hairVariant' | 'eyebrowVariant' | 'earVariant' | 'noseVariant' | 'facialHairVariant';
  label: string;
  maximum: number;
  optional?: boolean;
}

export const STYLE_CONTROLS: readonly StyleControl[] = [
  { key: 'headVariant', label: 'Head', maximum: 2 },
  { key: 'hairVariant', label: 'Hair', maximum: 10 },
  { key: 'eyebrowVariant', label: 'Eyebrows', maximum: 10 },
  { key: 'earVariant', label: 'Ears', maximum: 10 },
  { key: 'noseVariant', label: 'Nose', maximum: 11 },
  { key: 'facialHairVariant', label: 'Facial Hair', maximum: 10, optional: true },
];

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, handler: () => void): HTMLButtonElement {
  const node = element('button', undefined, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

export interface CharacterCreationDom {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  animationSelect: HTMLSelectElement;
  status: HTMLDivElement;
  tabPanels: {
    features: HTMLDivElement;
    colors: HTMLDivElement;
    body: HTMLDivElement;
  };
  actions: HTMLElement;
}

export function buildCharacterCreationDom(): CharacterCreationDom {
  const root = element('main', 'character-creation');
  root.dataset.testid = 'character-creation';
  const canvas = element('canvas', 'character-creation__viewport');
  const animationPicker = element('label', 'character-creation__animation');
  animationPicker.append(element('span', undefined, 'Animation'));
  const animationSelect = element('select');
  animationSelect.dataset.testid = 'character-animation-select';
  const loadingAnimation = element('option', undefined, 'Loading animations…');
  loadingAnimation.value = '';
  animationSelect.append(loadingAnimation);
  animationSelect.disabled = true;
  const panel = element('section', 'character-creation__panel');
  const header = element('header', 'character-creation__header');
  header.append(
    element('h1', undefined, 'Create Your Character'),
    element('p', undefined, 'Citizen appearance record'),
  );
  const status = element('div', 'character-creation__status', 'Loading character…');
  status.setAttribute('role', 'status');
  const controls = element('div', 'character-creation__controls');
  const tabs = element('nav', 'character-creation__tabs');
  tabs.setAttribute('aria-label', 'Character customization sections');
  const tabPanels = {
    features: element('div', 'character-creation__tab-panel'),
    colors: element('div', 'character-creation__tab-panel'),
    body: element('div', 'character-creation__tab-panel'),
  } as const;
  const tabButtons = new Map<keyof typeof tabPanels, HTMLButtonElement>();
  const activateTab = (activeTab: keyof typeof tabPanels): void => {
    for (const [key, tabPanel] of Object.entries(tabPanels) as [keyof typeof tabPanels, HTMLDivElement][]) {
      const active = key === activeTab;
      tabPanel.hidden = !active;
      tabButtons.get(key)?.classList.toggle('is-active', active);
      tabButtons.get(key)?.setAttribute('aria-selected', String(active));
      tabButtons.get(key)?.setAttribute('tabindex', active ? '0' : '-1');
    }
  };
  for (const [key, label] of [
    ['features', 'Features'],
    ['colors', 'Colors'],
    ['body', 'Body'],
  ] as const) {
    const tabPanel = tabPanels[key];
    const tabId = `character-creation-tab-${key}`;
    const panelId = `character-creation-panel-${key}`;
    const tab = button(label, () => activateTab(key));
    tab.id = tabId;
    tab.dataset.testid = `character-${key}-tab`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panelId);
    tabPanel.id = panelId;
    tabPanel.setAttribute('role', 'tabpanel');
    tabPanel.setAttribute('aria-labelledby', tabId);
    tabButtons.set(key, tab);
    tabs.append(tab);
  }
  controls.append(tabs, ...Object.values(tabPanels));
  activateTab('features');
  const actions = element('footer', 'character-creation__actions');
  panel.append(header, status, controls, actions);
  root.append(canvas, panel, animationPicker);
  return { root, canvas, animationSelect, status, tabPanels, actions };
}

export interface AppearanceControls {
  getAppearance: () => PlayerCharacterAppearanceV1;
  setAppearance: (next: PlayerCharacterAppearanceV1) => void;
  applyAppearance: () => void;
}

export function mountBodyTypeControls(
  panel: HTMLElement,
  controls: AppearanceControls,
): void {
  const typeSection = element('section', 'character-creation__section');
  typeSection.append(element('h2', undefined, 'Body Type'));
  const typeButtons = element('div', 'character-creation__types');
  const renderTypeButtons = (): void => {
    for (const candidate of [1, 2] as const) {
      const existing = typeButtons.querySelector<HTMLButtonElement>(`[data-type="${candidate}"]`);
      existing?.classList.toggle('is-active', controls.getAppearance().type === candidate);
      existing?.setAttribute('aria-pressed', String(controls.getAppearance().type === candidate));
    }
  };
  for (const candidate of [1, 2] as const) {
    const node = button(`Type ${candidate}`, () => {
      controls.setAppearance({ ...controls.getAppearance(), type: candidate });
      renderTypeButtons();
      controls.applyAppearance();
    });
    node.dataset.type = String(candidate);
    typeButtons.append(node);
  }
  renderTypeButtons();
  typeSection.append(typeButtons);
  panel.append(typeSection);
}

export function mountFeatureStyleControls(
  panel: HTMLElement,
  controls: AppearanceControls,
): void {
  const features = element('section', 'character-creation__section');
  features.append(element('h2', undefined, 'Features'));
  for (const control of STYLE_CONTROLS) {
    const row = element('div', 'character-creation__style-row');
    const value = element('span', 'character-creation__style-value');
    const renderValue = (): void => {
      const current = controls.getAppearance()[control.key];
      value.textContent = current === null ? 'None' : `${current} / ${control.maximum}`;
    };
    const cycle = (direction: -1 | 1): void => {
      const minimum = control.optional ? 0 : 1;
      const current = controls.getAppearance()[control.key] ?? 0;
      const count = control.maximum - minimum + 1;
      const next = minimum + ((current - minimum + direction + count) % count);
      controls.setAppearance({
        ...controls.getAppearance(),
        [control.key]: control.optional && next === 0 ? null : next,
      });
      renderValue();
      controls.applyAppearance();
    };
    const previous = button('‹', () => cycle(-1));
    previous.setAttribute('aria-label', `Previous ${control.label} style`);
    const next = button('›', () => cycle(1));
    next.setAttribute('aria-label', `Next ${control.label} style`);
    row.append(element('span', undefined, control.label), previous, value, next);
    renderValue();
    features.append(row);
  }
  panel.append(features);
}

export function mountColorControls(
  panel: HTMLElement,
  controls: AppearanceControls,
): void {
  const colorSection = element('section', 'character-creation__section');
  colorSection.append(element('h2', undefined, 'Color'));
  for (const colorControl of [
    { key: 'hairColor' as const, label: 'Hair Color', testId: 'character-hair-color' },
    { key: 'eyebrowColor' as const, label: 'Eyebrow Color', testId: 'character-eyebrow-color' },
    { key: 'facialHairColor' as const, label: 'Beard Color', testId: 'character-beard-color' },
    { key: 'eyeColor' as const, label: 'Eye Color', testId: 'character-eye-color' },
  ]) {
    const colorLabel = element('label', 'character-creation__color');
    const colorText = element('span', undefined, colorControl.label);
    const colorValue = element(
      'span',
      'character-creation__color-value',
      `#${controls.getAppearance()[colorControl.key]}`,
    );
    const colorInput = element('input');
    colorInput.type = 'color';
    colorInput.value = `#${controls.getAppearance()[colorControl.key]}`;
    colorInput.dataset.testid = colorControl.testId;
    colorInput.setAttribute('aria-label', colorControl.label);
    colorInput.addEventListener('input', () => {
      controls.setAppearance({
        ...controls.getAppearance(),
        [colorControl.key]: colorInput.value.slice(1).toUpperCase(),
      });
      colorValue.textContent = `#${controls.getAppearance()[colorControl.key]}`;
      controls.applyAppearance();
    });
    colorLabel.append(colorText, colorInput, colorValue);
    colorSection.append(colorLabel);
  }
  panel.append(colorSection);
}

export function mountBodyShapeControls(
  panel: HTMLElement,
  controls: AppearanceControls,
): void {
  const shape = element('section', 'character-creation__section');
  shape.append(element('h2', undefined, 'Body Shape'));
  for (const config of [
    { key: 'bodySizeValue' as const, label: 'Body Size', low: 'Slim', high: 'Heavy' },
    { key: 'muscleValue' as const, label: 'Musculature', low: 'Lean', high: 'Muscular' },
  ]) {
    const label = element('label', 'character-creation__slider');
    const title = element('span', 'character-creation__slider-title');
    const output = element('output', undefined, String(controls.getAppearance()[config.key]));
    title.append(document.createTextNode(config.label), output);
    const input = element('input');
    input.type = 'range';
    input.min = '-100';
    input.max = '100';
    input.step = '1';
    input.value = String(controls.getAppearance()[config.key]);
    input.dataset.testid = `character-${config.key}`;
    input.addEventListener('input', () => {
      controls.setAppearance({ ...controls.getAppearance(), [config.key]: Number(input.value) });
      output.textContent = input.value;
      controls.applyAppearance();
    });
    const legend = element('span', 'character-creation__slider-legend');
    legend.append(element('span', undefined, config.low), element('span', undefined, config.high));
    label.append(title, input, legend);
    shape.append(label);
  }
  panel.append(shape);
}

export function wireCharacterCreationActions(options: {
  actions: HTMLElement;
  getAppearance: () => PlayerCharacterAppearanceV1;
  getStage: () => SidekickPreviewStage | null;
  isStageBusy: () => boolean;
  isSaving: () => boolean;
  setSaving: (saving: boolean) => void;
  setStatus: (message: string, error?: boolean) => void;
  finish: (result: PlayerCharacterAppearanceV1 | null) => void;
}): { save: HTMLButtonElement; back: HTMLButtonElement } {
  const save = button('Save & Continue', () => {
    if (options.isStageBusy() || options.isSaving() || !options.getStage()) return;
    options.setSaving(true);
    save.disabled = true;
    back.disabled = true;
    options.setStatus('Saving citizen record…');
    void savePlayerCharacter(options.getAppearance())
      .then((saved) => options.finish(saved))
      .catch((error: unknown) => {
        options.setSaving(false);
        back.disabled = false;
        save.disabled = options.isStageBusy();
        options.setStatus(error instanceof Error ? error.message : 'Unable to save character.', true);
      });
  });
  save.classList.add('is-primary');
  save.dataset.testid = 'character-save';
  save.disabled = true;
  const back = button('Back', () => options.finish(null));
  back.dataset.testid = 'character-back';
  options.actions.append(back, save);
  return { save, back };
}

export function bootCharacterPreview(options: {
  canvas: HTMLCanvasElement;
  animationSelect: HTMLSelectElement;
  getAppearance: () => PlayerCharacterAppearanceV1;
  setStage: (stage: SidekickPreviewStage) => void;
  setStageBusy: (busy: boolean) => void;
  isSaving: () => boolean;
  save: HTMLButtonElement;
  setStatus: (message: string, error?: boolean) => void;
}): void {
  void loadSidekickCatalog()
    .then(async (catalog) => {
      const definition = buildPlayerSidekickDefinition(catalog, options.getAppearance());
      const stage = await createSidekickPreviewStage(options.canvas, catalog, definition, {
        onAnimationsReady: (clipNames, activeClipName) => {
          options.animationSelect.replaceChildren(...clipNames.map((clipName) => {
            const animationOption = element(
              'option',
              undefined,
              clipName.replaceAll('_', ' '),
            );
            animationOption.value = clipName;
            animationOption.selected = clipName === activeClipName;
            return animationOption;
          }));
          options.animationSelect.disabled = clipNames.length === 0;
          if (clipNames.length === 0) {
            const unavailable = element('option', undefined, 'Animations unavailable');
            unavailable.value = '';
            options.animationSelect.append(unavailable);
          }
        },
        onBusyChange: (busy) => {
          options.setStageBusy(busy);
          options.save.disabled = busy || options.isSaving();
          if (!busy && !options.isSaving()) options.setStatus('Ready');
        },
        onError: (error) => options.setStatus(
          error instanceof Error ? error.message : 'Character preview update failed.',
          true,
        ),
      });
      options.setStage(stage);
    })
    .catch((error: unknown) => {
      options.setStageBusy(true);
      options.save.disabled = true;
      options.setStatus(error instanceof Error ? error.message : 'Character preview failed to load.', true);
    });
}
