import {
  gunshotToneForWeapon,
  playBulletImpact,
  playDryFireSound,
  playGunshot,
  playReloadSound,
  type GunshotTone,
  type ImpactSurface,
} from "../../audio/gunshots";
import { playSfx } from "../../audio/sfx";
import type { WeaponGeometryHit } from "../../player/weapon-ballistics";
import type { ActiveFirearm } from "./resolve-active-firearm";

/** Authored presentation assets from the weapon's `weapon-combat` component. */
export interface WeaponCombatAssets {
  dryFireSoundUrl: string | null;
  fireSoundUrl: string | null;
  reloadSoundUrl: string | null;
}

const toneCache = new Map<string, GunshotTone>();

function toneFor(firearm: ActiveFirearm): GunshotTone {
  const key = `${firearm.definition.id}:${firearm.roundsPerMinute}:${firearm.muzzleVelocityMps}`;
  const cached = toneCache.get(key);
  if (cached) return cached;
  const tone = gunshotToneForWeapon({
    muzzleVelocityMps: firearm.muzzleVelocityMps,
    roundsPerMinute: firearm.roundsPerMinute,
  });
  toneCache.set(key, tone);
  return tone;
}

function impactSurface(hit: WeaponGeometryHit): ImpactSurface | null {
  if (hit.surfaceKind === "other") return null;
  return hit.surfaceKind;
}

/**
 * Report plus the impact heard back down range. An authored sample wins for the
 * report; the impact is always synthesised because it depends on hit surface
 * and distance, which no single sample can carry.
 */
export function playWeaponFireAudio(params: {
  assets: WeaponCombatAssets | null;
  firearm: ActiveFirearm;
  hit: WeaponGeometryHit | null;
  shotIndex: number;
}): void {
  const { assets, firearm, hit, shotIndex } = params;
  if (assets?.fireSoundUrl) playSfx(assets.fireSoundUrl);
  else playGunshot({ shotIndex, tone: toneFor(firearm) });

  const surface = hit ? impactSurface(hit) : null;
  if (!hit || !surface) return;
  playBulletImpact({
    distanceMeters: hit.distance,
    muzzleVelocityMps: firearm.muzzleVelocityMps,
    shotIndex,
    surface,
  });
}

export function playDryFireAudio(assets: WeaponCombatAssets | null): void {
  if (assets?.dryFireSoundUrl) playSfx(assets.dryFireSoundUrl);
  else playDryFireSound();
}

export function playReloadAudio(assets: WeaponCombatAssets | null): void {
  if (assets?.reloadSoundUrl) playSfx(assets.reloadSoundUrl);
  else playReloadSound();
}
