import { useState, type ReactElement } from 'react';
import { ENTITY_DND_TYPE } from '../../../api';
import {
  findEntityById,
  parseDraggedEntityIds,
} from '../../../panels/inspector-logic';
import type { EditorStore } from '../../../document';
import type { PrefabComponent, ShipSeatRole } from '../../../../world/prefabs/schema';
import type { ComponentFieldContext } from './context';
import {
  EmptyNote,
  EntityRefField,
  FieldRow,
  Hint,
  RemoveButton,
  SectionLabel,
} from '../InspectorForm';

type ShipControllerComponent = Extract<PrefabComponent, { type: 'ship-controller' }>;
type ShipSeat = NonNullable<ShipControllerComponent['seats']>[number];

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

/** Seat settings authored on the marker itself, legacy `pilot-seat` included. */
function findSeatComponent(
  store: EditorStore,
  entityId: string,
): Extract<PrefabComponent, { type: 'ship-seat' } | { type: 'pilot-seat' }> | null {
  const entity = findEntityById(store.getState().roots, entityId);
  for (const component of entity?.components ?? []) {
    if (component.type === 'ship-seat' || component.type === 'pilot-seat') {
      return component;
    }
  }
  return null;
}

/**
 * Registering an empty as a seat should be one gesture. Without the component
 * the entity has nowhere to hold role / eye / stand, and the author would have
 * to know to add it by hand — so the drop adds it, defaulted to pilot.
 */
function ensureSeatComponent(store: EditorStore, entityId: string): void {
  const entity = findEntityById(store.getState().roots, entityId);
  if (!entity) return;
  if (findSeatComponent(store, entityId)) return;
  store.setComponents(entityId, [
    ...entity.components,
    {
      type: 'ship-seat',
      role: 'pilot',
      eye: { x: 0, y: 0.87, z: 0.25 },
      stand: { x: 0, z: -1.55 },
      interactRadius: 1.45,
    },
  ]);
}

function seatRoleLabel(
  store: EditorStore,
  seat: ShipSeat,
): { text: string; role: ShipSeatRole | null } {
  const authored = findSeatComponent(store, seat.entityId);
  const role = authored?.role ?? seat.role ?? null;
  if (!authored) {
    return {
      text: role ? `${role} · legacy settings on the controller` : 'no Ship Seat component',
      role,
    };
  }
  return { text: role ?? 'passenger', role };
}

/**
 * Hierarchy drag targets for `ship-controller.seats[]`. This list only decides
 * *which* entities are seats and in what order (the first pilot-role seat
 * drives flight anchors) — role, eye, stand, and reach live on each marker's
 * own `ship-seat` component, so they are edited where the gizmo is.
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
      ensureSeatComponent(store, id);
      added.push({ entityId: id });
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
          Drop seat marker empties here — each one gets a Ship Seat component.
          First pilot seat drives flight anchors.
        </EmptyNote>
      ) : (
        <>
          <Hint>
            Select a seat entity to edit its role, eye, stand, and reach on its Ship
            Seat component. This list only sets which entities are seats and their
            order.
          </Hint>
          <ul className="ed-ship-seats-list">
            {seats.map((seat, index) => {
              const label = seatRoleLabel(store, seat);
              return (
                <li key={`${seat.entityId}:${index}`} className="ed-ship-seats-item">
                  <FieldRow label={`Seat ${index + 1}`} wide>
                    <EntityRefField
                      store={store}
                      value={seat.entityId}
                      onPick={(nextId) => {
                        if (!nextId) {
                          setSeats(seats.filter((_, i) => i !== index));
                          return;
                        }
                        if (
                          seats.some(
                            (other, i) => i !== index && other.entityId === nextId,
                          )
                        ) {
                          return;
                        }
                        if (!findEntityById(store.getState().roots, nextId)) return;
                        ensureSeatComponent(store, nextId);
                        setSeats(
                          seats.map((entry, i) =>
                            i === index ? { ...entry, entityId: nextId } : entry,
                          ),
                        );
                      }}
                    />
                    <RemoveButton
                      title="Remove seat"
                      onClick={() => setSeats(seats.filter((_, i) => i !== index))}
                    />
                  </FieldRow>
                  <EmptyNote>{label.text}</EmptyNote>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
