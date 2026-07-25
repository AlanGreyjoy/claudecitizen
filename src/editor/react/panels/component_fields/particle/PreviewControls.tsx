import type { ReactElement } from 'react';
import { CheckboxRow, EdButton, FieldRow } from '../../InspectorForm';
import type { ComponentFieldsProps } from '../context';
import type { ParticleComponent } from './types';

type PreviewControlsProps = Pick<ComponentFieldsProps<ParticleComponent>, 'ctx'> & {
  entityId: string | undefined;
};

export function ParticlePreviewControls({
  ctx,
  entityId,
}: PreviewControlsProps): ReactElement | null {
  const preview = ctx.options.particlePreview;
  if (!entityId || !preview) return null;

  return (
    <FieldRow label="">
      <CheckboxRow
        label="Playing"
        checked={preview.isPlaying(entityId)}
        onChange={(playing) => preview.setPlaying(entityId, playing)}
      />
      <EdButton onClick={() => preview.restart(entityId)}>Restart</EdButton>
      <span />
    </FieldRow>
  );
}
