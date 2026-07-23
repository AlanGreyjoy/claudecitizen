import type { PrefabComponent } from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { assetUrlField, numberInput, textInput } from "./inputs";
import { el } from "../../dom";
import { ENTITY_DND_TYPE } from "../../api";
import { findEntityById, parseDraggedEntityIds } from "../inspector_logic";

type ShipControllerComponent = Extract<PrefabComponent, { type: "ship-controller" }>;
type ShipControllerStats = NonNullable<ShipControllerComponent["stats"]>;

function createEntityRefField(
  ctx: ComponentFieldBuildContext,
  value: string | undefined,
  onPick: (next: string | undefined) => void,
): HTMLElement {
  const matched = value
    ? findEntityById(ctx.store.getState().roots, value)
    : null;
  const input = el("input", {
    className: "ed-input",
    attrs: {
      type: "text",
      readonly: "true",
      value: matched?.name ?? value ?? "",
      placeholder: "Drop from Hierarchy",
      title: value
        ? matched
          ? `${matched.name} (${value})`
          : `Missing entity: ${value}`
        : "Drag an entity from the Hierarchy onto this field",
    },
  });
  if (value && !matched) input.classList.add("is-missing-ref");
  input.addEventListener("dragover", (event) => {
    const dragEvent = event as DragEvent;
    if (!dragEvent.dataTransfer?.types.includes(ENTITY_DND_TYPE)) return;
    dragEvent.preventDefault();
    if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = "copy";
    input.classList.add("is-drop-target");
  });
  input.addEventListener("dragleave", () => {
    input.classList.remove("is-drop-target");
  });
  input.addEventListener("drop", (event) => {
    const dragEvent = event as DragEvent;
    dragEvent.preventDefault();
    input.classList.remove("is-drop-target");
    const ids = parseDraggedEntityIds(
      dragEvent.dataTransfer?.getData(ENTITY_DND_TYPE) ?? "",
    );
    const nextId = ids[0];
    if (!nextId) return;
    if (!findEntityById(ctx.store.getState().roots, nextId)) return;
    onPick(nextId);
  });
  return el("div", { className: "ed-field-controls" }, [
    input,
    el("button", {
      className: "ed-btn",
      text: "Clear",
      title: "Clear entity reference",
      on: {
        click: () => onPick(undefined),
      },
    }),
  ]);
}

function patchShipControllerStats(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
  stats: ShipControllerStats,
  patch: Partial<ShipControllerStats>,
): void {
  ctx.update({ ...component, stats: { ...stats, ...patch } });
}

function buildShipControllerRestFields(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
): HTMLElement[] {
  return [
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Rest ht" }),
      numberInput(component.restHeight ?? 0, (next) =>
        ctx.update({
          ...component,
          restHeight:
            next <= 0 ? undefined : Math.min(50, Math.max(0.2, next)),
        }),
      ),
    ]),
    el("div", {
      className: "ed-empty-note",
      text: "Ship origin height above the pad (m). Viewport: cyan pad = authored, amber dashed = auto from hull lowest point. 0 = auto.",
    }),
  ];
}

function buildShipControllerCoreStatFields(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
  stats: ShipControllerStats,
): HTMLElement[] {
  return [
    el("div", { className: "ed-section-label", text: "Stats" }),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Max spd" }),
      numberInput(stats.maxSpeedMps ?? 100, (maxSpeedMps) =>
        patchShipControllerStats(ctx, component, stats, {
          maxSpeedMps: Math.min(500, Math.max(5, maxSpeedMps)),
        }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Mass kg" }),
      numberInput(stats.massKg ?? 12_000, (massKg) =>
        patchShipControllerStats(ctx, component, stats, {
          massKg: Math.min(50_000_000, Math.max(100, massKg)),
        }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Max rot" }),
      numberInput(stats.maxAngularRateRadps ?? 0.85, (maxAngularRateRadps) =>
        patchShipControllerStats(ctx, component, stats, {
          maxAngularRateRadps: Math.min(10, Math.max(0.05, maxAngularRateRadps)),
        }),
      ),
    ]),
  ];
}

function buildShipControllerThrustFields(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
  stats: ShipControllerStats,
): HTMLElement[] {
  return [
    el("div", { className: "ed-section-label", text: "Thrust (N)" }),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Fwd" }),
      numberInput(stats.forwardThrustN ?? 3_696_000, (forwardThrustN) =>
        patchShipControllerStats(ctx, component, stats, {
          forwardThrustN: Math.min(1e12, Math.max(1, forwardThrustN)),
        }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Back" }),
      numberInput(stats.backwardThrustN ?? 2_217_600, (backwardThrustN) =>
        patchShipControllerStats(ctx, component, stats, {
          backwardThrustN: Math.min(1e12, Math.max(1, backwardThrustN)),
        }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Vert" }),
      numberInput(stats.verticalThrustN ?? 2_520_000, (verticalThrustN) =>
        patchShipControllerStats(ctx, component, stats, {
          verticalThrustN: Math.min(1e12, Math.max(1, verticalThrustN)),
        }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Lat" }),
      numberInput(stats.lateralThrustN ?? 2_016_000, (lateralThrustN) =>
        patchShipControllerStats(ctx, component, stats, {
          lateralThrustN: Math.min(1e12, Math.max(1, lateralThrustN)),
        }),
      ),
    ]),
  ];
}

function buildShipControllerTorqueFields(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
  stats: ShipControllerStats,
): HTMLElement[] {
  return [
    el("div", { className: "ed-section-label", text: "Torque (N·m)" }),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Pitch" }),
      numberInput(stats.pitchTorqueNm ?? 960_000, (pitchTorqueNm) =>
        patchShipControllerStats(ctx, component, stats, {
          pitchTorqueNm: Math.min(1e12, Math.max(1, pitchTorqueNm)),
        }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Yaw" }),
      numberInput(stats.yawTorqueNm ?? 1_104_000, (yawTorqueNm) =>
        patchShipControllerStats(ctx, component, stats, {
          yawTorqueNm: Math.min(1e12, Math.max(1, yawTorqueNm)),
        }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Roll" }),
      numberInput(stats.rollTorqueNm ?? 1_584_000, (rollTorqueNm) =>
        patchShipControllerStats(ctx, component, stats, {
          rollTorqueNm: Math.min(1e12, Math.max(1, rollTorqueNm)),
        }),
      ),
    ]),
  ];
}

function buildShipControllerCameraFeelFields(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
  stats: ShipControllerStats,
): HTMLElement[] {
  return [
    el("div", { className: "ed-section-label", text: "Camera feel" }),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "FOV fwd°" }),
      numberInput(stats.thrustFovForwardDeg ?? 5, (thrustFovForwardDeg) =>
        patchShipControllerStats(ctx, component, stats, {
          thrustFovForwardDeg: Math.min(30, Math.max(0, thrustFovForwardDeg)),
        }),
        0.5,
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "FOV back°" }),
      numberInput(
        stats.thrustFovBackwardDeg ?? 3.5,
        (thrustFovBackwardDeg) =>
          patchShipControllerStats(ctx, component, stats, {
            thrustFovBackwardDeg: Math.min(30, Math.max(0, thrustFovBackwardDeg)),
          }),
        0.5,
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "FOV blend" }),
      numberInput(
        stats.thrustFovBlendPerSec ?? 8,
        (thrustFovBlendPerSec) =>
          patchShipControllerStats(ctx, component, stats, {
            thrustFovBlendPerSec: Math.min(40, Math.max(0.5, thrustFovBlendPerSec)),
          }),
        0.5,
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Boost shake" }),
      numberInput(
        stats.boostShakeAmplitudeM ?? 0.015,
        (boostShakeAmplitudeM) =>
          patchShipControllerStats(ctx, component, stats, {
            boostShakeAmplitudeM: Math.min(0.2, Math.max(0, boostShakeAmplitudeM)),
          }),
        0.001,
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Shake Hz" }),
      numberInput(stats.boostShakeHz ?? 20, (boostShakeHz) =>
        patchShipControllerStats(ctx, component, stats, {
          boostShakeHz: Math.min(60, Math.max(1, boostShakeHz)),
        }),
        1,
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Boost fade" }),
      numberInput(stats.boostBlendPerSec ?? 4.5, (boostBlendPerSec) =>
        patchShipControllerStats(ctx, component, stats, {
          boostBlendPerSec: Math.min(40, Math.max(0.5, boostBlendPerSec)),
        }),
        0.5,
      ),
    ]),
  ];
}

function buildShipControllerAudioFields(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
  stats: ShipControllerStats,
): HTMLElement[] {
  return [
    assetUrlField("Boost SFX", stats.boostSoundUrl, (boostSoundUrl) =>
      patchShipControllerStats(ctx, component, stats, { boostSoundUrl }),
    ),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Boost vol" }),
      numberInput(stats.boostSoundVolume ?? 1, (boostSoundVolume) =>
        patchShipControllerStats(ctx, component, stats, {
          boostSoundVolume: Math.min(1, Math.max(0, boostSoundVolume)),
        }),
        0.05,
      ),
    ]),
    assetUrlField("Thrust SFX", stats.thrustSoundUrl, (thrustSoundUrl) =>
      patchShipControllerStats(ctx, component, stats, { thrustSoundUrl }),
    ),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Thrust vol" }),
      numberInput(stats.thrustSoundVolume ?? 1, (thrustSoundVolume) =>
        patchShipControllerStats(ctx, component, stats, {
          thrustSoundVolume: Math.min(1, Math.max(0, thrustSoundVolume)),
        }),
        0.05,
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Max HP" }),
      numberInput(stats.maxHp ?? 1000, (maxHp) =>
        patchShipControllerStats(ctx, component, stats, {
          maxHp: Math.min(100_000, Math.max(1, maxHp)),
        }),
      ),
    ]),
  ];
}

function buildShipControllerRampFields(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
  ramp: NonNullable<ShipControllerComponent["ramp"]>,
  entityRefField: (
    value: string | undefined,
    onPick: (next: string | undefined) => void,
  ) => HTMLElement,
): HTMLElement[] {
  return [
    el("div", { className: "ed-section-label", text: "Ramp" }),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Hinge" }),
      textInput(ramp.hinge?.node ?? "RampParent", (node) =>
        ctx.update({
          ...component,
          ramp: {
            ...ramp,
            hinge: {
              ...ramp.hinge,
              node,
              lowerRadians: ramp.hinge?.lowerRadians ?? -0.85,
            },
          },
        }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Lower °" }),
      numberInput(ramp.hinge?.lowerRadians ?? -0.85, (lowerRadians) =>
        ctx.update({
          ...component,
          ramp: {
            ...ramp,
            hinge: {
              node: ramp.hinge?.node ?? "RampParent",
              lowerRadians: Math.min(10, Math.max(-10, lowerRadians)),
              axis: ramp.hinge?.axis,
            },
          },
        }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Out btn" }),
      entityRefField(ramp.outsideInteractId, (outsideInteractId) =>
        ctx.update({ ...component, ramp: { ...ramp, outsideInteractId } }),
      ),
    ]),
    el("div", { className: "ed-field-row-wide" }, [
      el("span", { className: "ed-field-label", text: "Deck btn" }),
      entityRefField(ramp.deckInteractId, (deckInteractId) =>
        ctx.update({ ...component, ramp: { ...ramp, deckInteractId } }),
      ),
    ]),
    assetUrlField("Open SFX", ramp.openSoundUrl, (openSoundUrl) =>
      ctx.update({ ...component, ramp: { ...ramp, openSoundUrl } }),
    ),
    assetUrlField("Close SFX", ramp.closeSoundUrl, (closeSoundUrl) =>
      ctx.update({ ...component, ramp: { ...ramp, closeSoundUrl } }),
    ),
  ];
}

function buildShipControllerGearFields(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
  gear: NonNullable<ShipControllerComponent["gear"]>,
): HTMLElement[] {
  return [
    el("div", { className: "ed-section-label", text: "Landing gear" }),
    assetUrlField("Deploy SFX", gear.deploySoundUrl, (deploySoundUrl) =>
      ctx.update({
        ...component,
        gear: { ...gear, nodes: gear.nodes ?? [], deploySoundUrl },
      }),
    ),
    assetUrlField("Retract SFX", gear.retractSoundUrl, (retractSoundUrl) =>
      ctx.update({
        ...component,
        gear: { ...gear, nodes: gear.nodes ?? [], retractSoundUrl },
      }),
    ),
    el("div", {
      className: "ed-empty-note",
      text: `${gear.nodes.length} gear hinge(s), ${(component.seats ?? []).length} seat(s). Add doors/cubbies as Ship Door marker empties (Open/Close SFX in inspector). Legacy controller.doors[] still bakes if present.`,
    }),
  ];
}

export function buildShipControllerFields(
  ctx: ComponentFieldBuildContext,
  component: ShipControllerComponent,
): HTMLElement[] {
  const stats = component.stats ?? {};
  const gear = component.gear ?? { nodes: [] };
  const ramp = component.ramp ?? {
    hinge: { node: "RampParent", lowerRadians: -0.85 },
  };
  const entityRefField = (
    value: string | undefined,
    onPick: (next: string | undefined) => void,
  ) => createEntityRefField(ctx, value, onPick);

  return [
    ...buildShipControllerRestFields(ctx, component),
    ...buildShipControllerCoreStatFields(ctx, component, stats),
    ...buildShipControllerThrustFields(ctx, component, stats),
    ...buildShipControllerTorqueFields(ctx, component, stats),
    ...buildShipControllerCameraFeelFields(ctx, component, stats),
    ...buildShipControllerAudioFields(ctx, component, stats),
    ...buildShipControllerRampFields(ctx, component, ramp, entityRefField),
    ...buildShipControllerGearFields(ctx, component, gear),
  ];
}
