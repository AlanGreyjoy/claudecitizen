import {
  resolveMenuAdvanceSceneId,
  resolveSceneExitSceneId,
  resolveSceneFlowStep,
  type SceneEntryFlow,
} from '../world/scenes/scene-runtime';
import type { SceneDocument } from '../world/scenes/schema';
import type { SceneUiScreen } from '../world/prefabs/schema';
import type { SceneExitTarget } from '../game/station/scene-exit';
import { fetchGameBootstrap, getSession, type AuthSession } from '../net/api';
import { runtimeConfig } from '../net/runtime-config';

/**
 * The boot scene driver.
 *
 * A `boot` scene never runs gameplay: it reads the authored pipeline off its
 * Game Manager, asks the backend what this player still needs (a session, a
 * character), and hands off to the scene the author named. Keeping the whole
 * decision here means `scene-host` stays a switchboard and the flow order is
 * never spread across `scene.kind` checks.
 */

/** Where a session lost / Esc-to-title should return the player. */
export function bootReturnSceneId(flow: SceneEntryFlow | null): string {
  return flow?.titleSceneId || runtimeConfig().bootScene || 'title';
}

/**
 * Scene id a `scene-exit` actually opens. Tokens like `@space` name a hop on
 * the Game Manager rather than a document, so the exit stays authorable in a
 * prefab that knows nothing about the project's scene list.
 */
export function resolveExitTargetScene(
  target: SceneExitTarget,
  flow: SceneEntryFlow | null,
): string {
  return resolveSceneExitSceneId(target.sceneId, flow);
}

/**
 * Does the next step depend on whether this player has a character?
 *
 * `/game/bootstrap` is a real round trip, so it is only worth making when the
 * answer can change the hop — an author who never set a character-create scene
 * gets sent straight to their starting scene either way.
 */
function needsAppearanceCheck(flow: SceneEntryFlow): boolean {
  if (!flow.characterCreateSceneId) return false;
  return flow.skipTitleWhenSignedIn || !flow.titleSceneId;
}

async function readAppearanceState(
  flow: SceneEntryFlow,
  session: AuthSession | null,
): Promise<boolean | null> {
  if (!session || !needsAppearanceCheck(flow)) return null;
  try {
    const bootstrap = await fetchGameBootstrap();
    return bootstrap.player.characterAppearance !== null;
  } catch (error) {
    // Unreachable backend must not strand the player on the boot scene; the
    // flow falls through to the starting scene exactly as it did before.
    console.warn('AsteronEngine could not read the citizen record for the boot flow.', error);
    return null;
  }
}

export interface RunBootSceneOptions {
  scene: SceneDocument;
  flow: SceneEntryFlow;
  loadScene: (sceneId: string, session?: AuthSession | null) => Promise<void>;
  /** Mounts a UI surface on the boot scene itself (no title scene configured). */
  mountEntryUi: (scene: SceneDocument, screen: SceneUiScreen) => Promise<void>;
  resumeSceneId: string | null;
  onResumeConsumed: () => void;
  disposed: () => boolean;
}

/** Load the hop the flow chose, showing the authored loading scene first. */
async function loadFlowTarget(
  options: RunBootSceneOptions,
  sceneId: string,
  session: AuthSession | null,
): Promise<void> {
  if (options.flow.loadingSceneId && options.flow.loadingSceneId !== sceneId) {
    await options.loadScene(options.flow.loadingSceneId);
    if (options.disposed()) return;
  }
  await options.loadScene(sceneId, session);
}

/** Resolve the authored pipeline and hand off. Never starts gameplay itself. */
export async function runBootScene(options: RunBootSceneOptions): Promise<void> {
  const { flow, scene } = options;
  const session = flow.requireAuth ? await getSession() : null;
  if (options.disposed()) return;

  const hasAppearance = await readAppearanceState(flow, session);
  if (options.disposed()) return;

  const step = resolveSceneFlowStep({
    flow,
    stage: 'boot',
    signedIn: session !== null,
    hasAppearance,
    resumeSceneId: options.resumeSceneId,
  });

  if (step.kind === 'play' && options.resumeSceneId === step.sceneId) {
    options.onResumeConsumed();
  }

  if (step.kind === 'sign-in' || step.kind === 'character-create') {
    // No scene named for this surface: the boot scene doubles as it, which is
    // the shape a single-scene project ends up with.
    if (!step.sceneId) {
      await options.mountEntryUi(
        scene,
        step.kind === 'sign-in' ? 'title' : 'character-create',
      );
      return;
    }
    await loadFlowTarget(options, step.sceneId, session);
    return;
  }

  if (step.kind === 'play') {
    await loadFlowTarget(options, step.sceneId, session);
    return;
  }

  // Nothing authored to hop to. A boot scene that resolves to nothing renders
  // as a black screen, so name the field instead of failing silently.
  const fallback = resolveMenuAdvanceSceneId(scene);
  if (fallback) {
    await loadFlowTarget(options, fallback, session);
    return;
  }
  console.error(
    `Boot scene "${scene.id}" has no ${step.missing} on its Game Manager and no scene-link to fall back on. `
    + 'Set the Starting Hab (or a Title Scene) in the Game Manager inspector.',
  );
}
