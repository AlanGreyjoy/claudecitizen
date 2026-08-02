import * as THREE from 'three';

export const SKY_LOW_COLOR = new THREE.Color(0x6ca5e0);
export const SKY_MID_COLOR = new THREE.Color(0x284f88);
export const SKY_HIGH_COLOR = new THREE.Color(0x01040b);
export const HAZE_LOW_COLOR = new THREE.Color(0xb8daf2);
export const SPACE_FOG_COLOR = new THREE.Color(0x050915);
// Night sky and night fog are authored per planet (`sky.night` in the planet
// document) and resolved through `domain/sky-recipe.ts`.

export const PLANET_FOG_MAX_ALTITUDE_METERS = 72_000;

/**
 * Authored geometry radii of the space-view sun and moon spheres.
 *
 * These bodies are anchored 200 km out in scene space and are scaled per frame
 * so their discs subtend the planet's authored angular diameters; the mesh
 * radius is only the unit the scale factor divides by.
 */
export const SUN_MESH_RADIUS = 12_000;
export const MOON_MESH_RADIUS = 7_000;
/** Volumetric fog only runs on the planet surface path; keep ray steps cheap. */
export const SURFACE_FOG_RAY_STEPS = 8;
/** Cap High's 2× DPR while on the surface so look-down fill-rate stays playable. */
export const SURFACE_MAX_PIXEL_RATIO = 1.25;

export const DEFAULT_FOG_NEAR = 240;
export const DEFAULT_FOG_FAR = 2600;
export const DEFAULT_FOG_COLOR = 0xb8daf2;
