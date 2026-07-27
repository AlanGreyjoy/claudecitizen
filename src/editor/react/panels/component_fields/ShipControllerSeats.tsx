import { useState, type ReactElement } from 'react';
import { ENTITY_DND_TYPE } from '../../../api';
import {
  findEntityById,
  parseDraggedEntityIds,
} from '../../../panels/inspector-logic';
import type { PrefabComponent, ShipSeatRole } from '../../../../world/prefabs/schema';
import { SHIP_SEAT_ROLES } from '../../../../world/prefabs/schema';
import type { ComponentFieldContext } from './context';
import {
  EmptyNote,
  EntityRefField,
  FieldRow,
  Hint,
  NumberField,
  RemoveButton,
  SectionLabel,
  SelectField,
  Vec3NumberRow,
} from '../InspectorForm';

type ShipControllerComponent = Extract<PrefabComponent, { type: 'ship-controller' }>;
type ShipSeat = NonNullable<ShipControllerComponent['seats']>[number];

/** Must match `bakeControllerSeat` in ship-runtime.ts. */
const SEAT_DEFAULT_EYE = { x: 0, y: 0.87, z: 0.25 };
const SEAT_DEFAULT_STAND = { x: 0, z: -1.55 };
const SEAT_DEFAULT_INTERACT_RADIUS = 1.45;

export type ShipControllerSeatsProps = {
  ctx: ComponentFieldContext;
  component: ShipControllerComponent;
};

function commitSeats(
  ctx: ComponentFieldContext,
  component: ShipControllerComponent,
  seats: ShipSeat[] | undefined,
): void {
  ctx.update({ ...component, seats });
}

/**
 * One seat row. The marker empty is the seated character's **root**, which the
 * avatar renders at floor level — so it belongs on the deck under the chair,
 * not on the cushion. Eye is the offset from there to the cockpit camera, and
 * is the field to tune for first-person feel; moving the marker to fix the view
 * instead drags the body off the seat and breaks the sitting pose.
 */
function ShipSeatRow({
  seat,
  index,
  seats,
  store,
  setSeats,
}: {
  seat: ShipSeat;
  index: number;
  seats: ShipSeat[];
  store: ComponentFieldContext['store'];
  setSeats: (next: ShipSeat[]) => void;
}): ReactElement {
  const patch = (next: Partial<ShipSeat>): void => {
    setSeats(seats.map((entry, i) => (i === index ? { ...entry, ...next } : entry)));
  };
  const eye = seat.eye ?? SEAT_DEFAULT_EYE;
  const stand = seat.stand ?? SEAT_DEFAULT_STAND;
  return (
    <li className="ed-ship-seats-item">
      <FieldRow label={`Seat ${index + 1}`} wide>
        <EntityRefField
          store={store}
          value={seat.entityId}
          onPick={(nextId) => {
            if (!nextId) {
              setSeats(seats.filter((_, i) => i !== index));
              return;
            }
            if (seats.some((other, i) => i !== index && other.entityId === nextId)) return;
            if (!findEntityById(store.getState().roots, nextId)) return;
            patch({ entityId: nextId });
          }}
        />
        <RemoveButton
          title="Remove seat"
          onClick={() => setSeats(seats.filter((_, i) => i !== index))}
        />
      </FieldRow>
      <FieldRow label="Role" wide>
        <SelectField
          options={SHIP_SEAT_ROLES}
          value={seat.role ?? 'passenger'}
          onCommit={(role) => patch({ role: role as ShipSeatRole })}
        />
      </FieldRow>
      <Vec3NumberRow
        label="Eye"
        values={eye}
        onCommitAxis={(axis, next) => patch({ eye: { ...eye, [axis]: next } })}
      />
      <FieldRow label="Stand">
        <NumberField
          value={stand.x}
          onCommit={(x) => patch({ stand: { ...stand, x } })}
        />
        <NumberField
          value={stand.z}
          onCommit={(z) => patch({ stand: { ...stand, z } })}
        />
        <span />
        <span />
      </FieldRow>
      <FieldRow label="Reach">
        <NumberField
          value={seat.interactRadius ?? SEAT_DEFAULT_INTERACT_RADIUS}
          onCommit={(next) =>
            patch({ interactRadius: Math.min(10, Math.max(0.5, next)) })
          }
        />
        <span />
        <span />
        <span />
      </FieldRow>
    </li>
  );
}

/**
 * Hierarchy drag targets for `ship-controller.seats[]`. Empty marker entities
 * supply world pose at bake; per-seat role, eye, stand, and reach are edited
 * here.
 */
export function ShipControllerSeats({
  ctx,
  component,
}: ShipControllerSeatsProps): ReactElement {
  const { store } = ctx;
  const seats = component.seats ?? [];
  const [dropActive, setDropActive] = useState(false);

  const setSeats = (next: ShipSeat[]): void => {
    commitSeats(ctx, component, next.length > 0 ? next : undefined);
  };

  const appendIds = (ids: readonly string[]): void => {
    const roots = store.getState().roots;
    const known = new Set(seats.map((seat) => seat.entityId));
    const added: ShipSeat[] = [];
    for (const id of ids) {
      if (!id || known.has(id)) continue;
      if (!findEntityById(roots, id)) continue;
      known.add(id);
      added.push({ entityId: id, role: 'pilot' });
    }
    if (added.length > 0) setSeats([...seats, ...added]);
  };

  return (
    <>
      <SectionLabel>Seats</SectionLabel>
      <div
        className={`ed-collider-exclude-drop${dropActive ? ' is-drop-target' : ''}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(ENTITY_DND_TYPE)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'copy';
          setDropActive(true);
        }}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes(ENTITY_DND_TYPE)) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(event) => {
          setDropActive(false);
          const ids = parseDraggedEntityIds(
            event.dataTransfer.getData(ENTITY_DND_TYPE),
          );
          if (ids.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          appendIds(ids);
        }}
      >
        Drag empties from Hierarchy
      </div>
      {seats.length === 0 ? (
        <EmptyNote>
          Drop seat marker empties here. First pilot seat drives flight anchors.
        </EmptyNote>
      ) : (
        <>
          <Hint>
            Marker = the seated character&apos;s root, rendered at floor level — put it
            on the deck under the chair, not on the cushion. Tune first-person height
            with Eye, never by raising the marker.
          </Hint>
          <ul className="ed-ship-seats-list">
            {seats.map((seat, index) => (
              <ShipSeatRow
                key={`${seat.entityId}:${index}`}
                seat={seat}
                index={index}
                seats={seats}
                store={store}
                setSeats={setSeats}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
