import type { BuildAreaRuntime } from '../game/types';
import type { BuildArea, GameBootstrap } from '../net/api';
import { createHangarBuildController } from '../player/hangar_build/build_controller';
import {
  createBuildPropColliderRuntime,
  type BuildPropColliderRuntime,
} from '../player/hangar_build/prop_colliders';
import { createHangarPropRenderer, type HangarPropRenderer } from '../render/hangar/prop_instances';
import { createBuildTerminal } from '../render/effects/hud/build_terminal';
import type { BuildTerminalController } from '../render/effects/hud/build_terminal';
import type { SpikeRenderer } from '../render/main';
import type { PlaySessionDom } from './play_session_dom';

export interface PlayBuildSystems {
  buildAreas: Partial<Record<BuildArea, BuildAreaRuntime>>;
  buildPropRenderers: HangarPropRenderer[];
  buildPropColliders: BuildPropColliderRuntime[];
  buildTerminal: BuildTerminalController | null;
}

export function createPlayBuildSystems(options: {
  bootstrap: GameBootstrap;
  renderer: SpikeRenderer;
  dom: PlaySessionDom;
  onArcBalanceChange: (balance: number) => void;
}): PlayBuildSystems {
  const { bootstrap, renderer, dom, onArcBalanceChange } = options;
  const buildAreas: Partial<Record<BuildArea, BuildAreaRuntime>> = {};
  const buildPropRenderers: HangarPropRenderer[] = [];
  const buildPropColliders: BuildPropColliderRuntime[] = [];

  const createBuildRuntime = (
    area: BuildArea,
    rootName: string,
    initialState: GameBootstrap['hangar'],
  ): BuildAreaRuntime => {
    let propRenderer: HangarPropRenderer | null = null;
    const propColliders = createBuildPropColliderRuntime();
    const controller = createHangarBuildController({
      initialState,
      arcBalance: bootstrap.economy.arcBalance,
      onPlacementsChange: (state) => {
        void propRenderer?.setPlacements(state.placements);
        void propColliders.setPlacements(state.placements);
      },
      onStateChange: (ctx) => {
        onArcBalanceChange(ctx.arcBalance);
      },
    });
    propRenderer = createHangarPropRenderer({
      rootName,
      stationRoot: renderer.getStationRoot(),
    });
    const runtime = { controller, propRenderer, propColliders };
    buildAreas[area] = runtime;
    buildPropRenderers.push(propRenderer);
    buildPropColliders.push(propColliders);
    void propRenderer.setPlacements(initialState.placements);
    void propColliders.setPlacements(initialState.placements);
    return runtime;
  };

  const hangarBuild = createBuildRuntime('hangar', 'hangar-props', bootstrap.hangar);
  createBuildRuntime('apartment', 'apartment-props', bootstrap.apartment);

  const buildTerminal = createBuildTerminal(
    {
      rootEl: dom.buildTerminalEl,
      kickerEl: dom.buildKickerEl,
      versionEl: dom.buildVersionEl,
      propListEl: dom.buildPropListEl,
      detailNameEl: dom.buildDetailNameEl,
      detailMetaEl: dom.buildDetailMetaEl,
      detailDescEl: dom.buildDetailDescEl,
      detailQtyEl: dom.buildDetailQtyEl,
      detailCostEl: dom.buildDetailCostEl,
      statusEl: dom.buildStatusEl,
      purchaseBtnEl: dom.buildPurchaseBtn,
      placeBtnEl: dom.buildPlaceBtn,
      moveBtnEl: dom.buildMoveBtn,
      deleteBtnEl: dom.buildDeleteBtn,
      closeBtnEl: dom.buildCloseBtn,
      noteEl: dom.buildNoteEl,
    },
    { controller: hangarBuild.controller },
  );

  return { buildAreas, buildPropRenderers, buildPropColliders, buildTerminal };
}
