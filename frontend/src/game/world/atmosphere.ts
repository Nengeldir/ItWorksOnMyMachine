import * as THREE from "three";
import { fxTime } from "../particles";

// The air between you and the world: one set of light uniforms shared by the
// sky, the terrain and the rocks, set per biome (palette). The patch adds what
// the plain Lambert material lacks:
// - haze that turns the sun's color when you look towards it, matching the sky,
// - mist that thickens below you, down towards the sea of clouds,
// - rims that light up on edges seen against the sun (backlight),
// - rock strata: soft horizontal bands on cliffs.

export const ATMOSPHERE = {
  sunDirection: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color("#ffffff") },
  mistColor: { value: new THREE.Color("#ffffff") },
  mistDensity: { value: 0.5 },
  horizon: { value: new THREE.Color("#ffffff") },
  zenith: { value: new THREE.Color("#3366cc") },
  clouds: { value: new THREE.Color("#ffffff") },
  night: { value: 0 },
  time: fxTime,
};

/** The sky's glow around the sun; the haze uses the same curve so distant terrain melts into the sky */
const SUN_GLOW = /* glsl */ `
  vec3 sunGlow(vec3 dir) {
    float d = max(dot(dir, atmoSunDirection), 0.0);
    return atmoSunColor * (pow(d, 6.0) * 0.35 + pow(d, 48.0) * 0.5);
  }
`;

const PARS = /* glsl */ `
  uniform vec3 atmoSunDirection;
  uniform vec3 atmoSunColor;
  uniform vec3 atmoMistColor;
  uniform float atmoMistDensity;
  uniform float atmoStrata;
  varying vec3 vAtmoWorld;
  ${SUN_GLOW}
`;

/** Adds the haze, mist, backlight and strata to a Lambert material (terrain, rocks) */
export function atmospheric<T extends THREE.MeshLambertMaterial>(material: T, strata = 0): T {
  const strataUniform = { value: strata };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.atmoSunDirection = ATMOSPHERE.sunDirection;
    shader.uniforms.atmoSunColor = ATMOSPHERE.sunColor;
    shader.uniforms.atmoMistColor = ATMOSPHERE.mistColor;
    shader.uniforms.atmoMistDensity = ATMOSPHERE.mistDensity;
    shader.uniforms.atmoStrata = strataUniform;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec3 vAtmoWorld;\nvoid main() {")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 atmoWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          atmoWorld = instanceMatrix * atmoWorld;
        #endif
        vAtmoWorld = (modelMatrix * atmoWorld).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${PARS}\nvoid main() {`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          // Sediment layers, wavering a little so they don't look ruled
          float waver = sin(vAtmoWorld.x * 0.013 + vAtmoWorld.z * 0.009) * 4.0;
          float bands = sin(vAtmoWorld.y * 0.45 + waver) * 0.07 + sin(vAtmoWorld.y * 1.7 + waver) * 0.018;
          diffuseColor.rgb *= 1.0 + atmoStrata * bands;
        }`,
      )
      .replace(
        "#include <fog_fragment>",
        `{
          vec3 toFrag = vAtmoWorld - cameraPosition;
          float dist = length(toFrag);
          vec3 viewDir = toFrag / max(dist, 0.001);
          float towardsSun = max(dot(viewDir, atmoSunDirection), 0.0);
          // Edges seen against the sun catch its light
          vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
          float rim = pow(1.0 - clamp(dot(worldNormal, -viewDir), 0.0, 1.0), 3.0);
          gl_FragColor.rgb += atmoSunColor * rim * pow(towardsSun, 3.0) * 0.45;
          #ifdef USE_FOG
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
            // Height above a level a little below the camera: rock far beneath you sinks into the haze
            float above = vAtmoWorld.y - (cameraPosition.y - 40.0);
            float mist = atmoMistDensity * (1.0 - exp(-max(-above, 0.0) / 120.0)) * (1.0 - exp(-dist / 280.0));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, atmoMistColor, clamp(mist, 0.0, 0.85) * (1.0 - fogFactor));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor + sunGlow(viewDir), fogFactor);
          #endif
        }`,
      );
  };
  material.customProgramCacheKey = () => `wingrace-atmosphere-${strata > 0}`;
  return material;
}

const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 atmoSunDirection;
  uniform vec3 atmoSunColor;
  uniform vec3 horizon;
  uniform vec3 zenith;
  uniform vec3 clouds;
  uniform float night;
  uniform float time;
  varying vec3 vDirection;
  ${SUN_GLOW}

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) { sum += noise(p) * amp; p = p * 2.03 + 17.0; amp *= 0.5; }
    return sum;
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float up = max(dir.y, 0.0);
    vec3 color = mix(horizon, zenith, pow(up, 0.6));
    color += sunGlow(dir);
    // The sun (or moon) itself, brighter than white so it blooms
    float d = dot(dir, atmoSunDirection);
    color += atmoSunColor * smoothstep(0.9990, 0.9994, d) * mix(2.6, 1.4, night);

    // Painted clouds drifting overhead, lit from the sun's side with a silver lining
    // Project onto a cloud layer; clamp so directions below the horizon don't divide by zero
    vec2 uv = dir.xz / max(dir.y + 0.22, 0.05) * 1.4 + vec2(time * 0.006, time * 0.003);
    float shape = fbm(uv * 1.3) * 0.75 + fbm(uv * 4.1) * 0.25;
    float cover = smoothstep(0.52, 0.78, shape) * smoothstep(0.0, 0.18, dir.y);
    float lit = pow(max(d, 0.0), 4.0);
    vec3 cloud = mix(clouds * mix(0.85, 0.55, night), atmoSunColor, lit * 0.55 + 0.1);
    cloud += atmoSunColor * pow(max(d, 0.0), 24.0) * (1.0 - smoothstep(0.6, 0.85, shape)) * 1.5;
    color = mix(color, cloud, cover * 0.85);

    // Stars at night, twinkling
    if (night > 0.0) {
      vec3 cell = floor(dir * 220.0);
      float star = hash(cell.xy + cell.z * 7.31);
      float twinkle = 0.6 + 0.4 * sin(time * (2.0 + star * 4.0) + star * 40.0);
      float on = step(0.9965, star) * smoothstep(0.02, 0.25, dir.y) * (1.0 - cover);
      color += vec3(0.9, 0.92, 1.0) * on * twinkle * night * 1.6;
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** A sky dome: gradient, sun disc and halo, clouds, and stars at night */
export function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      atmoSunDirection: ATMOSPHERE.sunDirection,
      atmoSunColor: ATMOSPHERE.sunColor,
      horizon: ATMOSPHERE.horizon,
      zenith: ATMOSPHERE.zenith,
      clouds: ATMOSPHERE.clouds,
      night: ATMOSPHERE.night,
      time: ATMOSPHERE.time,
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}
