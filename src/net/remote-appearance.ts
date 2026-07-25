import type { NetworkLod } from '../types';
import type { PlayerCharacterAppearanceV1 } from '../player/character_creator/player_character_appearance';

export function resolveSnapshotCharacterAppearance(
  lod: NetworkLod,
  incoming: PlayerCharacterAppearanceV1 | null | undefined,
  previous: PlayerCharacterAppearanceV1 | null,
): PlayerCharacterAppearanceV1 | null {
  return lod === 'marker' && incoming === undefined ? previous : incoming ?? null;
}
