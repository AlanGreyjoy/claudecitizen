import {
  getStationLayoutOverride,
  type StationAvmsMarker,
  type StationFoodShopMarker,
  type StationOutfittersMarker,
  type StationWeaponShopMarker,
} from "../../world/station";
import {
  characterHeadLookTowardPoint,
  resolveNearestScreenHotspot,
  SCREEN_HOTSPOT_MAX_DISTANCE_METERS,
  screenWorldNormal,
  stationHotspotEyeWorld,
  type ScreenHotspotAnchor,
} from "../../player/screen-hotspot";
import {
  resolveStationWalkView,
  resolveWeaponShopGazeTarget,
  stationWalkAimOriginWorld,
  weaponShopLabel,
  weaponShopWorldPosition,
  type WeaponShopGazeHit,
} from "../../player/weapon-shop-gaze";
import {
  outfittersLabel,
  outfittersWorldPosition,
  resolveOutfittersGazeTarget,
  type OutfittersGazeHit,
} from "../../player/outfitters-gaze";
import {
  foodShopLabel,
  foodShopWorldPosition,
  resolveFoodShopGazeTarget,
  type FoodShopGazeHit,
} from "../../player/food-shop-gaze";
import {
  avmsTerminalLabel,
  avmsTerminalWorldPosition,
  resolveAvmsTerminalGazeTarget,
  type AvmsTerminalGazeHit,
} from "../../player/avms-terminal-gaze";
import type { LoopContext } from "../loop-context";
import type { FrameActions } from "../types";
import type { BuildTool } from "./build-tool";
import { openAvmsTerminal } from "./avms-actions";

interface VendorLayout {
  shops: StationWeaponShopMarker[];
  outfittersShops: StationOutfittersMarker[];
  foodShops: StationFoodShopMarker[];
  avmsTerminals: StationAvmsMarker[];
}

interface VendorHits {
  shopHit: WeaponShopGazeHit | null;
  outfittersHit: OutfittersGazeHit | null;
  foodShopHit: FoodShopGazeHit | null;
  avmsHit: AvmsTerminalGazeHit | null;
}

function powerDownVendorScreens(ctx: LoopContext): void {
  ctx.weaponShopScreen?.setInteractive(false);
  ctx.weaponShopScreen?.setPowered(false);
  ctx.outfittersScreen?.setInteractive(false);
  ctx.outfittersScreen?.setPowered(false);
  ctx.foodShopScreen?.setInteractive(false);
  ctx.foodShopScreen?.setPowered(false);
  ctx.avmsTerminalScreen?.setInteractive(false);
  ctx.avmsTerminalScreen?.setPowered(false);
}

function readVendorLayout(): VendorLayout {
  const layout = getStationLayoutOverride();
  return {
    shops: layout?.weaponShops ?? [],
    outfittersShops: layout?.outfitters ?? [],
    foodShops: layout?.foodShops ?? [],
    avmsTerminals: layout?.avmsMarkers ?? [],
  };
}

function collectVendorHotspots(
  ctx: LoopContext,
  layout: VendorLayout,
): ScreenHotspotAnchor[] {
  const anchors: ScreenHotspotAnchor[] = [];
  for (const shop of layout.shops) {
    anchors.push({
      worldPosition: weaponShopWorldPosition(ctx.stationFrame, shop),
      maxDistance: Math.min(shop.maxDistance, SCREEN_HOTSPOT_MAX_DISTANCE_METERS),
      worldNormal: screenWorldNormal(ctx.stationFrame, shop.rotation),
    });
  }
  for (const shop of layout.outfittersShops) {
    anchors.push({
      worldPosition: outfittersWorldPosition(ctx.stationFrame, shop),
      maxDistance: Math.min(shop.maxDistance, SCREEN_HOTSPOT_MAX_DISTANCE_METERS),
      worldNormal: screenWorldNormal(ctx.stationFrame, shop.rotation),
    });
  }
  for (const shop of layout.foodShops) {
    anchors.push({
      worldPosition: foodShopWorldPosition(ctx.stationFrame, shop),
      maxDistance: Math.min(shop.maxDistance, SCREEN_HOTSPOT_MAX_DISTANCE_METERS),
      worldNormal: screenWorldNormal(ctx.stationFrame, shop.rotation),
    });
  }
  for (const terminal of layout.avmsTerminals) {
    anchors.push({
      worldPosition: avmsTerminalWorldPosition(ctx.stationFrame, terminal),
      maxDistance: Math.min(
        terminal.maxDistance,
        SCREEN_HOTSPOT_MAX_DISTANCE_METERS,
      ),
      worldNormal: screenWorldNormal(ctx.stationFrame, terminal.rotation),
    });
  }
  return anchors;
}

function updateVendorHeadLook(ctx: LoopContext, layout: VendorLayout): void {
  const hotspotEye = stationHotspotEyeWorld(
    ctx.world.character.position,
    ctx.stationFrame.up,
  );
  const hotspot = resolveNearestScreenHotspot(
    collectVendorHotspots(ctx, layout),
    hotspotEye,
  );
  ctx.stationScreenHeadLook = hotspot
    ? characterHeadLookTowardPoint(
        ctx.world.character.forward,
        ctx.world.character.up,
        hotspotEye,
        hotspot.worldPosition,
      )
    : null;
}

function resolveVendorHits(ctx: LoopContext, layout: VendorLayout): VendorHits {
  const walkView = resolveStationWalkView(
    ctx.stationFrame.forward,
    ctx.stationFrame.up,
    ctx.world.cameraOrbit.yawRadians,
    ctx.world.cameraOrbit.pitchRadians,
  );
  const shopEye = stationWalkAimOriginWorld(
    ctx.world.character.position,
    ctx.stationFrame.up,
    walkView.forward,
  );
  return {
    shopHit: resolveWeaponShopGazeTarget(
      layout.shops,
      ctx.stationFrame,
      shopEye,
      walkView.forward,
    ),
    outfittersHit: resolveOutfittersGazeTarget(
      layout.outfittersShops,
      ctx.stationFrame,
      shopEye,
      walkView.forward,
    ),
    foodShopHit: resolveFoodShopGazeTarget(
      layout.foodShops,
      ctx.stationFrame,
      shopEye,
      walkView.forward,
    ),
    avmsHit: resolveAvmsTerminalGazeTarget(
      layout.avmsTerminals,
      ctx.stationFrame,
      shopEye,
      walkView.forward,
    ),
  };
}

function syncOneVendorScreen<TSpec>(args: {
  screen: {
    attachTo: (root: ReturnType<NonNullable<LoopContext["renderer"]>["getStationRoot"]>) => void;
    setSpec: (spec: TSpec) => void;
  } | null | undefined;
  renderer: LoopContext["renderer"];
  list: TSpec[];
  hitSpec: TSpec | undefined;
}): void {
  const { screen, renderer, list, hitSpec } = args;
  if (!screen || !renderer || list.length === 0) return;
  screen.attachTo(renderer.getStationRoot());
  screen.setSpec(hitSpec ?? list[0]!);
}

function syncVendorScreenSpecs(
  ctx: LoopContext,
  layout: VendorLayout,
  hits: VendorHits,
): void {
  syncOneVendorScreen({
    screen: ctx.weaponShopScreen,
    renderer: ctx.renderer,
    list: layout.shops,
    hitSpec: hits.shopHit?.shop,
  });
  syncOneVendorScreen({
    screen: ctx.outfittersScreen,
    renderer: ctx.renderer,
    list: layout.outfittersShops,
    hitSpec: hits.outfittersHit?.shop,
  });
  syncOneVendorScreen({
    screen: ctx.foodShopScreen,
    renderer: ctx.renderer,
    list: layout.foodShops,
    hitSpec: hits.foodShopHit?.shop,
  });
  syncOneVendorScreen({
    screen: ctx.avmsTerminalScreen,
    renderer: ctx.renderer,
    list: layout.avmsTerminals,
    hitSpec: hits.avmsHit?.terminal,
  });
}

function anyVendorOpen(ctx: LoopContext): boolean {
  return (
    Boolean(ctx.weaponShop?.isOpen()) ||
    Boolean(ctx.outfitters?.isOpen()) ||
    Boolean(ctx.foodShop?.isOpen()) ||
    Boolean(ctx.avmsTerminal?.isOpen())
  );
}

function otherVendorOpen(ctx: LoopContext, except: "weapon" | "outfitters" | "food" | "avms"): boolean {
  if (except !== "weapon" && ctx.weaponShop?.isOpen()) return true;
  if (except !== "outfitters" && ctx.outfitters?.isOpen()) return true;
  if (except !== "food" && ctx.foodShop?.isOpen()) return true;
  if (except !== "avms" && ctx.avmsTerminal?.isOpen()) return true;
  return false;
}

function tryOpenWeaponShop(ctx: LoopContext, shopHit: WeaponShopGazeHit): boolean {
  if (!ctx.weaponShop || ctx.weaponShop.isOpen() || otherVendorOpen(ctx, "weapon")) {
    return false;
  }
  powerDownVendorScreens(ctx);
  ctx.weaponShopScreen?.setPowered(true);
  ctx.weaponShopScreen?.setInteractive(true);
  ctx.weaponShop.open({
    shop: shopHit.shop,
    onClose: () => {
      ctx.weaponShopScreen?.setInteractive(false);
      ctx.weaponShopScreen?.setPowered(false);
    },
  });
  ctx.world.prompt = "";
  return true;
}

function tryOpenOutfitters(ctx: LoopContext, hit: OutfittersGazeHit): boolean {
  if (!ctx.outfitters || ctx.outfitters.isOpen() || otherVendorOpen(ctx, "outfitters")) {
    return false;
  }
  powerDownVendorScreens(ctx);
  ctx.outfittersScreen?.setPowered(true);
  ctx.outfittersScreen?.setInteractive(true);
  ctx.outfitters.open({
    shop: hit.shop,
    onClose: () => {
      ctx.outfittersScreen?.setInteractive(false);
      ctx.outfittersScreen?.setPowered(false);
    },
  });
  ctx.world.prompt = "";
  return true;
}

function tryOpenFoodShop(ctx: LoopContext, hit: FoodShopGazeHit): boolean {
  if (!ctx.foodShop || ctx.foodShop.isOpen() || otherVendorOpen(ctx, "food")) {
    return false;
  }
  powerDownVendorScreens(ctx);
  ctx.foodShopScreen?.setPowered(true);
  ctx.foodShopScreen?.setInteractive(true);
  ctx.foodShop.open({
    shop: hit.shop,
    onClose: () => {
      ctx.foodShopScreen?.setInteractive(false);
      ctx.foodShopScreen?.setPowered(false);
    },
  });
  ctx.world.prompt = "";
  return true;
}

function tryOpenAvms(
  ctx: LoopContext,
  buildTool: BuildTool,
  terminal: StationAvmsMarker,
): boolean {
  if (!ctx.avmsTerminal || ctx.avmsTerminal.isOpen() || otherVendorOpen(ctx, "avms")) {
    return false;
  }
  powerDownVendorScreens(ctx);
  ctx.avmsTerminalScreen?.setPowered(true);
  ctx.avmsTerminalScreen?.setInteractive(true);
  openAvmsTerminal(ctx, buildTool, {
    terminal,
    onClose: () => {
      ctx.avmsTerminalScreen?.setInteractive(false);
      ctx.avmsTerminalScreen?.setPowered(false);
    },
  });
  ctx.world.prompt = "";
  return true;
}

function tryOpenAnyVendor(
  ctx: LoopContext,
  actions: FrameActions,
  hits: VendorHits,
  buildTool: BuildTool,
): boolean {
  if (!actions.interactPressed) return false;
  if (hits.shopHit && tryOpenWeaponShop(ctx, hits.shopHit)) return true;
  if (hits.outfittersHit && tryOpenOutfitters(ctx, hits.outfittersHit)) return true;
  if (hits.foodShopHit && tryOpenFoodShop(ctx, hits.foodShopHit)) return true;
  if (hits.avmsHit && tryOpenAvms(ctx, buildTool, hits.avmsHit.terminal)) return true;
  return false;
}

function promptForVendorGaze(
  ctx: LoopContext,
  hits: VendorHits,
  pressInteractPrompt: (label: string) => string,
): boolean {
  if (hits.shopHit) {
    powerDownVendorScreens(ctx);
    ctx.world.prompt = pressInteractPrompt(weaponShopLabel(hits.shopHit.shop));
    return true;
  }
  if (hits.outfittersHit) {
    powerDownVendorScreens(ctx);
    ctx.world.prompt = pressInteractPrompt(
      outfittersLabel(hits.outfittersHit.shop),
    );
    return true;
  }
  if (hits.foodShopHit) {
    powerDownVendorScreens(ctx);
    ctx.world.prompt = pressInteractPrompt(foodShopLabel(hits.foodShopHit.shop));
    return true;
  }
  if (hits.avmsHit) {
    powerDownVendorScreens(ctx);
    ctx.world.prompt = pressInteractPrompt(
      avmsTerminalLabel(hits.avmsHit.terminal),
    );
    return true;
  }
  return false;
}

/** Vendor screen gaze, open/close, and proximity prompts. Returns true when vendors own the prompt. */
export function handleStationVendors(
  ctx: LoopContext,
  actions: FrameActions,
  pressInteractPrompt: (label: string) => string,
  buildTool: BuildTool,
): boolean {
  const layout = readVendorLayout();
  updateVendorHeadLook(ctx, layout);
  const hits = resolveVendorHits(ctx, layout);
  syncVendorScreenSpecs(ctx, layout, hits);

  if (tryOpenAnyVendor(ctx, actions, hits, buildTool)) return true;
  if (anyVendorOpen(ctx)) {
    ctx.world.prompt = "";
    return true;
  }
  if (promptForVendorGaze(ctx, hits, pressInteractPrompt)) return true;
  powerDownVendorScreens(ctx);
  return false;
}
