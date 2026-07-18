import {
  DEFAULT_PLAYER_CHARACTER_APPEARANCE,
  type PlayerCharacterAppearanceV1,
} from '../player/character_creator/player_character_appearance';

export interface NpcDefinition {
  id: string;
  displayNames: readonly string[];
  walkSpeedMetersPerSecond: readonly [min: number, max: number];
  hairColors: readonly string[];
  eyeColors: readonly string[];
}

export interface NpcPopulationEntry {
  npcDefinitionId: string;
  weight: number;
}

export interface NpcPopulationDefinition {
  id: string;
  entries: readonly NpcPopulationEntry[];
}

const DEFINITIONS: Record<string, NpcDefinition> = {
  'station-civilian': {
    id: 'station-civilian',
    displayNames: [
      'Ari Vale',
      'Cora Venn',
      'Dax Mercer',
      'Ilya Rowe',
      'Juno Saye',
      'Mara Kest',
      'Niko Arden',
      'Tess Orin',
    ],
    walkSpeedMetersPerSecond: [1.15, 1.55],
    hairColors: ['26272D', '51372A', '8A684B', 'B9A07C', '15171B'],
    eyeColors: ['503E2B', '58706B', '4A5F7A', '6F5940'],
  },
  'station-staff': {
    id: 'station-staff',
    displayNames: ['Hab Steward', 'Port Coordinator', 'Station Technician'],
    walkSpeedMetersPerSecond: [1.05, 1.35],
    hairColors: ['26272D', '49352C', '83705A'],
    eyeColors: ['503E2B', '58706B', '4A5F7A'],
  },
};

const POPULATIONS: Record<string, NpcPopulationDefinition> = {
  'station-civilians': {
    id: 'station-civilians',
    entries: [
      { npcDefinitionId: 'station-civilian', weight: 0.85 },
      { npcDefinitionId: 'station-staff', weight: 0.15 },
    ],
  },
};

export const DEFAULT_NPC_DEFINITION_ID = 'station-civilian';
export const DEFAULT_NPC_POPULATION_ID = 'station-civilians';

export function hasNpcDefinition(id: string): boolean {
  return Object.hasOwn(DEFINITIONS, id);
}

export function hasNpcPopulation(id: string): boolean {
  return Object.hasOwn(POPULATIONS, id);
}

export function getNpcDefinition(id: string): NpcDefinition {
  return DEFINITIONS[id] ?? DEFINITIONS[DEFAULT_NPC_DEFINITION_ID];
}

export function choosePopulationNpcDefinition(
  populationId: string,
  random01: () => number,
): NpcDefinition {
  const population = POPULATIONS[populationId] ?? POPULATIONS[DEFAULT_NPC_POPULATION_ID];
  const totalWeight = population.entries.reduce(
    (total, entry) => total + Math.max(0, entry.weight),
    0,
  );
  if (totalWeight <= 0) return getNpcDefinition(DEFAULT_NPC_DEFINITION_ID);
  let cursor = random01() * totalWeight;
  for (const entry of population.entries) {
    cursor -= Math.max(0, entry.weight);
    if (cursor <= 0) return getNpcDefinition(entry.npcDefinitionId);
  }
  return getNpcDefinition(population.entries.at(-1)?.npcDefinitionId ?? DEFAULT_NPC_DEFINITION_ID);
}

function choose<T>(values: readonly T[], random01: () => number): T {
  return values[Math.min(values.length - 1, Math.floor(random01() * values.length))];
}

export function createNpcAppearance(
  definition: NpcDefinition,
  random01: () => number,
): PlayerCharacterAppearanceV1 {
  const hairColor = choose(definition.hairColors, random01);
  const eyeColor = choose(definition.eyeColors, random01);
  return {
    ...DEFAULT_PLAYER_CHARACTER_APPEARANCE,
    type: random01() < 0.5 ? 1 : 2,
    hairColor,
    eyebrowColor: hairColor,
    facialHairColor: hairColor,
    eyeColor,
    bodySizeValue: Math.round(-45 + random01() * 90),
    muscleValue: Math.round(-80 + random01() * 115),
  };
}

export function chooseNpcDisplayName(
  definition: NpcDefinition,
  random01: () => number,
): string {
  return choose(definition.displayNames, random01);
}

export function chooseNpcWalkSpeed(
  definition: NpcDefinition,
  random01: () => number,
): number {
  const [min, max] = definition.walkSpeedMetersPerSecond;
  return min + (max - min) * random01();
}
