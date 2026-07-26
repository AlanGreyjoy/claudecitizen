import { useState, type ReactElement } from 'react';
import { ENTITY_DND_TYPE } from '../../../api';
import {
  findEntityById,
  parseDraggedEntityIds,
} from '../../../panels/inspector-logic';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import type { ComponentFieldContext } from './context';
import {
  CheckboxRow,
  EmptyNote,
  EntityRefField,
  FieldRow,
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

/**
 * Hierarchy drag targets for `ship-controller.seats[]`. Empty marker entities
 * supply world pose at bake; Co-pilot toggles `role` between pilot and copilot.
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
        <ul className="ed-ship-seats-list">
          {seats.map((seat, index) => (
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
              <CheckboxRow
                label="Co-pilot"
                checked={seat.role === 'copilot'}
                onChange={(copilot) => {
                  setSeats(
                    seats.map((entry, i) =>
                      i === index
                        ? { ...entry, role: copilot ? 'copilot' : 'pilot' }
                        : entry,
                    ),
                  );
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
