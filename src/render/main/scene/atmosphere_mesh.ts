import * as THREE from 'three';
import type { Planet } from '../../../types';

export function buildAtmosphereMesh(planet: Planet, renderScale: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(
      (planet.radiusMeters + planet.atmosphereHeightMeters) * renderScale,
      80,
      56,
    ),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x69aef8,
      depthWrite: false,
      opacity: 0.14,
      side: THREE.BackSide,
      transparent: true,
    }),
  );
}
