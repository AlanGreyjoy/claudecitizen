import './character_creation_screen.css';
import {
  buildPlayerSidekickDefinition,
  clonePlayerCharacterAppearance,
  DEFAULT_PLAYER_CHARACTER_APPEARANCE,
  type PlayerCharacterAppearanceV1,
} from '../player/character_creator/player_character_appearance';
import { loadSidekickCatalog } from '../player/character_creator/sidekick_catalog';
import { savePlayerCharacter } from '../net/api';
import {
  createSidekickPreviewStage,
  type SidekickPreviewStage,
} from '../render/characters/sidekick/preview_stage';

interface StyleControl {
  key: 'headVariant' | 'hairVariant' | 'eyebrowVariant' | 'earVariant' | 'noseVariant' | 'facialHairVariant';
  label: string;
  maximum: number;
  optional?: boolean;
}

const STYLE_CONTROLS: readonly StyleControl[] = [
  { key: 'headVariant', label: 'Head', maximum: 2 },
  { key: 'hairVariant', label: 'Hair', maximum: 10 },
  { key: 'eyebrowVariant', label: 'Eyebrows', maximum: 10 },
  { key: 'earVariant', label: 'Ears', maximum: 10 },
  { key: 'noseVariant', label: 'Nose', maximum: 11 },
  { key: 'facialHairVariant', label: 'Facial Hair', maximum: 10, optional: true },
];

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, handler: () => void): HTMLButtonElement {
  const node = element('button', undefined, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

export function showCharacterCreationScreen(): Promise<PlayerCharacterAppearanceV1 | null> {
  return new Promise((resolve) => {
    let appearance = clonePlayerCharacterAppearance(DEFAULT_PLAYER_CHARACTER_APPEARANCE);
    let stage: SidekickPreviewStage | null = null;
    let stageBusy = true;
    let saving = false;
    let finished = false;

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
    animationSelect.addEventListener('change', () => stage?.setAnimation(animationSelect.value));
    animationPicker.append(animationSelect);
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
    document.body.append(root);

    const setStatus = (message: string, error = false): void => {
      status.textContent = message;
      status.classList.toggle('is-error', error);
      status.hidden = message === 'Ready' && !error;
    };
    const cleanup = (): void => {
      stage?.dispose();
      stage = null;
      root.remove();
    };
    const finish = (result: PlayerCharacterAppearanceV1 | null): void => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(result);
    };

    const save = button('Save & Continue', () => {
      if (stageBusy || saving || !stage) return;
      saving = true;
      save.disabled = true;
      back.disabled = true;
      setStatus('Saving citizen record…');
      void savePlayerCharacter(appearance)
        .then((saved) => finish(saved))
        .catch((error: unknown) => {
          saving = false;
          back.disabled = false;
          save.disabled = stageBusy;
          setStatus(error instanceof Error ? error.message : 'Unable to save character.', true);
        });
    });
    save.classList.add('is-primary');
    save.dataset.testid = 'character-save';
    save.disabled = true;
    const back = button('Back', () => finish(null));
    back.dataset.testid = 'character-back';
    actions.append(back, save);

    const applyAppearance = (): void => {
      if (!stage) return;
      void loadSidekickCatalog()
        .then((catalog) => stage?.setDefinition(buildPlayerSidekickDefinition(catalog, appearance)))
        .catch((error: unknown) => setStatus(
          error instanceof Error ? error.message : 'Unable to update character.',
          true,
        ));
    };

    const typeSection = element('section', 'character-creation__section');
    typeSection.append(element('h2', undefined, 'Body Type'));
    const typeButtons = element('div', 'character-creation__types');
    const renderTypeButtons = (): void => {
      for (const candidate of [1, 2] as const) {
        const existing = typeButtons.querySelector<HTMLButtonElement>(`[data-type="${candidate}"]`);
        existing?.classList.toggle('is-active', appearance.type === candidate);
        existing?.setAttribute('aria-pressed', String(appearance.type === candidate));
      }
    };
    for (const candidate of [1, 2] as const) {
      const node = button(`Type ${candidate}`, () => {
        appearance = { ...appearance, type: candidate };
        renderTypeButtons();
        applyAppearance();
      });
      node.dataset.type = String(candidate);
      typeButtons.append(node);
    }
    renderTypeButtons();
    typeSection.append(typeButtons);
    tabPanels.features.append(typeSection);

    const features = element('section', 'character-creation__section');
    features.append(element('h2', undefined, 'Features'));
    for (const control of STYLE_CONTROLS) {
      const row = element('div', 'character-creation__style-row');
      const value = element('span', 'character-creation__style-value');
      const renderValue = (): void => {
        const current = appearance[control.key];
        value.textContent = current === null ? 'None' : `${current} / ${control.maximum}`;
      };
      const cycle = (direction: -1 | 1): void => {
        const minimum = control.optional ? 0 : 1;
        const current = appearance[control.key] ?? 0;
        const count = control.maximum - minimum + 1;
        const next = minimum + ((current - minimum + direction + count) % count);
        appearance = { ...appearance, [control.key]: control.optional && next === 0 ? null : next };
        renderValue();
        applyAppearance();
      };
      const previous = button('‹', () => cycle(-1));
      previous.setAttribute('aria-label', `Previous ${control.label} style`);
      const next = button('›', () => cycle(1));
      next.setAttribute('aria-label', `Next ${control.label} style`);
      row.append(element('span', undefined, control.label), previous, value, next);
      renderValue();
      features.append(row);
    }
    tabPanels.features.append(features);

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
        `#${appearance[colorControl.key]}`,
      );
      const colorInput = element('input');
      colorInput.type = 'color';
      colorInput.value = `#${appearance[colorControl.key]}`;
      colorInput.dataset.testid = colorControl.testId;
      colorInput.setAttribute('aria-label', colorControl.label);
      colorInput.addEventListener('input', () => {
        appearance = {
          ...appearance,
          [colorControl.key]: colorInput.value.slice(1).toUpperCase(),
        };
        colorValue.textContent = `#${appearance[colorControl.key]}`;
        applyAppearance();
      });
      colorLabel.append(colorText, colorInput, colorValue);
      colorSection.append(colorLabel);
    }
    tabPanels.colors.append(colorSection);

    const shape = element('section', 'character-creation__section');
    shape.append(element('h2', undefined, 'Body Shape'));
    for (const config of [
      { key: 'bodySizeValue' as const, label: 'Body Size', low: 'Slim', high: 'Heavy' },
      { key: 'muscleValue' as const, label: 'Musculature', low: 'Lean', high: 'Muscular' },
    ]) {
      const label = element('label', 'character-creation__slider');
      const title = element('span', 'character-creation__slider-title');
      const output = element('output', undefined, String(appearance[config.key]));
      title.append(document.createTextNode(config.label), output);
      const input = element('input');
      input.type = 'range';
      input.min = '-100';
      input.max = '100';
      input.step = '1';
      input.value = String(appearance[config.key]);
      input.dataset.testid = `character-${config.key}`;
      input.addEventListener('input', () => {
        appearance = { ...appearance, [config.key]: Number(input.value) };
        output.textContent = input.value;
        applyAppearance();
      });
      const legend = element('span', 'character-creation__slider-legend');
      legend.append(element('span', undefined, config.low), element('span', undefined, config.high));
      label.append(title, input, legend);
      shape.append(label);
    }
    tabPanels.body.append(shape);

    void loadSidekickCatalog()
      .then(async (catalog) => {
        const definition = buildPlayerSidekickDefinition(catalog, appearance);
        stage = await createSidekickPreviewStage(canvas, catalog, definition, {
          onAnimationsReady: (clipNames, activeClipName) => {
            animationSelect.replaceChildren(...clipNames.map((clipName) => {
              const animationOption = element(
                'option',
                undefined,
                clipName.replaceAll('_', ' '),
              );
              animationOption.value = clipName;
              animationOption.selected = clipName === activeClipName;
              return animationOption;
            }));
            animationSelect.disabled = clipNames.length === 0;
            if (clipNames.length === 0) {
              const unavailable = element('option', undefined, 'Animations unavailable');
              unavailable.value = '';
              animationSelect.append(unavailable);
            }
          },
          onBusyChange: (busy) => {
            stageBusy = busy;
            save.disabled = busy || saving;
            if (!busy && !saving) setStatus('Ready');
          },
          onError: (error) => setStatus(
            error instanceof Error ? error.message : 'Character preview update failed.',
            true,
          ),
        });
      })
      .catch((error: unknown) => {
        stageBusy = true;
        save.disabled = true;
        setStatus(error instanceof Error ? error.message : 'Character preview failed to load.', true);
      });
  });
}
