import {
  getStationLayoutOverride,
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
} from "../../player/screen_hotspot";
import {
  resolveStationWalkView,
  resolveWeaponShopGazeTarget,
  stationWalkAimOriginWorld,
  weaponShopLabel,
  weaponShopWorldPosition,
  type WeaponShopGazeHit,
} from "../../player/weapon_shop_gaze";
import {
  outfittersLabel,
  outfittersWorldPosition,
  resolveOutfittersGazeTarget,
  type OutfittersGazeHit,
} from "../../player/outfitters_gaze";
import {
  foodShopLabel,
  foodShopWorldPosition,
  resolveFoodShopGazeTarget,
  type FoodShopGazeHit,
} from "../../player/food_shop_gaze";
import type { LoopContext } from "../loop_context";
import type { FrameActions } from "../types";

interface VendorLayout {
  shops: StationWeaponShopMarker[];
  outfittersShops: StationOutfittersMarker[];
  foodShops: StationFoodShopMarker[];
}

interface VendorHits {
  shopHit: WeaponShopGazeHit | null;
  outfittersHit: OutfittersGazeHit | null;
  foodShopHit: FoodShopGazeHit | null;
}

function powerDownVendorScreens(ctx: LoopContext): void {
  ctx.weaponShopScreen?.setInteractive(false);
  ctx.weaponShopScreen?.setPowered(false);
  ctx.outfittersScreen?.setInteractive(false);
  ctx.outfittersScreen?.setPowered(false);
  ctx.foodShopScreen?.setInteractive(false);
  ctx.foodShopScreen?.setPowered(false);
}

function readVendorLayout(): VendorLayout {
  const layout = getStationLayoutOverride();
  return {
    shops: layout?.weaponShops ?? [],
    outfittersShops: layout?.outfitters ?? [],
    foodShops: layout?.foodShops ?? [],
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
}

function anyVendorOpen(ctx: LoopContext): boolean {
  return (
    Boolean(ctx.weaponShop?.isOpen()) ||
    Boolean(ctx.outfitters?.isOpen()) ||
    Boolean(ctx.foodShop?.isOpen())
  );
}

function tryOpenWeaponShop(ctx: LoopContext, shopHit: WeaponShopGazeHit): boolean {
  if (
    !ctx.weaponShop ||
    ctx.weaponShop.isOpen() ||
    ctx.outfitters?.isOpen() ||
    ctx.foodShop?.isOpen()
  ) {
    return false;
  }
  ctx.outfittersScreen?.setInteractive(false);
  ctx.outfittersScreen?.setPowered(false);
  ctx.foodShopScreen?.setInteractive(false);
  ctx.foodShopScreen?.setPowered(false);
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
  if (
    !ctx.outfitters ||
    ctx.outfitters.isOpen() ||
    ctx.weaponShop?.isOpen() ||
    ctx.foodShop?.isOpen()
  ) {
    return false;
  }
  ctx.weaponShopScreen?.setInteractive(false);
  ctx.weaponShopScreen?.setPowered(false);
  ctx.foodShopScreen?.setInteractive(false);
  ctx.foodShopScreen?.setPowered(false);
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
  if (
    !ctx.foodShop ||
    ctx.foodShop.isOpen() ||
    ctx.weaponShop?.isOpen() ||
    ctx.outfitters?.isOpen()
  ) {
    return false;
  }
  ctx.weaponShopScreen?.setInteractive(false);
  ctx.weaponShopScreen?.setPowered(false);
  ctx.outfittersScreen?.setInteractive(false);
  ctx.outfittersScreen?.setPowered(false);
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

function tryOpenAnyVendor(
  ctx: LoopContext,
  actions: FrameActions,
  hits: VendorHits,
): boolean {
  if (!actions.interactPressed) return false;
  if (hits.shopHit && tryOpenWeaponShop(ctx, hits.shopHit)) return true;
  if (hits.outfittersHit && tryOpenOutfitters(ctx, hits.outfittersHit)) return true;
  if (hits.foodShopHit && tryOpenFoodShop(ctx, hits.foodShopHit)) return true;
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
  return false;
}

/** Vendor screen gaze, open/close, and proximity prompts. Returns true when vendors own the prompt. */
export function handleStationVendors(
  ctx: LoopContext,
  actions: FrameActions,
  pressInteractPrompt: (label: string) => string,
): boolean {
  const layout = readVendorLayout();
  updateVendorHeadLook(ctx, layout);
  const hits = resolveVendorHits(ctx, layout);
  syncVendorScreenSpecs(ctx, layout, hits);

  if (tryOpenAnyVendor(ctx, actions, hits)) return true;
  if (anyVendorOpen(ctx)) {
    ctx.world.prompt = "";
    return true;
  }
  if (promptForVendorGaze(ctx, hits, pressInteractPrompt)) return true;
  powerDownVendorScreens(ctx);
  return false;
}
