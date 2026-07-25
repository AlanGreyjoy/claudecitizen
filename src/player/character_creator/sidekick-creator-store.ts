import {
  CharacterPartType,
  SIDEKICK_PART_GROUPS,
  type SidekickCatalog,
  type SidekickManifestBodyShapePreset,
  type SidekickManifestColorPreset,
  type SidekickManifestPart,
  type SidekickManifestPartPreset,
} from './sidekick-manifest';
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
} from './sidekick-catalog';
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
} from './sidekick-definition';

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

interface StoreContext {
  catalog: SidekickCatalog;
  rng: () => number;
  listeners: Set<(state: SidekickCreatorState) => void>;
  state: SidekickCreatorState;
}

function enforceWrap(
  ctx: StoreContext,
  definition: SidekickCharacterDefinitionV2,
): SidekickCharacterDefinitionV2 {
  const torsoName = getDefinitionPartName(definition, CharacterPartType.Torso);
  const torso = torsoName ? getPartByName(ctx.catalog, torsoName) : null;
  // Sidekick's neutral value sits on the feminine side of the source tool's
  // binary wrap rule. Keep the default wrap mounted at zero, then remove it
  // as soon as the value moves into the masculine range.
  const needsWrap = Boolean(torso?.usesWrap) && definition.blendShapes.bodyTypeValue >= 0;
  if (!needsWrap)
    return setDefinitionPart(definition, CharacterPartType.Wrap, null);
  if (getDefinitionPartName(definition, CharacterPartType.Wrap))
    return definition;
  const wrap = getPartsForSpecies(ctx.catalog, definition.speciesId, CharacterPartType.Wrap)[0];
  return wrap ? setDefinitionPart(definition, CharacterPartType.Wrap, wrap.name) : definition;
}

function emit(
  ctx: StoreContext,
  definition: SidekickCharacterDefinitionV2,
  lastAction: string,
  extras: Partial<SidekickCreatorState> = {},
): void {
  ctx.state = {
    ...ctx.state,
    ...extras,
    definition: enforceWrap(ctx, definition),
    revision: ctx.state.revision + 1,
    lastAction,
  };
  for (const listener of ctx.listeners)
    listener(ctx.state);
}

function selectedPartFilterIds(ctx: StoreContext): Set<number> {
  return new Set(ctx.catalog.partFilters
    .filter((filter) => ctx.state.selectedFilterTerms.has(filter.term))
    .map((filter) => filter.id));
}

function selectedPresetFilterIds(ctx: StoreContext): Set<number> {
  return new Set(ctx.catalog.presetFilters
    .filter((filter) => ctx.state.selectedFilterTerms.has(filter.term))
    .map((filter) => filter.id));
}

function availableParts(ctx: StoreContext, partType: CharacterPartType): SidekickManifestPart[] {
  return getPartsForSpecies(ctx.catalog, ctx.state.definition.speciesId, partType, selectedPartFilterIds(ctx));
}

function randomizeType(
  ctx: StoreContext,
  definition: SidekickCharacterDefinitionV2,
  type: CharacterPartType,
): SidekickCharacterDefinitionV2 {
  if (ctx.state.lockedPartTypes.has(type)) return definition;
  const chosen = pick(availableParts(ctx, type), ctx.rng);
  return chosen ? setDefinitionPart(definition, type, chosen.name) : definition;
}

function applyPreset(
  ctx: StoreContext,
  definition: SidekickCharacterDefinitionV2,
  preset: SidekickManifestPartPreset,
): SidekickCharacterDefinitionV2 {
  let next = definition;
  for (const type of getPartGroupTypes(preset.partGroup)) {
    if (!ctx.state.lockedPartTypes.has(type))
      next = setDefinitionPart(next, type, null);
  }
  for (const part of getPresetParts(ctx.catalog, preset.id)) {
    if (!ctx.state.lockedPartTypes.has(part.type))
      next = setDefinitionPart(next, part.type, part.name);
  }
  return next;
}

function randomizeColorGroup(
  ctx: StoreContext,
  definition: SidekickCharacterDefinitionV2,
  colorGroup: number,
): SidekickCharacterDefinitionV2 {
  const preset = pick(getColorPresets(
    ctx.catalog,
    definition.speciesId,
    colorGroup,
  ), ctx.rng);
  if (!preset) return definition;
  let next = definition;
  for (const row of getColorPresetRows(ctx.catalog, preset.id))
    next = setDefinitionColorRow(next, row);
  return next;
}

function subscribe(
  ctx: StoreContext,
  listener: (state: SidekickCreatorState) => void,
): () => void {
  ctx.listeners.add(listener);
  listener(ctx.state);
  return () => ctx.listeners.delete(listener);
}

function getAvailablePresets(ctx: StoreContext, groupId?: number): SidekickManifestPartPreset[] {
  return getCompletePartPresets(
    ctx.catalog,
    ctx.state.definition.speciesId,
    selectedPresetFilterIds(ctx),
  ).filter((preset) => groupId === undefined || preset.partGroup === groupId);
}

function setSpecies(ctx: StoreContext, speciesId: number): void {
  const species = getPlayableSpecies(ctx.catalog).find((candidate) => candidate.id === speciesId);
  if (!species || species.id === ctx.state.definition.speciesId) return;
  let next = buildDefaultDefinition(ctx.catalog, species);
  for (const selected of ctx.state.definition.parts) {
    const part = getPartByName(ctx.catalog, selected.name);
    if (part && isPartCompatible(ctx.catalog, part, speciesId))
      next = setDefinitionPart(next, selected.partType, selected.name, selected.partVersion);
  }
  next = setDefinitionBody(next, ctx.state.definition.blendShapes);
  next = setDefinitionMaterialEffects(next, ctx.state.definition.materialEffects);
  emit(ctx, next, 'setSpecies');
}

function setPart(ctx: StoreContext, partType: CharacterPartType, partName: string | null): void {
  if (partName && !availableParts(ctx, partType).some((part) => part.name === partName)) return;
  emit(ctx, setDefinitionPart(ctx.state.definition, partType, partName), 'setPart');
}

function cyclePart(ctx: StoreContext, partType: CharacterPartType, direction: -1 | 1): void {
  const parts = availableParts(ctx, partType);
  if (parts.length === 0) return;
  const current = getDefinitionPartName(ctx.state.definition, partType);
  const currentIndex = parts.findIndex((part) => part.name === current);
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : parts.length - 1)
    : (currentIndex + direction + parts.length) % parts.length;
  emit(ctx, setDefinitionPart(ctx.state.definition, partType, parts[nextIndex]?.name ?? null), 'cyclePart');
}

function toggleLock(ctx: StoreContext, partType: CharacterPartType): void {
  const locked = new Set(ctx.state.lockedPartTypes);
  if (locked.has(partType)) locked.delete(partType);
  else locked.add(partType);
  emit(ctx, ctx.state.definition, 'toggleLock', { lockedPartTypes: locked });
}

function setFilterTerm(ctx: StoreContext, term: string, selected: boolean): void {
  const terms = new Set(ctx.state.selectedFilterTerms);
  if (selected) terms.add(term);
  else terms.delete(term);
  emit(ctx, ctx.state.definition, 'setFilter', { selectedFilterTerms: terms });
}

function randomizeGroup(ctx: StoreContext, groupId: number): void {
  let next = ctx.state.definition;
  for (const type of getPartGroupTypes(groupId))
    next = randomizeType(ctx, next, type);
  emit(ctx, next, 'randomizeGroup');
}

function randomizeCharacter(ctx: StoreContext): void {
  let next = ctx.state.definition;
  for (const group of SIDEKICK_PART_GROUPS) {
    const preset = pick(getCompletePartPresets(
      ctx.catalog,
      next.speciesId,
      selectedPresetFilterIds(ctx),
    ).filter((candidate) => candidate.partGroup === group.id), ctx.rng);
    if (preset) next = applyPreset(ctx, next, preset);
    else {
      for (const type of group.types)
        next = randomizeType(ctx, next, type);
    }
  }
  const bodyPreset = pick(ctx.catalog.bodyShapePresets, ctx.rng);
  if (bodyPreset) {
    next = setDefinitionBody(next, {
      bodyTypeValue: bodyPreset.bodyType,
      bodySizeValue: bodyPreset.bodySize,
      muscleValue: bodyPreset.musculature,
    });
  }
  for (let colorGroup = 1; colorGroup <= 5; colorGroup++)
    next = randomizeColorGroup(ctx, next, colorGroup);
  emit(ctx, next, 'randomizeCharacter');
}

function applyPartPreset(ctx: StoreContext, presetId: number): void {
  const preset = getAvailablePresets(ctx).find((candidate) => candidate.id === presetId);
  if (!preset) return;
  emit(ctx, applyPreset(ctx, ctx.state.definition, preset), 'applyPartPreset');
}

function applyBodyPreset(ctx: StoreContext, presetId: number): void {
  const preset: SidekickManifestBodyShapePreset | undefined = ctx.catalog.bodyShapePresets
    .find((candidate) => candidate.id === presetId);
  if (!preset) return;
  emit(ctx, setDefinitionBody(ctx.state.definition, {
    bodyTypeValue: preset.bodyType,
    bodySizeValue: preset.bodySize,
    muscleValue: preset.musculature,
  }), 'applyBodyPreset');
}

function setColorValue(ctx: StoreContext, colorPropertyId: number, color: string): void {
  const existing = ctx.state.definition.colorRows.find((row) => row.colorPropertyId === colorPropertyId);
  if (!existing) return;
  emit(ctx, setDefinitionColorRow(ctx.state.definition, { ...existing, color }), 'setColorValue');
}

function applyColorPreset(ctx: StoreContext, presetId: number): void {
  const preset: SidekickManifestColorPreset | undefined = ctx.catalog.colorPresets
    .find((candidate) => candidate.id === presetId);
  if (!preset) return;
  let next = ctx.state.definition;
  for (const row of getColorPresetRows(ctx.catalog, preset.id))
    next = setDefinitionColorRow(next, row);
  emit(ctx, next, 'applyColorPreset');
}

function resetStore(ctx: StoreContext): void {
  const species = getPlayableSpecies(ctx.catalog)
    .find((candidate) => candidate.id === ctx.state.definition.speciesId) ?? getPlayableSpecies(ctx.catalog)[0];
  if (species)
    emit(ctx, buildDefaultDefinition(ctx.catalog, species), 'reset', { lockedPartTypes: new Set() });
}

export function createSidekickCreatorStore(
  catalog: SidekickCatalog,
  initialDefinition: SidekickCharacterDefinitionV2,
  options: SidekickCreatorOptions = {},
): SidekickCreatorStore {
  const ctx: StoreContext = {
    catalog,
    rng: options.rng ?? Math.random,
    listeners: new Set<(state: SidekickCreatorState) => void>(),
    state: {
      definition: cloneSidekickDefinition(initialDefinition),
      lockedPartTypes: new Set(),
      selectedFilterTerms: new Set(),
      revision: 0,
      lastAction: 'initialize',
    },
  };

  return {
    getState: () => ctx.state,
    subscribe: (listener) => subscribe(ctx, listener),
    getAvailableParts: (partType) => availableParts(ctx, partType),
    getAvailablePresets: (groupId) => getAvailablePresets(ctx, groupId),
    setSpecies: (speciesId) => setSpecies(ctx, speciesId),
    setPart: (partType, partName) => setPart(ctx, partType, partName),
    cyclePart: (partType, direction) => cyclePart(ctx, partType, direction),
    toggleLock: (partType) => toggleLock(ctx, partType),
    setFilterTerm: (term, selected) => setFilterTerm(ctx, term, selected),
    clearFilters: () => emit(ctx, ctx.state.definition, 'clearFilters', { selectedFilterTerms: new Set() }),
    randomizePart: (partType) => emit(ctx, randomizeType(ctx, ctx.state.definition, partType), 'randomizePart'),
    randomizeGroup: (groupId) => randomizeGroup(ctx, groupId),
    randomizeCharacter: () => randomizeCharacter(ctx),
    applyPartPreset: (presetId) => applyPartPreset(ctx, presetId),
    setBody: (values) => emit(ctx, setDefinitionBody(ctx.state.definition, values), 'setBody'),
    applyBodyPreset: (presetId) => applyBodyPreset(ctx, presetId),
    setColorRow: (row) => emit(ctx, setDefinitionColorRow(ctx.state.definition, row), 'setColorRow'),
    setColorValue: (colorPropertyId, color) => setColorValue(ctx, colorPropertyId, color),
    setMaterialEffects: (values) => emit(
      ctx,
      setDefinitionMaterialEffects(ctx.state.definition, values),
      'setMaterialEffects',
    ),
    applyColorPreset: (presetId) => applyColorPreset(ctx, presetId),
    reset: () => resetStore(ctx),
    replaceDefinition: (definition) => emit(ctx, cloneSidekickDefinition(definition), 'replaceDefinition'),
  };
}
