import * as THREE from "three";
import { TERRAIN } from "../../tuning";
import { atmospheric } from "../atmosphere";
import type { Layers } from "../biomes/types";

// The terrain shader for generator-v2 land, on top of atmospheric() (haze,
// mist, backlit rims). Each triangle arrives flat-painted from the mesher: a
// rock color, the color of its cover (grass, moss, sand…), wetness, glow and a
// snow height. Here they are blended by the face's slope: cover on the flat,
// a band of soil where it breaks, rock on the steep; sand and dark wet rock at
// the water's edge; snow above the snow line on faces flat enough to hold it.
// Cliffs get a soft triplanar noise so they read as painted stone. Inputs are
// constant over a face, so the land keeps its flat-shaded, low-poly look.

export interface TerrainUniforms {
  dirt: { value: THREE.Color };
  sand: { value: THREE.Color };
  snowColor: { value: THREE.Color };
  glowColor: { value: THREE.Color };
  snowLine: { value: number };
  coverSlope: { value: number };
  texture: { value: number };
  textureScale: { value: number };
  glow: { value: number };
}

const PARS = /* glsl */ `
  uniform vec3 terrainDirt;
  uniform vec3 terrainSand;
  uniform vec3 terrainSnow;
  uniform vec3 terrainGlowColor;
  uniform float terrainSnowLine;
  uniform float terrainCoverSlope;
  uniform float terrainTexture;
  uniform float terrainTextureScale;
  uniform float terrainGlow;
  varying vec4 vRock;
  varying vec4 vCover;
  varying float vSnow;
  varying float vCrystal;

  float terrainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float terrainNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), u.x), mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float terrainPaint(vec2 p) { return terrainNoise(p) * 0.6 + terrainNoise(p * 2.7 + 5.3) * 0.4; }
  // Noise projected along the three axes, weighted by the normal: no stretching on cliffs
  float terrainTriplanar(vec3 p, vec3 n) {
    vec3 w = abs(n);
    w = w * w * w * w;
    w /= max(w.x + w.y + w.z, 1e-4);
    return terrainPaint(p.yz) * w.x + terrainPaint(p.xz) * w.y + terrainPaint(p.xy) * w.z;
  }
`;

/** Lambert + atmosphere + the terrain blend. One material for all of a level's land */
export function terrainMaterial(layers: Layers): { material: THREE.MeshLambertMaterial; uniforms: TerrainUniforms } {
  const uniforms: TerrainUniforms = {
    dirt: { value: new THREE.Color(layers.dirt) },
    sand: { value: new THREE.Color(layers.sand) },
    snowColor: { value: new THREE.Color(layers.snow) },
    glowColor: { value: new THREE.Color(layers.glow) },
    snowLine: { value: layers.snowLine },
    coverSlope: { value: layers.topSlope },
    texture: { value: layers.texture },
    textureScale: { value: 1 },
    glow: { value: 1 },
  };
  const material = atmospheric(new THREE.MeshLambertMaterial({ flatShading: true }), 0.35);
  const atmosphere = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    atmosphere(shader, renderer);
    shader.uniforms.terrainDirt = uniforms.dirt;
    shader.uniforms.terrainSand = uniforms.sand;
    shader.uniforms.terrainSnow = uniforms.snowColor;
    shader.uniforms.terrainGlowColor = uniforms.glowColor;
    shader.uniforms.terrainSnowLine = uniforms.snowLine;
    shader.uniforms.terrainCoverSlope = uniforms.coverSlope;
    shader.uniforms.terrainTexture = uniforms.texture;
    shader.uniforms.terrainTextureScale = uniforms.textureScale;
    shader.uniforms.terrainGlow = uniforms.glow;
    shader.vertexShader = shader.vertexShader
      .replace(
        "void main() {",
        `attribute vec4 rock;
        attribute vec4 cover;
        attribute float snow;
        attribute float crystal;
        varying vec4 vRock;
        varying vec4 vCover;
        varying float vSnow;
        varying float vCrystal;
        void main() {
          vRock = rock;
          vCover = cover;
          vSnow = snow;
          vCrystal = crystal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${PARS}\nvoid main() {`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          // The face's own normal, in world space, from the screen-space derivatives (flat per triangle)
          vec3 faceNormal = normalize(cross(dFdx(vAtmoWorld), dFdy(vAtmoWorld)));
          float up = faceNormal.y;
          float slope = terrainCoverSlope;
          float coverW = smoothstep(slope - 0.14, slope + 0.04, up);
          float dirtW = smoothstep(slope - 0.34, slope - 0.14, up) * (1.0 - coverW);
          vec3 color = mix(vRock.rgb, mix(terrainDirt, vRock.rgb, 0.2), dirtW * 0.85);
          color = mix(color, vCover.rgb, coverW);
          // The water's edge: sand on the flat, dark wet rock on the steep
          float wet = vCover.a;
          float flatness = smoothstep(0.25, 0.55, up);
          color = mix(color, terrainSand, wet * flatness);
          color *= 1.0 - 0.32 * wet * (1.0 - flatness);
          // Snow on faces flat enough to hold it, above the snow line
          float snowW = smoothstep(terrainSnowLine - 14.0, terrainSnowLine + 14.0, vSnow) * smoothstep(0.38, 0.6, up);
          color = mix(color, terrainSnow, snowW);
          // Painted stone: soft noise, stronger on cliffs
          float steep = 1.0 - smoothstep(0.35, 0.8, abs(up));
          float paint = terrainTriplanar(vAtmoWorld * 0.07 * terrainTextureScale, faceNormal);
          color *= 1.0 + (paint - 0.5) * (0.08 + 0.24 * steep) * terrainTexture;
          if (vCrystal > 0.5) {
            vec3 viewDir = normalize(cameraPosition - vAtmoWorld);
            float edge = pow(1.0 - abs(dot(faceNormal, viewDir)), 3.0);
            // A saturated core and pale reflective edges suggest optical depth.
            // Stay opaque: no sorting, refraction pass, or see-through colliders.
            color = mix(vRock.rgb * 0.78, mix(vRock.rgb, vec3(0.8, 0.88, 1.0), 0.5), edge * 0.8);
          }
          diffuseColor.rgb = color;
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // Restrained inner glow follows the existing facets. No projected
        // contour stripes and no randomly selected full-bright triangles.
        totalEmissiveRadiance += terrainGlowColor * vRock.a * terrainGlow * 0.18;
        if (vCrystal > 0.5) {
          vec3 crystalNormal = normalize(cross(dFdx(vAtmoWorld), dFdy(vAtmoWorld)));
          vec3 viewDir = normalize(cameraPosition - vAtmoWorld);
          float edge = pow(1.0 - abs(dot(crystalNormal, viewDir)), 3.0);
          vec3 halfDirection = normalize(viewDir + normalize(vec3(0.35, 0.8, 0.45)));
          float sheen = pow(max(0.0, dot(crystalNormal, halfDirection)), 24.0);
          totalEmissiveRadiance += mix(vRock.rgb, vec3(0.85, 0.92, 1.0), 0.6) * (edge * 0.16 + sheen * 0.22);
        }`,
      );
  };
  material.customProgramCacheKey = () => "windrider-terrain-crystal-v3";
  return { material, uniforms };
}

/** Per frame: the ?tune knobs on top of the biome's own values */
export function applyTerrainTuning(uniforms: TerrainUniforms, layers: Layers) {
  uniforms.snowLine.value = layers.snowLine + TERRAIN.snowLine;
  uniforms.coverSlope.value = layers.topSlope + TERRAIN.coverSlope;
  uniforms.texture.value = layers.texture * TERRAIN.texture;
  uniforms.textureScale.value = TERRAIN.textureScale;
  uniforms.glow.value = TERRAIN.glow;
}
