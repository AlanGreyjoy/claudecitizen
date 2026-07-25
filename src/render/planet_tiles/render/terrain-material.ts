import * as THREE from 'three';

/**
 * Flat-shaded terrain with vertex colors. Bright albedos (snow) get a tiny
 * rescue only when lighting has crushed them nearly black — never a constant
 * emissive glow against a night sky.
 */
export function createTerrainMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    dithering: true,
    flatShading: true,
    side: THREE.FrontSide,
    vertexColors: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
      /* glsl */ `
			vec3 terrainLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
			float terrainLitLum = max(terrainLit.r, max(terrainLit.g, terrainLit.b));
			float terrainAlbedoLum = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
			// Only when under-lit: ease crushed snow toward a soft moonlit gray.
			float terrainRescue = clamp((0.06 - terrainLitLum) * 8.0, 0.0, 1.0)
				* terrainAlbedoLum * terrainAlbedoLum * 0.1;
			vec3 outgoingLight = terrainLit + diffuseColor.rgb * terrainRescue + totalEmissiveRadiance;
			`,
    );
  };
  material.customProgramCacheKey = () => 'terrain-albedo-rescue-v2';

  return material;
}
