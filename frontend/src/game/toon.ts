import * as THREE from "three";

// Cel shading in the style of Genshin Impact: hard light bands from a tiny
// gradient texture, a soft rim light, and ink outlines from an inverted hull.

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
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float rimStrength;\nuniform vec3 rimColor;\nvoid main() {")
      .replace(
        "#include <opaque_fragment>",
        `{
          float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rimBand = smoothstep(0.55, 0.75, 1.0 - facing);
          outgoingLight += rimColor * rimBand * rimStrength;
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "wingrace-toon";
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
  material.customProgramCacheKey = () => `wingrace-outline-${width}`;
  return material;
}
