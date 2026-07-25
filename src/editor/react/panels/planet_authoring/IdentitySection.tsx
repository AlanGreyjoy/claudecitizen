import type { ReactElement } from 'react';
import { EmptyNote } from '../InspectorForm';
import { PlanetNumberField, PlanetTextField } from './Fields';
import type { PlanetAuthoringSectionProps } from './section-types';

export function IdentitySection({ doc, onMarkDirty }: PlanetAuthoringSectionProps): ReactElement {
  return (
    <>
      <EmptyNote>
        Saving creates a reusable planet document. System Map can place it by this planet id.
      </EmptyNote>
      <PlanetTextField
        label="Id"
        value={doc.id}
        onChange={(value) => {
          doc.id = value.trim().toLowerCase();
          onMarkDirty();
        }}
      />
      <PlanetTextField
        label="Name"
        value={doc.name}
        onChange={(value) => {
          doc.name = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Seed"
        value={doc.seed}
        step={1}
        onChange={(value) => {
          doc.seed = Math.round(value);
          onMarkDirty();
        }}
      />
    </>
  );
}
