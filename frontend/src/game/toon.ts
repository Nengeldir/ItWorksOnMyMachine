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

/** The pilot family's style (FX.toonFlat, toonFacet, toonSoft), shared by every toon material */
export const TOON_STYLE = { facet: { value: 0 }, axis: { value: 0 } };
const toonMaterials = new Set<THREE.MeshToonMaterial>();
let flatShading = false;
let softBands = false;

/** Five soft light bands, closer to the land's Lambert shading than the three hard ones */
let soft: THREE.DataTexture | null = null;
function softGradient(): THREE.DataTexture {
  if (!soft) {
    const steps = new Uint8Array([118, 118, 118, 255, 150, 150, 150, 255, 185, 185, 185, 255, 222, 222, 222, 255, 255, 255, 255, 255]);
    soft = new THREE.DataTexture(steps, 5, 1, THREE.RGBAFormat);
    soft.minFilter = THREE.NearestFilter;
    soft.magFilter = THREE.NearestFilter;
    soft.generateMipmaps = false;
    soft.needsUpdate = true;
  }
  return soft;
}

/**
 * Applies the ?tune style to every toon material at once (the pilot, the
 * wardrobe's cosmetics, items, ability models): `flat` shades face by face like
 * the land (a recompile), `facet` gives each face its own shade, `soft` swaps
 * the three hard bands for five soft ones
 */
export function syncToonStyle(flat: boolean, facet: number, soft: boolean, axis = 0) {
  TOON_STYLE.facet.value = facet;
  TOON_STYLE.axis.value = axis;
  if (flat === flatShading && soft === softBands) return;
  flatShading = flat;
  softBands = soft;
  for (const material of toonMaterials) {
    // MeshToonMaterial's types don't list flatShading, but the renderer reads it on any material (FLAT_SHADED)
    (material as THREE.MeshToonMaterial & { flatShading: boolean }).flatShading = flat;
    material.gradientMap = soft ? softGradient() : toonGradient();
    material.needsUpdate = true;
  }
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
  (material as THREE.MeshToonMaterial & { flatShading: boolean }).flatShading = flatShading;
  if (softBands) material.gradientMap = softGradient();
  toonMaterials.add(material);
  material.addEventListener("dispose", () => toonMaterials.delete(material));
  const rim = { value: options.rim ?? 0.45 };
  const rimColor = { value: new THREE.Color(options.rimColor ?? "#fff4e0") };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = rim;
    shader.uniforms.rimColor = rimColor;
    shader.uniforms.toonRimColor = TOON_LIGHT.rimColor;
    shader.uniforms.toonGlow = TOON_LIGHT.glow;
    shader.uniforms.toonTime = TOON_LIGHT.time;
    shader.uniforms.toonPulse = options.pulse ?? NO_PULSE;
    shader.uniforms.toonFacet = TOON_STYLE.facet;
    shader.uniforms.toonAxis = TOON_STYLE.axis;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float glow;\nvarying float vGlow;\nvarying vec3 vFacetPos;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;\nvFacetPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `uniform float rimStrength;
        uniform vec3 rimColor;
        uniform vec3 toonRimColor;
        uniform float toonGlow;
        uniform float toonTime;
        uniform float toonPulse;
        uniform float toonFacet;
        uniform float toonAxis;
        varying float vGlow;
        varying vec3 vFacetPos;
        void main() {`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        #ifdef FLAT_SHADED
        {
          // Every face its own shade, a little lighter or darker, like the land's painted facets
          // (from the face's normal in the model's own space, so it never changes with the camera)
          vec3 facetNormal = normalize(cross(dFdx(vFacetPos), dFdy(vFacetPos)));
          float facet = fract(sin(dot(floor(facetNormal * 37.0 + 0.5), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          diffuseColor.rgb *= 1.0 + (facet - 0.5) * toonFacet;
        }
        #endif`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vGlow * (toonGlow * (0.85 + 0.15 * sin(toonTime * 2.4 + vGlow * 6.0)) + toonPulse);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          // Monument Valley's block shading (toonAxis): every face takes one of four tones by the way it
          // faces in the world (top, the two sides, the underside), whatever the sun does
          vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
          float side = worldNormal.x * 0.7 + worldNormal.z * 0.3;
          float tone = worldNormal.y > 0.45 ? 1.0 : worldNormal.y < -0.45 ? 0.58 : side > 0.0 ? 0.86 : 0.72;
          outgoingLight = mix(outgoingLight, diffuseColor.rgb * tone + totalEmissiveRadiance, toonAxis);
          float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rimBand = smoothstep(0.55, 0.75, 1.0 - facing);
          outgoingLight += rimColor * toonRimColor * rimBand * rimStrength * (1.0 - toonAxis);
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
