import { createEntertainmentScreen } from "../../render/effects/entertainment_screen";
import { createWeaponShopScreen } from "../../render/effects/weapon_shop_screen";
import { createOutfittersScreen } from "../../render/effects/outfitters_screen";
import { createFoodShopScreen } from "../../render/effects/food_shop_screen";
import { MODE_IN_BED, MODE_IN_STATION } from "../../player/modes";
import type { LoopContext } from "../loop_context";

export interface Css3dScreens {
  /** CSS3D vendor/bunk screens render after WebGL so the camera matrix is final. */
  renderAfterWebGl: () => void;
  dispose: () => void;
}

interface ScreenLike {
  sync: () => void;
  render: (camera: ReturnType<NonNullable<LoopContext["renderer"]>["getCamera"]>) => void;
  resize: () => void;
  dispose: () => void;
}

function mountScreen<T extends ScreenLike>(
  bezelId: string,
  className: string,
  factory: (opts: { panelEl: HTMLElement }) => T,
  onResize: () => void,
): T | null {
  const bezelEl =
    document.getElementById(bezelId) ??
    document.querySelector<HTMLElement>(className);
  const screen = bezelEl ? factory({ panelEl: bezelEl }) : null;
  if (screen) window.addEventListener("resize", onResize);
  return screen;
}

function renderScreenIfActive(
  screen: ScreenLike | null,
  shouldRender: boolean,
  renderer: NonNullable<LoopContext["renderer"]>,
): void {
  if (!screen || !shouldRender) return;
  const cam = renderer.getCamera();
  screen.sync();
  screen.render(cam);
}

/**
 * Creates the CSS3D bunk (entertainment) and station vendor screens, wires
 * their resize handlers, and exposes the post-WebGL render pass.
 */
export function createScreens(ctx: LoopContext): Css3dScreens {
  const onEsResize = () => ctx.esScreen?.resize();
  const onWeaponShopResize = () => ctx.weaponShopScreen?.resize();
  const onOutfittersResize = () => ctx.outfittersScreen?.resize();
  const onFoodShopResize = () => ctx.foodShopScreen?.resize();

  ctx.esScreen = mountScreen(
    "es-bezel",
    ".sc-es-bezel",
    createEntertainmentScreen,
    onEsResize,
  );
  ctx.weaponShopScreen = mountScreen(
    "weapon-shop-bezel",
    ".sc-weapon-shop-bezel",
    createWeaponShopScreen,
    onWeaponShopResize,
  );
  ctx.outfittersScreen = mountScreen(
    "outfitters-bezel",
    ".sc-outfitters-bezel",
    createOutfittersScreen,
    onOutfittersResize,
  );
  ctx.foodShopScreen = mountScreen(
    "food-shop-bezel",
    ".sc-food-shop-bezel",
    createFoodShopScreen,
    onFoodShopResize,
  );

  function renderAfterWebGl(): void {
    const renderer = ctx.renderer;
    if (!renderer) return;
    renderScreenIfActive(
      ctx.esScreen,
      ctx.world.mode === MODE_IN_BED || Boolean(ctx.entertainmentSystem?.isOpen()),
      renderer,
    );
    renderScreenIfActive(
      ctx.weaponShopScreen,
      ctx.world.mode === MODE_IN_STATION || Boolean(ctx.weaponShop?.isOpen()),
      renderer,
    );
    renderScreenIfActive(
      ctx.outfittersScreen,
      ctx.world.mode === MODE_IN_STATION || Boolean(ctx.outfitters?.isOpen()),
      renderer,
    );
    renderScreenIfActive(
      ctx.foodShopScreen,
      ctx.world.mode === MODE_IN_STATION || Boolean(ctx.foodShop?.isOpen()),
      renderer,
    );
  }

  function dispose(): void {
    window.removeEventListener("resize", onEsResize);
    window.removeEventListener("resize", onWeaponShopResize);
    window.removeEventListener("resize", onOutfittersResize);
    window.removeEventListener("resize", onFoodShopResize);
    ctx.esScreen?.dispose();
    ctx.weaponShopScreen?.dispose();
    ctx.outfittersScreen?.dispose();
    ctx.foodShopScreen?.dispose();
  }

  return { renderAfterWebGl, dispose };
}
