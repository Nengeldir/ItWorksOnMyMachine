import * as THREE from "three";
import { fxTime } from "./particles";

// Cel shading in the style of Genshin Impact: hard light bands from a tiny
// gradient texture, a soft rim light, and ink outlines from an inverted hull.

/**
 * Light shared by every toon material, set per biome: the rim takes the sun's
 * color, and parts painted with a glow (gold trims, wingtips) light up by
 * themselves: a soft shimmer by day, bright enough to bloom at night.
 */
export const TOON_LIGHT = {
  rimColor: { value: new THREE.Color("#fff4e0") },
  glow: { value: 0.15 },
  time: fxTime,
};

let gradient: THREE.DataTexture | null = null;

/** Three light bands: shadow, mid, lit */
function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    const steps = new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]);
    gradient = new THREE.DataTexture(steps, 3, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export interface ToonOptions {
  rim?: number; // rim light strength
  rimColor?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  side?: THREE.Side;
  ghost?: boolean;
}

/** A toon material with vertex colors and a rim light that wraps the silhouette */
export function toonMaterial(options: ToonOptions = {}): THREE.MeshToonMaterial {
  const ghost = !!options.ghost;
  const material = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: toonGradient(),
    side: options.side ?? THREE.FrontSide,
    transparent: ghost,
    opacity: ghost ? 0.4 : 1,
    depthWrite: !ghost,
    emissive: options.emissive ?? 0x000000,
  });
  const rim = { value: options.rim ?? 0.45 };
  const rimColor = { value: new THREE.Color(options.rimColor ?? "#fff4e0") };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = rim;
    shader.uniforms.rimColor = rimColor;
    shader.uniforms.toonRimColor = TOON_LIGHT.rimColor;
    shader.uniforms.toonGlow = TOON_LIGHT.glow;
    shader.uniforms.toonTime = TOON_LIGHT.time;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float glow;\nvarying float vGlow;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `uniform float rimStrength;
        uniform vec3 rimColor;
        uniform vec3 toonRimColor;
        uniform float toonGlow;
        uniform float toonTime;
        varying float vGlow;
        void main() {`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vGlow * toonGlow * (0.85 + 0.15 * sin(toonTime * 2.4 + vGlow * 6.0));`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rimBand = smoothstep(0.55, 0.75, 1.0 - facing);
          outgoingLight += rimColor * toonRimColor * rimBand * rimStrength;
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "windrider-toon";
  return material;
}

/** Ink outline: the same mesh, drawn inside out and pushed out along its normals */
export function outlineMaterial(width = 0.022, color: THREE.ColorRepresentation = "#2a1f2e"): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float outlineWidth;\nvoid main() {")
      .replace("#include <begin_vertex>", "vec3 transformed = position + normal * outlineWidth;");
  };
  material.customProgramCacheKey = () => `windrider-outline-${width}`;
  return material;
}
