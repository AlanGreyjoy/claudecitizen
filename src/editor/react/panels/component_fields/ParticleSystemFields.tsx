import type { ReactElement } from 'react';
import type { ComponentFieldsProps } from './context';
import { ParticleColorModule } from './particle/ColorModule';
import { ParticleCollisionModule } from './particle/CollisionModule';
import { ParticleEmissionModule } from './particle/EmissionModule';
import { ParticleForceModule } from './particle/ForceModule';
import { ParticleMainModule } from './particle/MainModule';
import { ParticlePreviewControls } from './particle/PreviewControls';
import { ParticleRendererModule } from './particle/RendererModule';
import { ParticleShapeModule } from './particle/ShapeModule';
import { ParticleSizeModule } from './particle/SizeModule';
import { ParticleTextureSheetModule } from './particle/TextureSheetModule';
import { ParticleTrailsModule } from './particle/TrailsModule';
import type { ParticleComponent } from './particle/types';
import { ParticleVelocityModule } from './particle/VelocityModule';

export function ParticleSystemFields({
  ctx,
  component,
}: ComponentFieldsProps<ParticleComponent>): ReactElement {
  const { update, fieldOptions } = ctx;
  const entityId = fieldOptions?.entityId;

  const shape = component.shape;
  const vel = component.velocityOverLifetime ?? {
    enabled: false,
    space: 'local' as const,
    linear: { x: 0, y: 0, z: 0 },
    orbital: { x: 0, y: 0, z: 0 },
    radial: 0,
  };
  const force = component.forceOverLifetime ?? {
    enabled: false,
    space: 'local' as const,
    force: { x: 0, y: 0, z: 0 },
  };
  const colorOver = component.colorOverLifetime ?? {
    enabled: false,
    gradient: [
      { t: 0, color: component.startColor, alpha: 1 },
      { t: 1, color: component.startColor, alpha: 0 },
    ],
  };
  const sizeOver = component.sizeOverLifetime ?? {
    enabled: false,
    curve: [
      { t: 0, value: 1 },
      { t: 1, value: 0 },
    ],
  };
  const sheet = component.textureSheetAnimation ?? {
    enabled: false,
    tilesX: 1,
    tilesY: 1,
    animation: 'whole-sheet' as const,
    cycles: 1,
    startFrame: 0,
  };
  const collision = component.collision ?? {
    enabled: false,
    type: 'planes' as const,
    groundPlane: true,
    planes: [],
    dampen: 0.1,
    bounce: 0.3,
    lifetimeLoss: 0.1,
    maxKillSpeed: 100,
  };
  const trails = component.trails ?? {
    enabled: false,
    ratio: 0.3,
    lifetime: 0.35,
    minVertexDistance: 0.05,
    widthOverTrail: [
      { t: 0, value: 1 },
      { t: 1, value: 0 },
    ],
    colorOverTrail: [
      { t: 0, color: component.startColor, alpha: 0.8 },
      { t: 1, color: component.startColor, alpha: 0 },
    ],
    dieWithParticles: true,
  };
  const renderer = component.renderer;
  const moduleProps = { component, update };

  return (
    <>
      <ParticlePreviewControls ctx={ctx} entityId={entityId} />
      <ParticleMainModule {...moduleProps} />
      <ParticleEmissionModule {...moduleProps} />
      <ParticleShapeModule {...moduleProps} shape={shape} />
      <ParticleVelocityModule {...moduleProps} vel={vel} />
      <ParticleForceModule {...moduleProps} force={force} />
      <ParticleColorModule {...moduleProps} colorOver={colorOver} />
      <ParticleSizeModule {...moduleProps} sizeOver={sizeOver} />
      <ParticleTextureSheetModule {...moduleProps} sheet={sheet} />
      <ParticleCollisionModule {...moduleProps} collision={collision} />
      <ParticleTrailsModule {...moduleProps} trails={trails} />
      <ParticleRendererModule {...moduleProps} renderer={renderer} />
    </>
  );
}
