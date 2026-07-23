function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

export interface PlaySessionDom {
  canvas: HTMLCanvasElement;
  fpsEl: HTMLElement;
  chatMessagesEl: HTMLElement;
  chatInputEl: HTMLInputElement;
  debugBtnEl: HTMLButtonElement;
  debugMenuEl: HTMLElement;
  statsPanelEl: HTMLElement;
  tutorialBannerEl: HTMLElement | null;
  promptEl: HTMLElement;
  readoutsEl: HTMLElement;
  statusEl: HTMLElement;
  controlsEl: HTMLElement;
  interactPromptEl: HTMLElement;
  flightReticleEl: HTMLElement;
  weaponCrosshairEl: HTMLElement;
  combatAmmoEl: HTMLElement;
  cockpitGazeEl: HTMLElement;
  cockpitSpeedEl: HTMLElement;
  survivalVitalsEl: HTMLElement;
  vitalsSyncWarningEl: HTMLElement;
  screenFadeEl: HTMLElement;
  gameMenuEl: HTMLElement;
  gameMenuResumeBtn: HTMLButtonElement;
  gameMenuExitBtn: HTMLButtonElement;
  gameMenuMasterVolume: HTMLInputElement;
  gameMenuSfxVolume: HTMLInputElement;
  gameMenuMusicVolume: HTMLInputElement;
  gameMenuMasterValue: HTMLElement;
  gameMenuSfxValue: HTMLElement;
  gameMenuMusicValue: HTMLElement;
  avmsTerminalEl: HTMLElement;
  avmsShipListEl: HTMLElement;
  avmsDetailNameEl: HTMLElement;
  avmsDetailPrefabEl: HTMLElement;
  avmsDetailHpBarEl: HTMLElement;
  avmsDetailShieldBarEl: HTMLElement;
  avmsDetailHpValueEl: HTMLElement;
  avmsDetailShieldValueEl: HTMLElement;
  avmsStatusEl: HTMLElement;
  avmsDeliverBtn: HTMLButtonElement;
  avmsStoreBtn: HTMLButtonElement;
  avmsCloseBtn: HTMLButtonElement;
  avmsPowerBtn: HTMLButtonElement;
  buildTerminalEl: HTMLElement;
  buildKickerEl: HTMLElement;
  buildVersionEl: HTMLElement;
  buildPropListEl: HTMLElement;
  buildDetailNameEl: HTMLElement;
  buildDetailMetaEl: HTMLElement;
  buildDetailDescEl: HTMLElement;
  buildDetailQtyEl: HTMLElement;
  buildDetailCostEl: HTMLElement;
  buildStatusEl: HTMLElement;
  buildNoteEl: HTMLElement;
  buildPurchaseBtn: HTMLButtonElement;
  buildPlaceBtn: HTMLButtonElement;
  buildMoveBtn: HTMLButtonElement;
  buildDeleteBtn: HTMLButtonElement;
  buildCloseBtn: HTMLButtonElement;
  halobandEl: HTMLElement;
}

export function collectPlaySessionDom(): PlaySessionDom {
  return {
    canvas: requireElement<HTMLCanvasElement>('view'),
    fpsEl: requireElement<HTMLElement>('hud-fps-value'),
    chatMessagesEl: requireElement<HTMLElement>('hud-chat-messages'),
    chatInputEl: requireElement<HTMLInputElement>('hud-chat-input'),
    debugBtnEl: requireElement<HTMLButtonElement>('hud-debug-btn'),
    debugMenuEl: requireElement<HTMLElement>('hud-debug-menu'),
    statsPanelEl: requireElement<HTMLElement>('hud-stats'),
    tutorialBannerEl: document.getElementById('hud-tutorial-banner'),
    promptEl: requireElement<HTMLElement>('prompt'),
    readoutsEl: requireElement<HTMLElement>('readouts'),
    statusEl: requireElement<HTMLElement>('status'),
    controlsEl: requireElement<HTMLElement>('hud-controls'),
    interactPromptEl: requireElement<HTMLElement>('interact-prompt'),
    flightReticleEl: requireElement<HTMLElement>('flight-reticle'),
    weaponCrosshairEl: requireElement<HTMLElement>('weapon-crosshair'),
    combatAmmoEl: requireElement<HTMLElement>('combat-ammo'),
    cockpitGazeEl: requireElement<HTMLElement>('cockpit-gaze'),
    cockpitSpeedEl: requireElement<HTMLElement>('cockpit-speed'),
    survivalVitalsEl: requireElement<HTMLElement>('survival-vitals'),
    vitalsSyncWarningEl: requireElement<HTMLElement>('vitals-sync-warning'),
    screenFadeEl: requireElement<HTMLElement>('screen-fade'),
    gameMenuEl: requireElement<HTMLElement>('game-menu'),
    gameMenuResumeBtn: requireElement<HTMLButtonElement>('game-menu-resume-btn'),
    gameMenuExitBtn: requireElement<HTMLButtonElement>('game-menu-exit-btn'),
    gameMenuMasterVolume: requireElement<HTMLInputElement>('game-menu-master-volume'),
    gameMenuSfxVolume: requireElement<HTMLInputElement>('game-menu-sfx-volume'),
    gameMenuMusicVolume: requireElement<HTMLInputElement>('game-menu-music-volume'),
    gameMenuMasterValue: requireElement<HTMLElement>('game-menu-master-value'),
    gameMenuSfxValue: requireElement<HTMLElement>('game-menu-sfx-value'),
    gameMenuMusicValue: requireElement<HTMLElement>('game-menu-music-value'),
    avmsTerminalEl: requireElement<HTMLElement>('avms-terminal'),
    avmsShipListEl: requireElement<HTMLElement>('avms-ship-list'),
    avmsDetailNameEl: requireElement<HTMLElement>('avms-detail-name'),
    avmsDetailPrefabEl: requireElement<HTMLElement>('avms-detail-prefab'),
    avmsDetailHpBarEl: requireElement<HTMLElement>('avms-detail-hp-bar'),
    avmsDetailShieldBarEl: requireElement<HTMLElement>('avms-detail-shield-bar'),
    avmsDetailHpValueEl: requireElement<HTMLElement>('avms-detail-hp-value'),
    avmsDetailShieldValueEl: requireElement<HTMLElement>('avms-detail-shield-value'),
    avmsStatusEl: requireElement<HTMLElement>('avms-status'),
    avmsDeliverBtn: requireElement<HTMLButtonElement>('avms-deliver-btn'),
    avmsStoreBtn: requireElement<HTMLButtonElement>('avms-store-btn'),
    avmsCloseBtn: requireElement<HTMLButtonElement>('avms-close-btn'),
    avmsPowerBtn: requireElement<HTMLButtonElement>('avms-power-btn'),
    buildTerminalEl: requireElement<HTMLElement>('build-terminal'),
    buildKickerEl: requireElement<HTMLElement>('build-kicker'),
    buildVersionEl: requireElement<HTMLElement>('build-version'),
    buildPropListEl: requireElement<HTMLElement>('build-prop-list'),
    buildDetailNameEl: requireElement<HTMLElement>('build-detail-name'),
    buildDetailMetaEl: requireElement<HTMLElement>('build-detail-meta'),
    buildDetailDescEl: requireElement<HTMLElement>('build-detail-desc'),
    buildDetailQtyEl: requireElement<HTMLElement>('build-detail-qty'),
    buildDetailCostEl: requireElement<HTMLElement>('build-detail-cost'),
    buildStatusEl: requireElement<HTMLElement>('build-status'),
    buildNoteEl: requireElement<HTMLElement>('build-note'),
    buildPurchaseBtn: requireElement<HTMLButtonElement>('build-purchase-btn'),
    buildPlaceBtn: requireElement<HTMLButtonElement>('build-place-btn'),
    buildMoveBtn: requireElement<HTMLButtonElement>('build-move-btn'),
    buildDeleteBtn: requireElement<HTMLButtonElement>('build-delete-btn'),
    buildCloseBtn: requireElement<HTMLButtonElement>('build-close-btn'),
    halobandEl: requireElement<HTMLElement>('haloband'),
  };
}

export { requireElement };
