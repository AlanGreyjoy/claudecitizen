import './sidekick_creator_ui.css';
import {
  SIDEKICK_PART_GROUPS,
  SidekickColorGroup,
  getPartTypeLabel,
  resolveSidekickUrl,
  type SidekickCatalog,
} from '../player/character_creator/sidekick_manifest';
import {
  getColorPresets,
  getCompletePartPresets,
  getInstalledParts,
  getPlayableSpecies,
  getRelevantColorPropertyIds,
} from '../player/character_creator/sidekick_catalog';
import {
  DEFAULT_SIDEKICK_MATERIAL_EFFECTS,
  getDefinitionPartName,
  parseSidekickDefinition,
  serializeSidekickDefinition,
} from '../player/character_creator/sidekick_definition';
import type { SidekickCreatorState, SidekickCreatorStore } from '../player/character_creator/sidekick_creator_store';
import type { SidekickAvatarDiagnostics } from '../render/characters/sidekick/assemble_avatar';

type CreatorTab = 'presets' | 'parts' | 'body' | 'colors' | 'diagnostics';

export interface SidekickCreatorUiHooks {
  getAvatarDiagnostics: () => SidekickAvatarDiagnostics | null;
  onAnimationChange?: (clipName: string) => void;
  onAnimationRestart?: () => void;
}

export interface SidekickCreatorUi {
  root: HTMLElement;
  setStatus: (message: string, isError?: boolean) => void;
  setAnimations: (clipNames: readonly string[], activeClipName?: string) => void;
  setActiveAnimation: (clipName: string) => void;
  refreshDiagnostics: () => void;
  dispose: () => void;
}

export interface SidekickAnimationPicker {
  setAnimations: (clipNames: readonly string[], activeClipName?: string) => void;
  setActiveAnimation: (clipName: string) => void;
  dispose: () => void;
}

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

function button(label: string, title: string, handler: () => void, testId?: string): HTMLButtonElement {
  const node = element('button', 'sidekick-button', label);
  node.type = 'button';
  node.title = title;
  if (testId) node.dataset.testid = testId;
  node.addEventListener('click', handler);
  return node;
}

function option(value: string, label: string, selected = false): HTMLOptionElement {
  const node = element('option', undefined, label);
  node.value = value;
  node.selected = selected;
  return node;
}

export function createSidekickAnimationPicker(
  onAnimationChange: (clipName: string) => void,
): SidekickAnimationPicker {
  const root = element('div', 'sidekick-preview-animation-picker');
  root.dataset.testid = 'preview-animation-picker';
  const label = element('label', undefined, 'Active animation');
  const select = element('select', 'sidekick-select');
  select.id = 'sidekick-preview-animation-select';
  select.dataset.testid = 'preview-animation-select';
  label.htmlFor = select.id;
  select.append(option('', 'Loading animations…'));
  select.disabled = true;
  select.addEventListener('change', () => onAnimationChange(select.value));
  root.append(label, select);
  document.body.append(root);

  return {
    setAnimations: (clipNames, activeClipName) => {
      select.replaceChildren(...clipNames.map((clipName) => option(
        clipName,
        clipName.replaceAll('_', ' '),
        clipName === activeClipName,
      )));
      select.disabled = clipNames.length === 0;
      if (activeClipName && clipNames.includes(activeClipName))
        select.value = activeClipName;
    },
    setActiveAnimation: (clipName) => {
      if ([...select.options].some((candidate) => candidate.value === clipName))
        select.value = clipName;
    },
    dispose: () => root.remove(),
  };
}

const COLOR_GROUP_LABELS: Record<number, string> = {
  [SidekickColorGroup.Species]: 'Species',
  [SidekickColorGroup.Outfits]: 'Outfits',
  [SidekickColorGroup.Attachments]: 'Attachments',
  [SidekickColorGroup.Materials]: 'Materials',
  [SidekickColorGroup.Elements]: 'Elements',
};

export function createSidekickCreatorUi(
  catalog: SidekickCatalog,
  store: SidekickCreatorStore,
  hooks: SidekickCreatorUiHooks,
): SidekickCreatorUi {
  const root = element('aside', 'sidekick-creator');
  root.dataset.testid = 'sidekick-creator';
  const header = element('header', 'sidekick-creator__header');
  const heading = element('div');
  heading.append(
    element('h1', undefined, 'Character Creator'),
    element('p', undefined, 'Synty Sidekick'),
  );
  const collapse = button('–', 'Collapse creator', () => root.classList.toggle('is-collapsed'));
  collapse.classList.add('sidekick-creator__collapse');
  header.append(heading, collapse);

  const status = element('div', 'sidekick-status', 'Loading character…');
  status.dataset.testid = 'sidekick-status';
  const nav = element('nav', 'sidekick-tabs');
  const content = element('div', 'sidekick-content');
  const footer = element('footer', 'sidekick-footer');
  root.append(header, status, nav, content, footer);
  document.body.append(root);

  let activeTab: CreatorTab = 'presets';
  let currentState = store.getState();
  let statusMessage = 'Ready';
  let statusIsError = false;
  let animationClipNames: string[] = [];
  let activeAnimationName = '';

  const renderAnimationControls = (host: HTMLElement): void => {
    const section = element('section', 'sidekick-section');
    section.append(element('h2', undefined, 'Preview animation'));
    const row = element('div', 'sidekick-animation-row');
    const select = element('select', 'sidekick-select');
    select.dataset.testid = 'animation-select';
    if (animationClipNames.length === 0) {
      select.append(option('', 'Loading animation library…'));
      select.disabled = true;
    } else {
      for (const clipName of animationClipNames)
        select.append(option(clipName, clipName.replaceAll('_', ' '), clipName === activeAnimationName));
      select.addEventListener('change', () => {
        activeAnimationName = select.value;
        hooks.onAnimationChange?.(select.value);
      });
    }
    const restart = button('↻', 'Restart preview animation', () => hooks.onAnimationRestart?.(), 'animation-restart');
    restart.disabled = animationClipNames.length === 0;
    row.append(select, restart);
    section.append(row);
    host.append(section);
  };

  const renderFilters = (host: HTMLElement, state: SidekickCreatorState): void => {
    const installedPartIds = new Set(getInstalledParts(catalog).map((part) => part.id));
    const installedFilterIds = new Set(catalog.partFilterRows
      .filter((row) => installedPartIds.has(row.partId))
      .map((row) => row.filterId));
    const availableTerms = [...new Set(catalog.partFilters
      .filter((filter) => filter.filterType === 1 && installedFilterIds.has(filter.id))
      .map((filter) => filter.term))].sort();
    if (availableTerms.length === 0) return;
    const section = element('section', 'sidekick-section');
    const title = element('div', 'sidekick-section__title');
    title.append(element('h2', undefined, 'Outfit filters'));
    const actions = element('div', 'sidekick-inline-actions');
    actions.append(
      button('All', 'Select every outfit filter', () => {
        for (const term of availableTerms) store.setFilterTerm(term, true);
      }),
      button('None', 'Clear outfit filters', () => store.clearFilters()),
    );
    title.append(actions);
    const chips = element('div', 'sidekick-filter-grid');
    for (const term of availableTerms) {
      const label = element('label', 'sidekick-chip');
      const input = element('input');
      input.type = 'checkbox';
      input.checked = state.selectedFilterTerms.has(term);
      input.addEventListener('change', () => store.setFilterTerm(term, input.checked));
      label.append(input, document.createTextNode(term));
      chips.append(label);
    }
    section.append(title, chips);
    host.append(section);
  };

  const renderPresetTab = (state: SidekickCreatorState): void => {
    renderAnimationControls(content);
    const speciesSection = element('section', 'sidekick-section');
    speciesSection.append(element('h2', undefined, 'Species'));
    const speciesSelect = element('select', 'sidekick-select');
    speciesSelect.dataset.testid = 'species-select';
    for (const species of getPlayableSpecies(catalog))
      speciesSelect.append(option(String(species.id), species.name, species.id === state.definition.speciesId));
    speciesSelect.addEventListener('change', () => store.setSpecies(Number(speciesSelect.value)));
    speciesSection.append(speciesSelect);
    content.append(speciesSection);
    renderFilters(content, state);

    const randomSection = element('section', 'sidekick-section sidekick-randomize');
    randomSection.append(button('✦ Randomize Character', 'Randomize every unlocked part and body shape', () => {
      store.randomizeCharacter();
    }, 'randomize-character'));
    content.append(randomSection);

    const presets = store.getAvailablePresets();
    const presetSection = element('section', 'sidekick-section');
    presetSection.append(element('h2', undefined, 'Part presets'));
    for (const group of SIDEKICK_PART_GROUPS) {
      const row = element('div', 'sidekick-preset-row');
      row.append(element('span', 'sidekick-preset-row__label', group.label));
      const select = element('select', 'sidekick-select');
      const groupPresets = presets.filter((preset) => preset.partGroup === group.id);
      select.append(option('', groupPresets.length ? 'Choose preset…' : 'No complete presets'));
      for (const preset of groupPresets)
        select.append(option(String(preset.id), preset.name));
      select.disabled = groupPresets.length === 0;
      select.addEventListener('change', () => {
        if (select.value) store.applyPartPreset(Number(select.value));
      });
      row.append(select, button('⚄', `Randomize ${group.label}`, () => store.randomizeGroup(group.id)));
      presetSection.append(row);
    }
    content.append(presetSection);

    const bodySection = element('section', 'sidekick-section');
    bodySection.append(element('h2', undefined, 'Body preset'));
    const bodySelect = element('select', 'sidekick-select');
    bodySelect.append(option('', 'Choose body preset…'));
    for (const preset of catalog.bodyShapePresets)
      bodySelect.append(option(String(preset.id), preset.name));
    bodySelect.addEventListener('change', () => {
      if (bodySelect.value) store.applyBodyPreset(Number(bodySelect.value));
    });
    bodySection.append(bodySelect);
    content.append(bodySection);

    const colorSection = element('section', 'sidekick-section');
    colorSection.append(element('h2', undefined, 'Color presets'));
    for (const [groupText, label] of Object.entries(COLOR_GROUP_LABELS)) {
      const presetsForGroup = getColorPresets(catalog, state.definition.speciesId, Number(groupText));
      if (presetsForGroup.length === 0) continue;
      const row = element('div', 'sidekick-preset-row');
      row.append(element('span', 'sidekick-preset-row__label', label));
      const select = element('select', 'sidekick-select');
      select.append(option('', 'Choose colors…'));
      for (const preset of presetsForGroup)
        select.append(option(String(preset.id), preset.name));
      select.addEventListener('change', () => {
        if (select.value) store.applyColorPreset(Number(select.value));
      });
      row.append(select);
      colorSection.append(row);
    }
    content.append(colorSection);
  };

  const renderPartsTab = (state: SidekickCreatorState): void => {
    renderFilters(content, state);
    for (const group of SIDEKICK_PART_GROUPS) {
      const section = element('section', 'sidekick-section sidekick-parts-group');
      const title = element('div', 'sidekick-section__title');
      title.append(element('h2', undefined, group.label));
      title.append(button('⚄ Randomize', `Randomize ${group.label}`, () => store.randomizeGroup(group.id)));
      section.append(title);
      for (const partType of group.types) {
        const parts = store.getAvailableParts(partType);
        const current = getDefinitionPartName(state.definition, partType);
        const row = element('div', 'sidekick-part-row');
        row.dataset.partType = String(partType);
        row.append(element('span', 'sidekick-part-row__label', getPartTypeLabel(partType)));
        const lock = button(
          state.lockedPartTypes.has(partType) ? '🔒' : '🔓',
          state.lockedPartTypes.has(partType) ? 'Unlock randomization' : 'Lock during randomization',
          () => store.toggleLock(partType),
        );
        lock.classList.toggle('is-active', state.lockedPartTypes.has(partType));
        const select = element('input', 'sidekick-select sidekick-part-select');
        select.type = 'search';
        select.placeholder = 'None · search parts…';
        select.value = current ?? '';
        select.dataset.testid = `part-select-${partType}`;
        const list = element('datalist');
        list.id = `sidekick-part-list-${partType}`;
        select.setAttribute('list', list.id);
        for (const part of parts)
          list.append(option(part.name, part.name));
        select.addEventListener('change', () => {
          const match = parts.find((part) => part.name === select.value);
          if (match) store.setPart(partType, match.name);
          else if (!select.value.trim()) store.setPart(partType, null);
          else select.value = current ?? '';
        });
        row.append(
          lock,
          button('×', `Clear ${getPartTypeLabel(partType)}`, () => store.setPart(partType, null)),
          button('‹', `Previous ${getPartTypeLabel(partType)}`, () => store.cyclePart(partType, -1)),
          button('›', `Next ${getPartTypeLabel(partType)}`, () => store.cyclePart(partType, 1), `part-next-${partType}`),
          button('⚄', `Randomize ${getPartTypeLabel(partType)}`, () => store.randomizePart(partType)),
          select,
          list,
        );
        const selectedPart = parts.find((part) => part.name === current);
        const imageUrl = selectedPart?.thumbnailUrl ?? catalog.partImages
          .find((image) => image.partId === selectedPart?.id)?.thumbnailUrl;
        if (imageUrl) {
          const thumbnail = element('img', 'sidekick-part-row__thumb');
          thumbnail.src = resolveSidekickUrl(imageUrl);
          thumbnail.alt = '';
          row.append(thumbnail);
        }
        section.append(row);
      }
      content.append(section);
    }
  };

  const renderBodyTab = (state: SidekickCreatorState): void => {
    const section = element('section', 'sidekick-section sidekick-body');
    const bodySelect = element('select', 'sidekick-select');
    bodySelect.append(option('', 'Body preset…'));
    for (const preset of catalog.bodyShapePresets)
      bodySelect.append(option(String(preset.id), preset.name));
    bodySelect.addEventListener('change', () => {
      if (bodySelect.value) store.applyBodyPreset(Number(bodySelect.value));
    });
    section.append(element('h2', undefined, 'Body Shape'), bodySelect);
    const sliders: Array<{
      key: 'bodyTypeValue' | 'bodySizeValue' | 'muscleValue';
      label: string;
      low: string;
      high: string;
    }> = [
      { key: 'bodyTypeValue', label: 'Body Type', low: 'Masculine', high: 'Feminine' },
      { key: 'bodySizeValue', label: 'Body Size', low: 'Slim', high: 'Heavy' },
      { key: 'muscleValue', label: 'Musculature', low: 'Lean', high: 'Muscular' },
    ];
    for (const slider of sliders) {
      const row = element('label', 'sidekick-slider');
      const value = state.definition.blendShapes[slider.key];
      const title = element('span', 'sidekick-slider__title');
      title.append(document.createTextNode(slider.label), element('output', undefined, String(Math.round(value))));
      const input = element('input');
      input.type = 'range';
      input.min = '-100';
      input.max = '100';
      input.step = '1';
      input.value = String(value);
      input.dataset.testid = `body-${slider.key}`;
      input.addEventListener('input', () => {
        const output = title.querySelector('output');
        if (output) output.textContent = input.value;
      });
      input.addEventListener('change', () => store.setBody({ [slider.key]: Number(input.value) }));
      const legend = element('span', 'sidekick-slider__legend');
      legend.append(element('span', undefined, slider.low), element('span', undefined, slider.high));
      row.append(title, input, legend);
      section.append(row);
    }
    content.append(section);
  };

  const renderColorsTab = (state: SidekickCreatorState): void => {
    const materialSection = element('section', 'sidekick-section sidekick-body');
    const materialTitle = element('div', 'sidekick-section__title');
    materialTitle.append(element('h2', undefined, 'Material effects'));
    const materialActions = element('div', 'sidekick-inline-actions');
    materialActions.append(
      button('Clean', 'Disable dark, dirt, skin tint, and eyeliner effects', () => {
        store.setMaterialEffects({
          darkAmount: 0,
          dirtAmount: 0,
          skinColorAmount: 0,
          eyelinerAmount: 0,
        });
      }),
      button('Unity defaults', 'Restore the material values from the Sidekick Unity scene', () => {
        store.setMaterialEffects({ ...DEFAULT_SIDEKICK_MATERIAL_EFFECTS });
      }),
    );
    materialTitle.append(materialActions);
    materialSection.append(materialTitle);

    const effectSliders: Array<{
      key: 'darkAmount' | 'dirtAmount' | 'skinColorAmount' | 'eyelinerAmount';
      label: string;
    }> = [
      { key: 'darkAmount', label: 'Dark amount' },
      { key: 'dirtAmount', label: 'Dirt amount' },
      { key: 'skinColorAmount', label: 'Skin tint amount' },
      { key: 'eyelinerAmount', label: 'Eyeliner amount' },
    ];
    for (const slider of effectSliders) {
      const row = element('label', 'sidekick-slider');
      const value = state.definition.materialEffects[slider.key];
      const title = element('span', 'sidekick-slider__title');
      title.append(document.createTextNode(slider.label), element('output', undefined, value.toFixed(2)));
      const input = element('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.value = String(value);
      input.dataset.testid = `material-${slider.key}`;
      input.addEventListener('input', () => {
        const output = title.querySelector('output');
        if (output) output.textContent = Number(input.value).toFixed(2);
      });
      input.addEventListener('change', () => {
        store.setMaterialEffects({ [slider.key]: Number(input.value) });
      });
      row.append(title, input);
      materialSection.append(row);
    }

    for (const color of [
      { key: 'dirtColor' as const, label: 'Dirt color' },
      { key: 'skinColor' as const, label: 'Skin tint color' },
    ]) {
      const row = element('label', 'sidekick-color-row');
      row.append(element('span', undefined, color.label));
      const input = element('input');
      input.type = 'color';
      input.value = `#${state.definition.materialEffects[color.key]}`;
      input.addEventListener('change', () => {
        store.setMaterialEffects({ [color.key]: input.value.slice(1).toUpperCase() });
      });
      row.append(input, element('code', undefined, input.value.toUpperCase()));
      materialSection.append(row);
    }
    content.append(materialSection);

    const relevantIds = getRelevantColorPropertyIds(catalog, state.definition);
    for (const [groupText, label] of Object.entries(COLOR_GROUP_LABELS)) {
      const group = Number(groupText);
      const properties = catalog.colorProperties.filter(
        (property) => property.colorGroup === group && relevantIds.has(property.id),
      );
      if (properties.length === 0) continue;
      const section = element('section', 'sidekick-section sidekick-colors');
      const title = element('div', 'sidekick-section__title');
      title.append(element('h2', undefined, label));
      const presets = getColorPresets(catalog, state.definition.speciesId, group);
      if (presets.length) {
        const select = element('select', 'sidekick-select');
        select.append(option('', 'Preset…'));
        for (const preset of presets)
          select.append(option(String(preset.id), preset.name));
        select.addEventListener('change', () => {
          if (select.value) store.applyColorPreset(Number(select.value));
        });
        title.append(select);
      }
      section.append(title);
      for (const property of properties) {
        const colorRow = state.definition.colorRows.find((row) => row.colorPropertyId === property.id);
        if (!colorRow) continue;
        const row = element('label', 'sidekick-color-row');
        row.append(element('span', undefined, property.name));
        const input = element('input');
        input.type = 'color';
        input.value = `#${colorRow.color.replace(/^#/, '').slice(0, 6)}`;
        input.dataset.testid = `color-${property.id}`;
        input.addEventListener('change', () => store.setColorValue(property.id, input.value.slice(1).toUpperCase()));
        row.append(input, element('code', undefined, input.value.toUpperCase()));
        section.append(row);
      }
      content.append(section);
    }
  };

  const renderDiagnosticsTab = (state: SidekickCreatorState): void => {
    const installed = getInstalledParts(catalog);
    const diagnostics = hooks.getAvatarDiagnostics();
    const section = element('section', 'sidekick-section sidekick-diagnostics');
    section.append(element('h2', undefined, 'Runtime diagnostics'));
    const grid = element('dl', 'sidekick-diagnostic-grid');
    const values: Array<[string, string]> = [
      ['Manifest', `v${catalog.schemaVersion ?? 1} · ${catalog.dbVersion?.semanticVersion ?? 'unknown'}`],
      ['Installed parts', String(installed.length)],
      ['Unavailable DB parts', String((catalog.stats?.databaseParts ?? catalog.parts.length) - installed.length)],
      ['Complete presets', String(getCompletePartPresets(catalog, state.definition.speciesId).length)],
      ['Active parts', String(diagnostics?.activeParts ?? state.definition.parts.length)],
      ['Active meshes', String(diagnostics?.activeMeshes ?? '—')],
      ['Cached parts', String(diagnostics?.cachedParts ?? '—')],
      ['Loading parts', String(diagnostics?.loadingParts ?? '—')],
      ['Morph targets', String(diagnostics?.morphTargets.length ?? 0)],
      ['Atlas cells', String(diagnostics?.atlasCells ?? state.definition.colorRows.length)],
      ['Avatar root', diagnostics?.rootId ?? 'loading'],
      ['Last action', state.lastAction],
    ];
    for (const [key, value] of values)
      grid.append(element('dt', undefined, key), element('dd', undefined, value));
    section.append(grid);
    if (diagnostics?.morphTargets.length) {
      const details = element('details');
      details.append(element('summary', undefined, 'Exported morph inventory'));
      details.append(element('pre', undefined, diagnostics.morphTargets.join('\n')));
      section.append(details);
    }
    content.append(section);

    const definitionSection = element('section', 'sidekick-section');
    definitionSection.append(element('h2', undefined, 'Character definition'));
    const textarea = element('textarea', 'sidekick-definition-json');
    textarea.value = serializeSidekickDefinition(state.definition);
    textarea.spellcheck = false;
    textarea.dataset.testid = 'definition-json';
    const actions = element('div', 'sidekick-inline-actions');
    actions.append(
      button('Copy JSON', 'Copy character definition', () => {
        void navigator.clipboard.writeText(textarea.value);
      }),
      button('Import JSON', 'Replace the character with this definition', () => {
        try {
          store.replaceDefinition(parseSidekickDefinition(JSON.parse(textarea.value)));
          setStatus('Definition imported.');
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Definition import failed.', true);
        }
      }),
      button('Reset', 'Reset to species defaults', () => store.reset()),
    );
    definitionSection.append(textarea, actions);
    content.append(definitionSection);
  };

  const render = (state = currentState): void => {
    currentState = state;
    const scrollTop = content.scrollTop;
    nav.replaceChildren();
    const tabs: Array<[CreatorTab, string]> = [
      ['presets', 'Presets'],
      ['parts', 'Parts'],
      ['body', 'Body'],
      ['colors', 'Colors'],
      ['diagnostics', 'Diagnostics'],
    ];
    for (const [id, label] of tabs) {
      const tab = button(label, `${label} controls`, () => {
        activeTab = id;
        render();
      }, `tab-${id}`);
      tab.classList.toggle('is-active', activeTab === id);
      nav.append(tab);
    }
    content.replaceChildren();
    if (activeTab === 'presets') renderPresetTab(state);
    else if (activeTab === 'parts') renderPartsTab(state);
    else if (activeTab === 'body') renderBodyTab(state);
    else if (activeTab === 'colors') renderColorsTab(state);
    else renderDiagnosticsTab(state);
    status.textContent = statusMessage;
    status.classList.toggle('is-error', statusIsError);
    footer.textContent = `${state.definition.parts.length} selected · ${getInstalledParts(catalog).length} installed`;
    content.scrollTop = scrollTop;
  };

  const setStatus = (message: string, isError = false): void => {
    statusMessage = message;
    statusIsError = isError;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  };

  const unsubscribe = store.subscribe((state) => render(state));
  return {
    root,
    setStatus,
    setAnimations: (clipNames, activeClipName) => {
      animationClipNames = [...clipNames];
      activeAnimationName = activeClipName && animationClipNames.includes(activeClipName)
        ? activeClipName
        : animationClipNames[0] ?? '';
      if (activeTab === 'presets') render();
    },
    setActiveAnimation: (clipName) => {
      if (!animationClipNames.includes(clipName)) return;
      activeAnimationName = clipName;
      const select = root.querySelector<HTMLSelectElement>('[data-testid="animation-select"]');
      if (select) select.value = clipName;
    },
    refreshDiagnostics: () => {
      if (activeTab === 'diagnostics') render();
    },
    dispose: () => {
      unsubscribe();
      root.remove();
    },
  };
}
