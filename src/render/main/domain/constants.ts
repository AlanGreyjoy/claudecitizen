import * as THREE from 'three';

export const SKY_LOW_COLOR = new THREE.Color(0x6ca5e0);
export const SKY_MID_COLOR = new THREE.Color(0x284f88);
export const SKY_HIGH_COLOR = new THREE.Color(0x01040b);
export const HAZE_LOW_COLOR = new THREE.Color(0xb8daf2);
export const SPACE_FOG_COLOR = new THREE.Color(0x050915);
// Moonlit-blue night rather than near-black: keeps terrain and tree
// silhouettes readable after tone mapping.
export const NIGHT_SKY_COLOR = new THREE.Color(0x0c1730);
export const NIGHT_FOG_COLOR = new THREE.Color(0x0b1526);

export const DAY_LENGTH_SECONDS = 240;
export const PLANET_FOG_MAX_ALTITUDE_METERS = 72_000;

export const DEFAULT_FOG_NEAR = 240;
export const DEFAULT_FOG_FAR = 2600;
export const DEFAULT_FOG_COLOR = 0xb8daf2;
