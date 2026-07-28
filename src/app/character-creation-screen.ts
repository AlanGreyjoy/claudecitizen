import './character-creation-screen.css';
import {
  buildPlayerSidekickDefinition,
  clonePlayerCharacterAppearance,
  DEFAULT_PLAYER_CHARACTER_APPEARANCE,
  type PlayerCharacterAppearanceV1,
} from '../player/character_creator/player-character-appearance';
import { loadSidekickCatalog } from '../player/character_creator/sidekick-catalog';
import type { SidekickPreviewStage } from '../render/characters/sidekick/preview-stage';
import {
  bootCharacterPreview,
  buildCharacterCreationDom,
  mountBodyShapeControls,
  mountBodyTypeControls,
  mountColorControls,
  mountFeatureStyleControls,
  wireCharacterCreationActions,
} from './character-creation-screen-helpers';

function runCharacterCreationScreen(
  resolve: (value: PlayerCharacterAppearanceV1 | null) => void,
): void {
  let appearance = clonePlayerCharacterAppearance(DEFAULT_PLAYER_CHARACTER_APPEARANCE);
  let stage: SidekickPreviewStage | null = null;
  let stageBusy = true;
  let saving = false;
  let finished = false;

  const dom = buildCharacterCreationDom();
  const { root, canvas, animationSelect, status, tabPanels, actions } = dom;
  animationSelect.addEventListener('change', () => stage?.setAnimation(animationSelect.value));
  // Same as title/loading: stay inside `#editor-play-host` during in-editor Play
  // so fixed fullscreen UI cannot cover the toolbar Stop button.
  (document.getElementById('editor-play-host') ?? document.body).append(root);

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

  const { save } = wireCharacterCreationActions({
    actions,
    getAppearance: () => appearance,
    getStage: () => stage,
    isStageBusy: () => stageBusy,
    isSaving: () => saving,
    setSaving: (next) => { saving = next; },
    setStatus,
    finish,
  });

  const applyAppearance = (): void => {
    if (!stage) return;
    void loadSidekickCatalog()
      .then((catalog) => stage?.setDefinition(buildPlayerSidekickDefinition(catalog, appearance)))
      .catch((error: unknown) => setStatus(
        error instanceof Error ? error.message : 'Unable to update character.',
        true,
      ));
  };

  const appearanceControls = {
    getAppearance: () => appearance,
    setAppearance: (next: PlayerCharacterAppearanceV1) => { appearance = next; },
    applyAppearance,
  };
  mountBodyTypeControls(tabPanels.features, appearanceControls);
  mountFeatureStyleControls(tabPanels.features, appearanceControls);
  mountColorControls(tabPanels.colors, appearanceControls);
  mountBodyShapeControls(tabPanels.body, appearanceControls);

  bootCharacterPreview({
    canvas,
    animationSelect,
    getAppearance: () => appearance,
    setStage: (next) => { stage = next; },
    setStageBusy: (busy) => { stageBusy = busy; },
    isSaving: () => saving,
    save,
    setStatus,
  });
}

export function showCharacterCreationScreen(): Promise<PlayerCharacterAppearanceV1 | null> {
  return new Promise((resolve) => {
    runCharacterCreationScreen(resolve);
  });
}
