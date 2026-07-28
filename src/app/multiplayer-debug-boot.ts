import { AUTHORING_ENABLED } from '../build-mode';
import { fetchGameBootstrap, getSession, savePlayerCharacter } from '../net/api';
import { setPresenceDriftLogging } from '../net/world-client';
import { DEFAULT_PLAYER_CHARACTER_APPEARANCE } from '../player/character_creator/player-character-appearance';
import type { MultiplayerDebugDescriptor } from '../platform/editor-desktop';
import { setDebugCubeAvatars } from '../render/main/scene/character-avatar-model';

/**
 * Startup hook for a window launched by Debug → Multiplayer….
 *
 * The main process has already signed this instance in to its own cookie jar,
 * so nothing here handles credentials. What is left is the state the arena
 * scene cannot supply: the debug render flags, and a citizen record.
 *
 * Gated on `AUTHORING_ENABLED` so a shipped release tree-shakes the whole path.
 */
export function multiplayerDebugDescriptor(): MultiplayerDebugDescriptor | null {
  if (!AUTHORING_ENABLED) return null;
  return window.claudeCitizenMultiplayerDebug ?? null;
}

/**
 * Fresh accounts have no appearance, and the debug arena authors no
 * character-create scene — without this, `resolveSceneBootstrap` opens the
 * modal character creator in every window and waits for a human that is not
 * coming.
 */
async function ensureCharacterRecord(label: string): Promise<void> {
  const bootstrap = await fetchGameBootstrap();
  if (bootstrap.player.characterAppearance) return;
  await savePlayerCharacter({ ...DEFAULT_PLAYER_CHARACTER_APPEARANCE });
  console.info(`[mp-debug] ${label}: default appearance saved.`);
}

/**
 * Runs between runtime config and `bootGame`. Never throws: a failure here
 * should surface as a logged line in the debug dialog, not a blank window.
 */
export async function prepareMultiplayerDebug(
  descriptor: MultiplayerDebugDescriptor,
): Promise<void> {
  if (descriptor.cubeAvatars) setDebugCubeAvatars(descriptor.cubeColor);
  if (descriptor.logPositionDelta) setPresenceDriftLogging(true);

  const session = await getSession();
  if (!session) {
    console.error(`[mp-debug] ${descriptor.label}: no session — main-process sign-in failed.`);
    return;
  }
  // The player id is the identity that matters: the cell keys entities by it,
  // so two windows reporting the same one means the cookie routing is broken.
  console.info(
    `[mp-debug] ${descriptor.label}: signed in as ${session.user.username} `
    + `(player ${session.player.id}).`,
  );

  await ensureCharacterRecord(descriptor.label);
  console.info(`[mp-debug] ${descriptor.label}: entering scene:${descriptor.sceneId}.`);
}
