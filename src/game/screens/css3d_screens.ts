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

/**
 * Creates the CSS3D bunk (entertainment) and station vendor screens, wires
 * their resize handlers, and exposes the post-WebGL render pass.
 */
export function createScreens(ctx: LoopContext): Css3dScreens {
  const esBezelEl =
    document.getElementById("es-bezel") ??
    document.querySelector<HTMLElement>(".sc-es-bezel");
  ctx.esScreen = esBezelEl
    ? createEntertainmentScreen({ panelEl: esBezelEl })
    : null;
  const onEsResize = () => ctx.esScreen?.resize();
  window.addEventListener("resize", onEsResize);

  const weaponShopBezelEl =
    document.getElementById("weapon-shop-bezel") ??
    document.querySelector<HTMLElement>(".sc-weapon-shop-bezel");
  ctx.weaponShopScreen = weaponShopBezelEl
    ? createWeaponShopScreen({ panelEl: weaponShopBezelEl })
    : null;
  const onWeaponShopResize = () => ctx.weaponShopScreen?.resize();
  window.addEventListener("resize", onWeaponShopResize);

  const outfittersBezelEl =
    document.getElementById("outfitters-bezel") ??
    document.querySelector<HTMLElement>(".sc-outfitters-bezel");
  ctx.outfittersScreen = outfittersBezelEl
    ? createOutfittersScreen({ panelEl: outfittersBezelEl })
    : null;
  const onOutfittersResize = () => ctx.outfittersScreen?.resize();
  window.addEventListener("resize", onOutfittersResize);

  const foodShopBezelEl =
    document.getElementById("food-shop-bezel") ??
    document.querySelector<HTMLElement>(".sc-food-shop-bezel");
  ctx.foodShopScreen = foodShopBezelEl
    ? createFoodShopScreen({ panelEl: foodShopBezelEl })
    : null;
  const onFoodShopResize = () => ctx.foodShopScreen?.resize();
  window.addEventListener("resize", onFoodShopResize);

  function renderAfterWebGl(): void {
    const renderer = ctx.renderer;
    if (!renderer) return;
    // CSS3D bunk screen — after WebGL so the camera matrix is final.
    if (
      ctx.esScreen &&
      (ctx.world.mode === MODE_IN_BED || ctx.entertainmentSystem?.isOpen())
    ) {
      const cam = renderer.getCamera();
      ctx.esScreen.sync();
      ctx.esScreen.render(cam);
    }
    if (
      ctx.weaponShopScreen &&
      (ctx.world.mode === MODE_IN_STATION || ctx.weaponShop?.isOpen())
    ) {
      const cam = renderer.getCamera();
      ctx.weaponShopScreen.sync();
      ctx.weaponShopScreen.render(cam);
    }
    if (
      ctx.outfittersScreen &&
      (ctx.world.mode === MODE_IN_STATION || ctx.outfitters?.isOpen())
    ) {
      const cam = renderer.getCamera();
      ctx.outfittersScreen.sync();
      ctx.outfittersScreen.render(cam);
    }
    if (
      ctx.foodShopScreen &&
      (ctx.world.mode === MODE_IN_STATION || ctx.foodShop?.isOpen())
    ) {
      const cam = renderer.getCamera();
      ctx.foodShopScreen.sync();
      ctx.foodShopScreen.render(cam);
    }
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
