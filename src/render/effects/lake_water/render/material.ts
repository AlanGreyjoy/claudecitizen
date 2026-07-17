import * as THREE from 'three';

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>

uniform vec3 sunDirection;

attribute vec3 barycentric;
attribute vec3 color;
attribute float effectDetail;
attribute float shore;
attribute float waterDepth;

varying vec3 vBarycentric;
varying vec3 vFacetColor;
varying vec3 vSunDirection;
varying vec3 vViewNormal;
varying vec3 vViewDir;
varying float vEffectDetail;
varying float vShore;
varying float vWaterDepth;

void main() {
  vBarycentric = barycentric;
  vFacetColor = color;
  vEffectDetail = effectDetail;
  vShore = shore;
  vWaterDepth = waterDepth;
  vViewNormal = normalize(normalMatrix * normal);
  vSunDirection = normalize((viewMatrix * vec4(sunDirection, 0.0)).xyz);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewDir = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

uniform float time;
uniform vec3 sunColor;
uniform vec3 skyColor;

varying vec3 vBarycentric;
varying vec3 vFacetColor;
varying vec3 vSunDirection;
varying vec3 vViewNormal;
varying vec3 vViewDir;
varying float vEffectDetail;
varying float vShore;
varying float vWaterDepth;

void main() {
  #include <logdepthbuf_fragment>

  vec3 viewDir = normalize(vViewDir);
  vec3 normal = normalize(vViewNormal);
  vec3 lightDirection = normalize(vSunDirection);
  float facing = max(dot(viewDir, normal), 0.0);
  float fresnel = pow(1.0 - facing, 2.5);

  float diffuse = max(dot(lightDirection, normal), 0.0);
  float lightBand = floor(diffuse * 3.0 + 0.5) / 3.0;
  float facetPhase = dot(vFacetColor, vec3(13.17, 21.73, 9.41));
  float shimmer = 0.98 + sin(time * 0.65 + facetPhase) * 0.02;
  vec3 scatter = vFacetColor * (0.64 + lightBand * 0.36) * shimmer;
  float shallow = 1.0 - smoothstep(2.0, 22.0, max(vWaterDepth, 0.0));
  vec3 shallowTint = vec3(0.18, 0.54, 0.52);
  scatter = mix(scatter, shallowTint * (0.72 + lightBand * 0.28), shallow * 0.3);

  vec3 halfDir = normalize(lightDirection + viewDir);
  float spec = step(0.965, max(dot(normal, halfDir), 0.0));

  vec3 color = mix(scatter, skyColor, fresnel * 0.52);
  color += sunColor * spec * 0.28;

  vec3 baryWidth = fwidth(vBarycentric);
  vec3 barySmooth = smoothstep(baryWidth * 0.7, baryWidth * 1.9, vBarycentric);
  float facetEdge = 1.0 - min(min(barySmooth.x, barySmooth.y), barySmooth.z);
  float causticPulse = 0.78 + sin(time * 0.7 + facetPhase * 2.0) * 0.22;
  float caustic =
    facetEdge * shallow * (1.0 - smoothstep(0.25, 0.8, vShore)) * vEffectDetail;
  color = mix(color, vec3(0.46, 0.86, 0.78), caustic * causticPulse * 0.24);

  float foamThreshold = 0.48 + sin(time * 0.85 + facetPhase * 2.7) * 0.07;
  float foam = smoothstep(foamThreshold, foamThreshold + 0.2, vShore);
  float foamBreakup =
    0.78 + sin((vBarycentric.x * 1.7 + vBarycentric.y * 2.3) * 8.0 + facetPhase) * 0.22;
  foam *= foamBreakup * vEffectDetail;
  color = mix(color, vec3(0.94, 0.99, 1.0), clamp(foam, 0.0, 1.0));

  float alpha = mix(0.86, 0.95, fresnel);
  alpha = mix(alpha, 0.7, shallow * 0.42);
  alpha = mix(alpha, 0.98, clamp(foam, 0.0, 1.0));
  gl_FragColor = vec4(color, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createLakeWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    fog: true,
    fragmentShader,
    side: THREE.FrontSide,
    transparent: true,
    uniforms: {
      // fog: true pulls in the fog shader chunks, which read these uniforms
      // whenever scene.fog is a THREE.Fog (true at orbital altitudes where the
      // volumetric fog pass hands back to classic fog). Without them three
      // crashes in refreshFogUniforms.
      fogColor: { value: new THREE.Color(0xffffff) },
      fogDensity: { value: 0.00025 },
      fogFar: { value: 2000 },
      fogNear: { value: 1 },
      skyColor: { value: new THREE.Color(0x7eb8e8) },
      sunColor: { value: new THREE.Color(0xffffff) },
      sunDirection: { value: new THREE.Vector3(0.4, 0.85, 0.2).normalize() },
      time: { value: 0 },
    },
    vertexShader,
  });
}
