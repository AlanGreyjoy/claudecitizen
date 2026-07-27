import type { ReactElement } from 'react';
import type {
  PrefabComponent,
  ShipEntryMode,
} from '../../../../world/prefabs/schema';
import { SHIP_ENTRY_MODES } from '../../../../world/prefabs/schema';
import type { ComponentFieldContext, ComponentFieldsProps } from './context';
import { ShipControllerSeats } from './ShipControllerSeats';
import {
  AssetUrlField,
  EdButton,
  EmptyNote,
  EntityRefField,
  GlbNodeRefField,
  FieldRow,
  NumberField,
  SectionLabel,
  SelectField,
} from '../InspectorForm';

type ShipControllerComponent = Extract<PrefabComponent, { type: 'ship-controller' }>;
type ShipControllerStats = NonNullable<ShipControllerComponent['stats']>;

function patchShipControllerStats(
  ctx: ComponentFieldContext,
  component: ShipControllerComponent,
  stats: ShipControllerStats,
  patch: Partial<ShipControllerStats>,
): void {
  ctx.update({ ...component, stats: { ...stats, ...patch } });
}

function ShipControllerRestFields({
  ctx,
  component,
}: {
  ctx: ComponentFieldContext;
  component: ShipControllerComponent;
}): ReactElement {
  const { update } = ctx;
  return (
    <>
      <FieldRow label="Rest ht" wide>
        <NumberField
          value={component.restHeight ?? 0}
          onCommit={(next) =>
            update({
              ...component,
              restHeight: next <= 0 ? undefined : Math.min(50, Math.max(0.2, next)),
            })
          }
        />
      </FieldRow>
      <EmptyNote>
        Ship origin height above the pad (m). Viewport: cyan pad = authored, amber dashed
        = auto from hull lowest point. 0 = auto.
      </EmptyNote>
      <FieldRow label="Entry" wide>
        <SelectField
          options={SHIP_ENTRY_MODES}
          value={component.entry ?? 'interior'}
          onCommit={(entry) =>
            update({ ...component, entry: entry as ShipEntryMode })
          }
        />
      </FieldRow>
      <EmptyNote>
        Interior: walk the deck to the seat (needs deck colliders). Exterior: open-frame
        hull with no interior — stand beside it and press F. Add Ship Entry markers to
        place the board circles; without one the pilot seat stands in.
      </EmptyNote>
    </>
  );
}

function ShipControllerCoreStatFields({
  ctx,
  component,
  stats,
}: {
  ctx: ComponentFieldContext;
  component: ShipControllerComponent;
  stats: ShipControllerStats;
}): ReactElement {
  return (
    <>
      <SectionLabel>Stats</SectionLabel>
      <FieldRow label="Max spd" wide>
        <NumberField
          value={stats.maxSpeedMps ?? 100}
          onCommit={(maxSpeedMps) =>
            patchShipControllerStats(ctx, component, stats, {
              maxSpeedMps: Math.min(500, Math.max(5, maxSpeedMps)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Mass kg" wide>
        <NumberField
          value={stats.massKg ?? 12_000}
          onCommit={(massKg) =>
            patchShipControllerStats(ctx, component, stats, {
              massKg: Math.min(50_000_000, Math.max(100, massKg)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Max rot" wide>
        <NumberField
          value={stats.maxAngularRateRadps ?? 0.85}
          onCommit={(maxAngularRateRadps) =>
            patchShipControllerStats(ctx, component, stats, {
              maxAngularRateRadps: Math.min(10, Math.max(0.05, maxAngularRateRadps)),
            })
          }
        />
      </FieldRow>
    </>
  );
}

function ShipControllerThrustFields({
  ctx,
  component,
  stats,
}: {
  ctx: ComponentFieldContext;
  component: ShipControllerComponent;
  stats: ShipControllerStats;
}): ReactElement {
  return (
    <>
      <SectionLabel>Thrust (N)</SectionLabel>
      <FieldRow label="Fwd" wide>
        <NumberField
          value={stats.forwardThrustN ?? 3_696_000}
          onCommit={(forwardThrustN) =>
            patchShipControllerStats(ctx, component, stats, {
              forwardThrustN: Math.min(1e12, Math.max(1, forwardThrustN)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Back" wide>
        <NumberField
          value={stats.backwardThrustN ?? 2_217_600}
          onCommit={(backwardThrustN) =>
            patchShipControllerStats(ctx, component, stats, {
              backwardThrustN: Math.min(1e12, Math.max(1, backwardThrustN)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Vert" wide>
        <NumberField
          value={stats.verticalThrustN ?? 2_520_000}
          onCommit={(verticalThrustN) =>
            patchShipControllerStats(ctx, component, stats, {
              verticalThrustN: Math.min(1e12, Math.max(1, verticalThrustN)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Lat" wide>
        <NumberField
          value={stats.lateralThrustN ?? 2_016_000}
          onCommit={(lateralThrustN) =>
            patchShipControllerStats(ctx, component, stats, {
              lateralThrustN: Math.min(1e12, Math.max(1, lateralThrustN)),
            })
          }
        />
      </FieldRow>
    </>
  );
}

function ShipControllerTorqueFields({
  ctx,
  component,
  stats,
}: {
  ctx: ComponentFieldContext;
  component: ShipControllerComponent;
  stats: ShipControllerStats;
}): ReactElement {
  return (
    <>
      <SectionLabel>Torque (N·m)</SectionLabel>
      <FieldRow label="Pitch" wide>
        <NumberField
          value={stats.pitchTorqueNm ?? 960_000}
          onCommit={(pitchTorqueNm) =>
            patchShipControllerStats(ctx, component, stats, {
              pitchTorqueNm: Math.min(1e12, Math.max(1, pitchTorqueNm)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Yaw" wide>
        <NumberField
          value={stats.yawTorqueNm ?? 1_104_000}
          onCommit={(yawTorqueNm) =>
            patchShipControllerStats(ctx, component, stats, {
              yawTorqueNm: Math.min(1e12, Math.max(1, yawTorqueNm)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Roll" wide>
        <NumberField
          value={stats.rollTorqueNm ?? 1_584_000}
          onCommit={(rollTorqueNm) =>
            patchShipControllerStats(ctx, component, stats, {
              rollTorqueNm: Math.min(1e12, Math.max(1, rollTorqueNm)),
            })
          }
        />
      </FieldRow>
    </>
  );
}

function ShipControllerCameraFeelFields({
  ctx,
  component,
  stats,
}: {
  ctx: ComponentFieldContext;
  component: ShipControllerComponent;
  stats: ShipControllerStats;
}): ReactElement {
  return (
    <>
      <SectionLabel>Camera feel</SectionLabel>
      <FieldRow label="FOV fwd°" wide>
        <NumberField
          value={stats.thrustFovForwardDeg ?? 5}
          step={0.5}
          onCommit={(thrustFovForwardDeg) =>
            patchShipControllerStats(ctx, component, stats, {
              thrustFovForwardDeg: Math.min(30, Math.max(0, thrustFovForwardDeg)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="FOV back°" wide>
        <NumberField
          value={stats.thrustFovBackwardDeg ?? 3.5}
          step={0.5}
          onCommit={(thrustFovBackwardDeg) =>
            patchShipControllerStats(ctx, component, stats, {
              thrustFovBackwardDeg: Math.min(30, Math.max(0, thrustFovBackwardDeg)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="FOV blend" wide>
        <NumberField
          value={stats.thrustFovBlendPerSec ?? 8}
          step={0.5}
          onCommit={(thrustFovBlendPerSec) =>
            patchShipControllerStats(ctx, component, stats, {
              thrustFovBlendPerSec: Math.min(40, Math.max(0.5, thrustFovBlendPerSec)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Boost shake" wide>
        <NumberField
          value={stats.boostShakeAmplitudeM ?? 0.015}
          step={0.001}
          onCommit={(boostShakeAmplitudeM) =>
            patchShipControllerStats(ctx, component, stats, {
              boostShakeAmplitudeM: Math.min(0.2, Math.max(0, boostShakeAmplitudeM)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Shake Hz" wide>
        <NumberField
          value={stats.boostShakeHz ?? 20}
          step={1}
          onCommit={(boostShakeHz) =>
            patchShipControllerStats(ctx, component, stats, {
              boostShakeHz: Math.min(60, Math.max(1, boostShakeHz)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Boost fade" wide>
        <NumberField
          value={stats.boostBlendPerSec ?? 4.5}
          step={0.5}
          onCommit={(boostBlendPerSec) =>
            patchShipControllerStats(ctx, component, stats, {
              boostBlendPerSec: Math.min(40, Math.max(0.5, boostBlendPerSec)),
            })
          }
        />
      </FieldRow>
    </>
  );
}

function ShipControllerAudioFields({
  ctx,
  component,
  stats,
}: {
  ctx: ComponentFieldContext;
  component: ShipControllerComponent;
  stats: ShipControllerStats;
}): ReactElement {
  return (
    <>
      <AssetUrlField
        label="Boost SFX"
        value={stats.boostSoundUrl}
        onCommit={(boostSoundUrl) =>
          patchShipControllerStats(ctx, component, stats, { boostSoundUrl })
        }
      />
      <FieldRow label="Boost vol" wide>
        <NumberField
          value={stats.boostSoundVolume ?? 1}
          step={0.05}
          onCommit={(boostSoundVolume) =>
            patchShipControllerStats(ctx, component, stats, {
              boostSoundVolume: Math.min(1, Math.max(0, boostSoundVolume)),
            })
          }
        />
      </FieldRow>
      <AssetUrlField
        label="Thrust SFX"
        value={stats.thrustSoundUrl}
        onCommit={(thrustSoundUrl) =>
          patchShipControllerStats(ctx, component, stats, { thrustSoundUrl })
        }
      />
      <FieldRow label="Thrust vol" wide>
        <NumberField
          value={stats.thrustSoundVolume ?? 1}
          step={0.05}
          onCommit={(thrustSoundVolume) =>
            patchShipControllerStats(ctx, component, stats, {
              thrustSoundVolume: Math.min(1, Math.max(0, thrustSoundVolume)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Max HP" wide>
        <NumberField
          value={stats.maxHp ?? 1000}
          onCommit={(maxHp) =>
            patchShipControllerStats(ctx, component, stats, {
              maxHp: Math.min(100_000, Math.max(1, maxHp)),
            })
          }
        />
      </FieldRow>
    </>
  );
}

function ShipControllerRampFields({
  ctx,
  component,
  ramp,
}: {
  ctx: ComponentFieldContext;
  component: ShipControllerComponent;
  ramp: NonNullable<ShipControllerComponent['ramp']>;
}): ReactElement {
  const { update, store, options } = ctx;
  return (
    <>
      <SectionLabel>Ramp</SectionLabel>
      <FieldRow label="Hinge" wide>
        <GlbNodeRefField
          store={store}
          value={ramp.hinge?.node ?? 'RampParent'}
          onCommit={(node) =>
            update({
              ...component,
              ramp: {
                ...ramp,
                hinge: {
                  ...ramp.hinge,
                  node,
                  lowerRadians: ramp.hinge?.lowerRadians ?? -0.85,
                },
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Lower °" wide>
        <NumberField
          value={ramp.hinge?.lowerRadians ?? -0.85}
          onCommit={(lowerRadians) =>
            update({
              ...component,
              ramp: {
                ...ramp,
                hinge: {
                  node: ramp.hinge?.node ?? 'RampParent',
                  lowerRadians: Math.min(10, Math.max(-10, lowerRadians)),
                  axis: ramp.hinge?.axis,
                },
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label="Preview" wide>
        <EdButton
          title="Play the ramp raise / lower in the viewport at the in-game rate"
          onClick={() => options.onPlayShipRampPreview?.()}
        >
          Play
        </EdButton>
      </FieldRow>
      <FieldRow label="Out btn" wide>
        <EntityRefField
          store={store}
          value={ramp.outsideInteractId}
          onPick={(outsideInteractId) =>
            update({ ...component, ramp: { ...ramp, outsideInteractId } })
          }
        />
      </FieldRow>
      <FieldRow label="Deck btn" wide>
        <EntityRefField
          store={store}
          value={ramp.deckInteractId}
          onPick={(deckInteractId) =>
            update({ ...component, ramp: { ...ramp, deckInteractId } })
          }
        />
      </FieldRow>
      <AssetUrlField
        label="Open SFX"
        value={ramp.openSoundUrl}
        onCommit={(openSoundUrl) =>
          update({ ...component, ramp: { ...ramp, openSoundUrl } })
        }
      />
      <AssetUrlField
        label="Close SFX"
        value={ramp.closeSoundUrl}
        onCommit={(closeSoundUrl) =>
          update({ ...component, ramp: { ...ramp, closeSoundUrl } })
        }
      />
    </>
  );
}

function ShipControllerGearFields({
  ctx,
  component,
  gear,
}: {
  ctx: ComponentFieldContext;
  component: ShipControllerComponent;
  gear: NonNullable<ShipControllerComponent['gear']>;
}): ReactElement {
  const { update } = ctx;
  return (
    <>
      <SectionLabel>Landing gear</SectionLabel>
      <AssetUrlField
        label="Deploy SFX"
        value={gear.deploySoundUrl}
        onCommit={(deploySoundUrl) =>
          update({
            ...component,
            gear: { ...gear, nodes: gear.nodes ?? [], deploySoundUrl },
          })
        }
      />
      <AssetUrlField
        label="Retract SFX"
        value={gear.retractSoundUrl}
        onCommit={(retractSoundUrl) =>
          update({
            ...component,
            gear: { ...gear, nodes: gear.nodes ?? [], retractSoundUrl },
          })
        }
      />
      <EmptyNote>
        {gear.nodes.length} gear hinge(s). Add doors/cubbies as Ship Door marker empties
        (Open/Close SFX in inspector). Legacy controller.doors[] still bakes if present.
      </EmptyNote>
    </>
  );
}

export function ShipControllerFields({
  ctx,
  component,
}: ComponentFieldsProps<ShipControllerComponent>): ReactElement {
  const stats = component.stats ?? {};
  const gear = component.gear ?? { nodes: [] };
  const ramp = component.ramp ?? {
    hinge: { node: 'RampParent', lowerRadians: -0.85 },
  };

  return (
    <>
      <ShipControllerRestFields ctx={ctx} component={component} />
      <ShipControllerCoreStatFields ctx={ctx} component={component} stats={stats} />
      <ShipControllerThrustFields ctx={ctx} component={component} stats={stats} />
      <ShipControllerTorqueFields ctx={ctx} component={component} stats={stats} />
      <ShipControllerCameraFeelFields ctx={ctx} component={component} stats={stats} />
      <ShipControllerAudioFields ctx={ctx} component={component} stats={stats} />
      <ShipControllerRampFields ctx={ctx} component={component} ramp={ramp} />
      <ShipControllerSeats ctx={ctx} component={component} />
      <ShipControllerGearFields ctx={ctx} component={component} gear={gear} />
    </>
  );
}
