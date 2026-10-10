import * as THREE from "three";
import { FX_LIGHT, fxTime } from "../particles";

// Auras round the pilot for the design list's items (looks only): a faceted
// shell drawn with soft, painted-on light, in one of a few styles. Normal
// blending with light colors, so they read against a bright day sky instead
// of blooming it white; only the brightest edges go over the bloom threshold.

/** 0 ice facets (Starflake Shield), 1 flames (the phoenix), 2 crackling lightning (Electro-Charged Prism), 3 a soft veil (Illusory Moth Cape) */
export type AuraStyle = 0 | 1 | 2 | 3;

const vertexShader = /* glsl */ `
  attribute vec3 bary;
  varying vec3 vBary;
  varying vec3 vLocal;
  varying float vFacing;
  varying float vNear;
  void main() {
    vBary = bary;
    vLocal = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mvPosition.xyz)));
    vNear = smoothstep(0.6, 2.5, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform vec3 edgeColor;
  uniform float opacity;
  uniform float time;
  uniform float style;
  uniform float boost;
  varying vec3 vBary;
  varying vec3 vLocal;
  varying float vFacing;
  varying float vNear;
  void main() {
    float rim = clamp(1.0 - vFacing, 0.0, 1.0);
    float fresnel = rim * rim;
    float facet = min(vBary.x, min(vBary.y, vBary.z));
    float edge = 1.0 - smoothstep(0.0, 0.07, facet);
    vec3 d = normalize(vLocal + vec3(1e-4));
    float a = 0.0;
    vec3 c = color;
    if (style < 0.5) {
      // Ice: panes of frost with bright seams, a shimmer running across them
      float shimmer = 0.5 + 0.5 * sin(time * 3.0 + d.y * 7.0 + d.x * 5.0);
      a = fresnel * 0.5 + edge * (0.35 + 0.4 * shimmer) + 0.05;
      c = mix(color, edgeColor * (1.0 + 0.5 * boost), edge * shimmer);
    } else if (style < 1.5) {
      // Flames licking upwards over the shell
      float lick = sin(d.y * 9.0 - time * 7.0 + sin(atan(d.z, d.x + 1e-4) * 5.0 + time * 2.0) * 1.5);
      float flame = smoothstep(0.1, 0.9, lick) * smoothstep(-0.8, 0.6, d.y);
      a = fresnel * 0.55 + flame * 0.4 * (0.4 + rim);
      c = mix(color, edgeColor * (1.0 + 0.6 * boost), flame);
    } else if (style < 2.5) {
      // Lightning: thin veins crawling across, flickering
      float vein = abs(sin(d.x * 11.0 + sin(d.y * 7.0 + time * 9.0) * 2.0 + time * 3.0));
      float bolt = 1.0 - smoothstep(0.0, 0.08, vein);
      float flick = step(0.35, fract(sin(floor(time * 18.0) * 12.9898) * 43758.5453));
      a = fresnel * 0.4 + bolt * 0.8 * flick + edge * 0.15;
      c = mix(color, edgeColor * (1.2 + 0.6 * boost), bolt);
    } else {
      // A soft veil, breathing
      float breathe = 0.6 + 0.4 * sin(time * 2.0 + d.y * 3.0);
      a = fresnel * 0.7 * breathe + 0.04;
      c = mix(color, edgeColor, fresnel);
    }
    gl_FragColor = vec4(c, clamp(a * opacity * vNear, 0.0, 1.0));
  }
`;

/** A faceted shell of radius 1 round the origin: scale it to the pilot */
export function auraMesh(style: AuraStyle, color: THREE.ColorRepresentation, edge: THREE.ColorRepresentation, detail = 2): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
  const count = geometry.getAttribute("position").count;
  const bary = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) bary[i * 3 + (i % 3)] = 1;
  geometry.setAttribute("bary", new THREE.BufferAttribute(bary, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      edgeColor: { value: new THREE.Color(edge) },
      opacity: { value: 0 },
      time: fxTime,
      style: { value: style },
      boost: FX_LIGHT.boost,
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 7;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}
