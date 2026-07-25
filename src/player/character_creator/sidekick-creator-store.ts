import {
  CharacterPartType,
  SIDEKICK_PART_GROUPS,
  type SidekickCatalog,
  type SidekickManifestBodyShapePreset,
  type SidekickManifestColorPreset,
  type SidekickManifestPart,
  type SidekickManifestPartPreset,
} from './sidekick_manifest';
import {
  buildDefaultDefinition,
  getColorPresetRows,
  getColorPresets,
  getCompletePartPresets,
  getPartByName,
  getPartGroupTypes,
  getPartsForSpecies,
  getPlayableSpecies,
  getPresetParts,
  isPartCompatible,
} from './sidekick_catalog';
import {
  cloneSidekickDefinition,
  getDefinitionPartName,
  setDefinitionBody,
  setDefinitionColorRow,
  setDefinitionMaterialEffects,
  setDefinitionPart,
  type SidekickCharacterDefinitionV2,
  type SidekickSerializedBlendShapes,
  type SidekickSerializedColorRow,
  type SidekickSerializedMaterialEffects,
} from './sidekick_definition';

export interface SidekickCreatorState {
  definition: SidekickCharacterDefinitionV2;
  lockedPartTypes: ReadonlySet<CharacterPartType>;
  selectedFilterTerms: ReadonlySet<string>;
  revision: number;
  lastAction: string;
}

export interface SidekickCreatorStore {
  getState: () => SidekickCreatorState;
  subscribe: (listener: (state: SidekickCreatorState) => void) => () => void;
  getAvailableParts: (partType: CharacterPartType) => SidekickManifestPart[];
  getAvailablePresets: (groupId?: number) => SidekickManifestPartPreset[];
  setSpecies: (speciesId: number) => void;
  setPart: (partType: CharacterPartType, partName: string | null) => void;
  cyclePart: (partType: CharacterPartType, direction: -1 | 1) => void;
  toggleLock: (partType: CharacterPartType) => void;
  setFilterTerm: (term: string, selected: boolean) => void;
  clearFilters: () => void;
  randomizePart: (partType: CharacterPartType) => void;
  randomizeGroup: (groupId: number) => void;
  randomizeCharacter: () => void;
  applyPartPreset: (presetId: number) => void;
  setBody: (values: Partial<SidekickSerializedBlendShapes>) => void;
  applyBodyPreset: (presetId: number) => void;
  setColorRow: (row: SidekickSerializedColorRow) => void;
  setColorValue: (colorPropertyId: number, color: string) => void;
  setMaterialEffects: (values: Partial<SidekickSerializedMaterialEffects>) => void;
  applyColorPreset: (presetId: number) => void;
  reset: () => void;
  replaceDefinition: (definition: SidekickCharacterDefinitionV2) => void;
}

export interface SidekickCreatorOptions {
  rng?: () => number;
}

function pick<T>(values: readonly T[], rng: () => number): T | null {
  if (values.length === 0) return null;
  return values[Math.min(values.length - 1, Math.floor(rng() * values.length))] ?? null;
}

export function createSidekickCreatorStore(
  catalog: SidekickCatalog,
  initialDefinition: SidekickCharacterDefinitionV2,
  options: SidekickCreatorOptions = {},
): SidekickCreatorStore {
  const rng = options.rng ?? Math.random;
  const listeners = new Set<(state: SidekickCreatorState) => void>();
  let state: SidekickCreatorState = {
    definition: cloneSidekickDefinition(initialDefinition),
    lockedPartTypes: new Set(),
    selectedFilterTerms: new Set(),
    revision: 0,
    lastAction: 'initialize',
  };

  const emit = (definition: SidekickCharacterDefinitionV2, lastAction: string, extras: Partial<SidekickCreatorState> = {}): void => {
    state = {
      ...state,
      ...extras,
      definition: enforceWrap(definition),
      revision: state.revision + 1,
      lastAction,
    };
    for (const listener of listeners)
      listener(state);
  };

  const selectedPartFilterIds = (): Set<number> => new Set(catalog.partFilters
    .filter((filter) => state.selectedFilterTerms.has(filter.term))
    .map((filter) => filter.id));

  const selectedPresetFilterIds = (): Set<number> => new Set(catalog.presetFilters
    .filter((filter) => state.selectedFilterTerms.has(filter.term))
    .map((filter) => filter.id));

  const availableParts = (partType: CharacterPartType): SidekickManifestPart[] =>
    getPartsForSpecies(catalog, state.definition.speciesId, partType, selectedPartFilterIds());

  const enforceWrap = (definition: SidekickCharacterDefinitionV2): SidekickCharacterDefinitionV2 => {
    const torsoName = getDefinitionPartName(definition, CharacterPartType.Torso);
    const torso = torsoName ? getPartByName(catalog, torsoName) : null;
    // Sidekick's neutral value sits on the feminine side of the source tool's
    // binary wrap rule. Keep the default wrap mounted at zero, then remove it
    // as soon as the value moves into the masculine range.
    const needsWrap = Boolean(torso?.usesWrap) && definition.blendShapes.bodyTypeValue >= 0;
    if (!needsWrap)
      return setDefinitionPart(definition, CharacterPartType.Wrap, null);
    if (getDefinitionPartName(definition, CharacterPartType.Wrap))
      return definition;
    const wrap = getPartsForSpecies(catalog, definition.speciesId, CharacterPartType.Wrap)[0];
    return wrap ? setDefinitionPart(definition, CharacterPartType.Wrap, wrap.name) : definition;
  };

  const randomizeType = (
    definition: SidekickCharacterDefinitionV2,
    type: CharacterPartType,
  ): SidekickCharacterDefinitionV2 => {
    if (state.lockedPartTypes.has(type)) return definition;
    const chosen = pick(availableParts(type), rng);
    return chosen ? setDefinitionPart(definition, type, chosen.name) : definition;
  };

  const applyPreset = (
    definition: SidekickCharacterDefinitionV2,
    preset: SidekickManifestPartPreset,
  ): SidekickCharacterDefinitionV2 => {
    let next = definition;
    for (const type of getPartGroupTypes(preset.partGroup)) {
      if (!state.lockedPartTypes.has(type))
        next = setDefinitionPart(next, type, null);
    }
    for (const part of getPresetParts(catalog, preset.id)) {
      if (!state.lockedPartTypes.has(part.type))
        next = setDefinitionPart(next, part.type, part.name);
    }
    return next;
  };

  const randomizeColorGroup = (
    definition: SidekickCharacterDefinitionV2,
    colorGroup: number,
  ): SidekickCharacterDefinitionV2 => {
    const preset = pick(getColorPresets(
      catalog,
      definition.speciesId,
      colorGroup,
    ), rng);
    if (!preset) return definition;
    let next = definition;
    for (const row of getColorPresetRows(catalog, preset.id))
      next = setDefinitionColorRow(next, row);
    return next;
  };

  const store: SidekickCreatorStore = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getAvailableParts: availableParts,
    getAvailablePresets: (groupId) => getCompletePartPresets(
      catalog,
      state.definition.speciesId,
      selectedPresetFilterIds(),
    ).filter((preset) => groupId === undefined || preset.partGroup === groupId),
    setSpecies: (speciesId) => {
      const species = getPlayableSpecies(catalog).find((candidate) => candidate.id === speciesId);
      if (!species || species.id === state.definition.speciesId) return;
      let next = buildDefaultDefinition(catalog, species);
      for (const selected of state.definition.parts) {
        const part = getPartByName(catalog, selected.name);
        if (part && isPartCompatible(catalog, part, speciesId))
          next = setDefinitionPart(next, selected.partType, selected.name, selected.partVersion);
      }
      next = setDefinitionBody(next, state.definition.blendShapes);
      next = setDefinitionMaterialEffects(next, state.definition.materialEffects);
      emit(next, 'setSpecies');
    },
    setPart: (partType, partName) => {
      if (partName && !availableParts(partType).some((part) => part.name === partName)) return;
      emit(setDefinitionPart(state.definition, partType, partName), 'setPart');
    },
    cyclePart: (partType, direction) => {
      const parts = availableParts(partType);
      if (parts.length === 0) return;
      const current = getDefinitionPartName(state.definition, partType);
      const currentIndex = parts.findIndex((part) => part.name === current);
      const nextIndex = currentIndex < 0
        ? (direction > 0 ? 0 : parts.length - 1)
        : (currentIndex + direction + parts.length) % parts.length;
      emit(setDefinitionPart(state.definition, partType, parts[nextIndex]?.name ?? null), 'cyclePart');
    },
    toggleLock: (partType) => {
      const locked = new Set(state.lockedPartTypes);
      if (locked.has(partType)) locked.delete(partType);
      else locked.add(partType);
      emit(state.definition, 'toggleLock', { lockedPartTypes: locked });
    },
    setFilterTerm: (term, selected) => {
      const terms = new Set(state.selectedFilterTerms);
      if (selected) terms.add(term);
      else terms.delete(term);
      emit(state.definition, 'setFilter', { selectedFilterTerms: terms });
    },
    clearFilters: () => emit(state.definition, 'clearFilters', { selectedFilterTerms: new Set() }),
    randomizePart: (partType) => emit(randomizeType(state.definition, partType), 'randomizePart'),
    randomizeGroup: (groupId) => {
      let next = state.definition;
      for (const type of getPartGroupTypes(groupId))
        next = randomizeType(next, type);
      emit(next, 'randomizeGroup');
    },
    randomizeCharacter: () => {
      let next = state.definition;
      for (const group of SIDEKICK_PART_GROUPS) {
        const preset = pick(getCompletePartPresets(
          catalog,
          next.speciesId,
          selectedPresetFilterIds(),
        ).filter((candidate) => candidate.partGroup === group.id), rng);
        if (preset) next = applyPreset(next, preset);
        else {
          for (const type of group.types)
            next = randomizeType(next, type);
        }
      }
      const bodyPreset = pick(catalog.bodyShapePresets, rng);
      if (bodyPreset) {
        next = setDefinitionBody(next, {
          bodyTypeValue: bodyPreset.bodyType,
          bodySizeValue: bodyPreset.bodySize,
          muscleValue: bodyPreset.musculature,
        });
      }
      for (let colorGroup = 1; colorGroup <= 5; colorGroup++)
        next = randomizeColorGroup(next, colorGroup);
      emit(next, 'randomizeCharacter');
    },
    applyPartPreset: (presetId) => {
      const preset = store.getAvailablePresets().find((candidate) => candidate.id === presetId);
      if (!preset) return;
      emit(applyPreset(state.definition, preset), 'applyPartPreset');
    },
    setBody: (values) => emit(setDefinitionBody(state.definition, values), 'setBody'),
    applyBodyPreset: (presetId) => {
      const preset: SidekickManifestBodyShapePreset | undefined = catalog.bodyShapePresets
        .find((candidate) => candidate.id === presetId);
      if (!preset) return;
      emit(setDefinitionBody(state.definition, {
        bodyTypeValue: preset.bodyType,
        bodySizeValue: preset.bodySize,
        muscleValue: preset.musculature,
      }), 'applyBodyPreset');
    },
    setColorRow: (row) => emit(setDefinitionColorRow(state.definition, row), 'setColorRow'),
    setColorValue: (colorPropertyId, color) => {
      const existing = state.definition.colorRows.find((row) => row.colorPropertyId === colorPropertyId);
      if (!existing) return;
      emit(setDefinitionColorRow(state.definition, { ...existing, color }), 'setColorValue');
    },
    setMaterialEffects: (values) => emit(
      setDefinitionMaterialEffects(state.definition, values),
      'setMaterialEffects',
    ),
    applyColorPreset: (presetId) => {
      const preset: SidekickManifestColorPreset | undefined = catalog.colorPresets
        .find((candidate) => candidate.id === presetId);
      if (!preset) return;
      let next = state.definition;
      for (const row of getColorPresetRows(catalog, preset.id))
        next = setDefinitionColorRow(next, row);
      emit(next, 'applyColorPreset');
    },
    reset: () => {
      const species = getPlayableSpecies(catalog)
        .find((candidate) => candidate.id === state.definition.speciesId) ?? getPlayableSpecies(catalog)[0];
      if (species)
        emit(buildDefaultDefinition(catalog, species), 'reset', { lockedPartTypes: new Set() });
    },
    replaceDefinition: (definition) => emit(cloneSidekickDefinition(definition), 'replaceDefinition'),
  };

  return store;
}
