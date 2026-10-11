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
  /** Extra light for the glowing parts, set per frame by whoever owns it (the cape's pulse) */
  pulse?: { value: number };
}

const NO_PULSE = { value: 0 };

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
    shader.uniforms.toonPulse = options.pulse ?? NO_PULSE;
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
        uniform float toonPulse;
        varying float vGlow;
        void main() {`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vGlow * (toonGlow * (0.85 + 0.15 * sin(toonTime * 2.4 + vGlow * 6.0)) + toonPulse);`,
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

/** The pilot's ink (FX.ink, FX.inkTint): how opaque the lines are, and how much they take each part's own color */
export const INK = { opacity: { value: 1 }, tint: { value: 0 } };

export interface OutlineOptions {
  /**
   * The line takes the vertex color, darkened, by `INK.tint` (so white hair gets a
   * pale line and a red cape a dark red one, and nothing reads as a cut-out), fades
   * by `INK.opacity`, and keeps a steadier width on screen
   */
  tint?: boolean;
}

/** Ink outline: the same mesh, drawn inside out and pushed out along its normals */
export function outlineMaterial(width = 0.022, color: THREE.ColorRepresentation = "#2a1f2e", options: OutlineOptions = {}): THREE.MeshBasicMaterial {
  const tint = !!options.tint;
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, vertexColors: tint, transparent: tint });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float outlineWidth;\nvoid main() {")
      .replace(
        "#include <begin_vertex>",
        tint
          ? // Thinner up close, wider far away, so the line stays about as wide on screen (then fog takes it)
            "vec4 inkView = modelViewMatrix * vec4(position, 1.0);\nvec3 transformed = position + normal * outlineWidth * clamp(-inkView.z / 10.0, 0.6, 2.5);"
          : "vec3 transformed = position + normal * outlineWidth;",
      );
    if (tint) {
      shader.uniforms.inkTint = INK.tint;
      shader.uniforms.inkOpacity = INK.opacity;
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform float inkTint;\nuniform float inkOpacity;\nvoid main() {")
        .replace("#include <color_fragment>", "diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb * 0.42, inkTint);\ndiffuseColor.a *= inkOpacity;");
    }
  };
  material.customProgramCacheKey = () => `windrider-outline-${width}-${tint ? "tint" : "ink"}`;
  return material;
}
