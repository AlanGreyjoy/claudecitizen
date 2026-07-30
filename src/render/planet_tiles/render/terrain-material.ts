import * as THREE from 'three';
import {
  MeshLambertNodeMaterial,
  type Node,
  type NodeBuilder,
} from 'three/webgpu';
import { clamp, diffuseColor, float } from 'three/tsl';

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

/**
 * WebGPU/TSL counterpart to the legacy `onBeforeCompile` terrain material.
 *
 * Keep this separate while the game renderer is still WebGL. The tile manager
 * accepts a material factory, so the runtime flip can select this node material
 * without branching inside terrain streaming or mesh-cache code.
 */
class TerrainNodeMaterial extends MeshLambertNodeMaterial {
  override setupLighting(builder: NodeBuilder): Node {
    const terrainLit = super.setupLighting(builder);
    const terrainLitLum = terrainLit.r.max(terrainLit.g).max(terrainLit.b);
    const terrainAlbedoLum = diffuseColor.r
      .max(diffuseColor.g)
      .max(diffuseColor.b);
    const terrainRescue = clamp(
      float(0.06).sub(terrainLitLum).mul(8),
      0,
      1,
    )
      .mul(terrainAlbedoLum)
      .mul(terrainAlbedoLum)
      .mul(0.1);
    return terrainLit.add(diffuseColor.rgb.mul(terrainRescue));
  }
}

export function createWebGpuTerrainMaterial(): MeshLambertNodeMaterial {
  return new TerrainNodeMaterial({
    dithering: true,
    flatShading: true,
    side: THREE.FrontSide,
    vertexColors: true,
  });
}
