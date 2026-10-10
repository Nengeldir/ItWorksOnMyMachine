import * as THREE from "three";
import { sceneryTime as fxTime } from "../particles";

// The air between you and the world: one set of light uniforms shared by the
// sky, the terrain and the rocks, set per biome (palette). The patch adds what
// the plain Lambert material lacks:
// - haze that turns the sun's color when you look towards it, matching the sky,
// - mist that thickens below you, down towards the sea of clouds,
// - rims that light up on edges seen against the sun (backlight),
// - rock strata: soft horizontal bands on cliffs,
// - under the sea: ripples of light from the surface running over everything.
// The sky is a dome with the same light; under the sea it shows the water's
// surface from below instead.

export const ATMOSPHERE = {
  sunDirection: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color("#ffffff") },
  mistColor: { value: new THREE.Color("#ffffff") },
  mistDensity: { value: 0.5 },
  // Where mist gathers: 0 = below the camera (over a sea of clouds), 1 = below mistHeight (in a valley)
  mistMode: { value: 0 },
  mistHeight: { value: 0 },
  mistThickness: { value: 120 },
  horizon: { value: new THREE.Color("#ffffff") },
  zenith: { value: new THREE.Color("#3366cc") },
  clouds: { value: new THREE.Color("#ffffff") },
  night: { value: 0 },
  aurora: { value: 0 },
  underglow: { value: new THREE.Color("#000000") },
  // Under the sea (0 or 1): the height of the water's surface, how bright the
  // ripples of light on the land are, and how bright the surface is from below
  underwater: { value: 0 },
  surface: { value: 0 },
  caustics: { value: 1 },
  surfaceGlow: { value: 1 },
  time: fxTime,
};

/**
 * Mist: below a level a little under the camera (rock far beneath you sinks into
 * the haze over a sea of clouds), or below a fixed height (pooling in a valley).
 * Needs atmoMistDensity, atmoMistMode, atmoMistHeight and atmoMistThickness.
 */
export const MIST = /* glsl */ `
  float atmoMist(vec3 world, float dist) {
    float level = mix(cameraPosition.y - 40.0, atmoMistHeight, atmoMistMode);
    float above = world.y - level;
    return atmoMistDensity * (1.0 - exp(-max(-above, 0.0) / max(atmoMistThickness, 1.0))) * (1.0 - exp(-dist / 280.0));
  }
`;

/**
 * Light through a rippling surface: bright threads where two drifting fields of
 * ripples cross. 0 to about 1.6. (No pow() of anything negative, nothing divided.)
 */
const CAUSTICS = /* glsl */ `
  float atmoHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float atmoNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(atmoHash(i), atmoHash(i + vec2(1.0, 0.0)), u.x), mix(atmoHash(i + vec2(0.0, 1.0)), atmoHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float atmoCaustic(vec2 p, float t) {
    float a = atmoNoise(p + vec2(t * 0.31, t * 0.17));
    float b = atmoNoise(p * 1.31 + vec2(11.7 - t * 0.23, t * 0.29));
    float c = atmoNoise(p * 2.37 + vec2(3.1 + t * 0.19, 5.3 - t * 0.27));
    float fine = clamp(1.0 - abs(a - b) * 6.0, 0.0, 1.0);
    float finer = clamp(1.0 - abs(b - c) * 5.0, 0.0, 1.0);
    return fine * fine * fine + finer * finer * finer * 0.6;
  }
`;

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
  uniform float atmoMistMode;
  uniform float atmoMistHeight;
  uniform float atmoMistThickness;
  uniform float atmoStrata;
  uniform float atmoUnderwater;
  uniform float atmoCaustics;
  uniform float atmoTime;
  varying vec3 vAtmoWorld;
  ${SUN_GLOW}
  ${MIST}
  ${CAUSTICS}
`;

/** Adds the haze, mist, backlight and strata to a Lambert material (terrain, rocks) */
export function atmospheric<T extends THREE.MeshLambertMaterial>(material: T, strata = 0): T {
  const strataUniform = { value: strata };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.atmoSunDirection = ATMOSPHERE.sunDirection;
    shader.uniforms.atmoSunColor = ATMOSPHERE.sunColor;
    shader.uniforms.atmoMistColor = ATMOSPHERE.mistColor;
    shader.uniforms.atmoMistDensity = ATMOSPHERE.mistDensity;
    shader.uniforms.atmoMistMode = ATMOSPHERE.mistMode;
    shader.uniforms.atmoMistHeight = ATMOSPHERE.mistHeight;
    shader.uniforms.atmoMistThickness = ATMOSPHERE.mistThickness;
    shader.uniforms.atmoStrata = strataUniform;
    shader.uniforms.atmoUnderwater = ATMOSPHERE.underwater;
    shader.uniforms.atmoCaustics = ATMOSPHERE.caustics;
    shader.uniforms.atmoTime = ATMOSPHERE.time;
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
          if (atmoUnderwater > 0.0) {
            // Under the sea: ripples of light from the surface, cast along the sun's rays,
            // brightest on what faces up, fading into the haze
            vec2 shone = vAtmoWorld.xz - atmoSunDirection.xz * (vAtmoWorld.y / max(atmoSunDirection.y, 0.25));
            float facing = clamp(worldNormal.y * 0.75 + 0.35, 0.0, 1.0);
            float ripples = atmoCaustic(shone * 0.1, atmoTime) * facing * exp(-dist / 240.0) * atmoCaustics * atmoUnderwater;
            gl_FragColor.rgb += (gl_FragColor.rgb * 0.85 + 0.05) * atmoSunColor * ripples;
          }
          #ifdef USE_FOG
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
            float mist = atmoMist(vAtmoWorld, dist);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, atmoMistColor, clamp(mist, 0.0, 0.85) * (1.0 - fogFactor));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor + sunGlow(viewDir), fogFactor);
          #endif
        }`,
      );
  };
  material.customProgramCacheKey = () => `windrider-atmosphere-${strata > 0}`;
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
  uniform float aurora;
  uniform vec3 underglow;
  uniform float underwater;
  uniform float surface;
  uniform float surfaceGlow;
  uniform float time;
  varying vec3 vDirection;
  ${SUN_GLOW}
  ${CAUSTICS}

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
    if (underwater > 0.0) {
      // Under the sea there is no sky: the haze all around (the horizon color, as the
      // fog), darker in the deep below, and the water's surface far overhead
      vec3 color = mix(horizon, horizon * 0.55, clamp(-dir.y * 1.4 - 0.2, 0.0, 1.0)) + sunGlow(dir);
      if (dir.y > 0.02) {
        float reach = max(surface - cameraPosition.y, 6.0) / dir.y;
        vec2 hit = cameraPosition.xz + dir.xz * reach;
        float ripples = atmoCaustic(hit * 0.03, time);
        float swell = atmoNoise(hit * 0.009 + vec2(time * 0.05, time * 0.03));
        // Snell's window: the world above squeezed into a bright disc overhead, its edge
        // wobbling with the swell; outside it the surface mirrors the deep
        float window = smoothstep(0.56, 0.8, dir.y + (swell - 0.5) * 0.16);
        float d = max(dot(dir, atmoSunDirection), 0.0);
        vec3 above = mix(horizon, zenith, 0.72) * (0.78 + swell * 0.3) + atmoSunColor * ripples * 0.4;
        // The sun, a blaze broken up by the ripples
        above += atmoSunColor * (pow(d, 40.0) * 0.3 + pow(d, 400.0) * (0.9 + ripples * 1.2));
        vec3 mirror = mix(horizon, zenith, 0.22) * (0.9 + swell * 0.2) + zenith * ripples * 0.22;
        float seen = exp(-reach / 430.0) * surfaceGlow;
        color = mix(color, mix(mirror, above, window), clamp(seen, 0.0, 1.0));
      }
      gl_FragColor = vec4(color, 1.0);
      return;
    }
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

    // Aurora: curtains of green and violet light rippling along the sky
    if (aurora > 0.0) {
      // Around the horizon as a circle, so the noise has no seam
      vec2 ring = normalize(dir.xz + vec2(1e-5, 0.0));
      float wave = fbm(ring * 2.2 + vec2(time * 0.015, time * 0.04)) * 2.0;
      float top = 0.42 + 0.12 * sin(ring.x * 3.0 + ring.y * 2.0 + wave);
      float band = smoothstep(0.05, 0.16, dir.y) * (1.0 - smoothstep(top - 0.2, top, dir.y));
      float rays = pow(clamp(fbm(ring * 18.0 + vec2(wave * 2.5, time * 0.06)), 0.0, 1.0), 2.2);
      float fold = 0.45 + 0.55 * sin(ring.x * 7.0 - ring.y * 5.0 + wave * 3.0 + time * 0.12);
      vec3 hue = mix(vec3(0.2, 1.0, 0.55), vec3(0.65, 0.35, 1.0), smoothstep(0.12, top, dir.y));
      color += hue * band * rays * fold * aurora * 1.8 * (1.0 - cover * 0.6);
    }
    // Light from below the horizon: lava seas and burning lands
    color += underglow * pow(clamp(1.0 - (dir.y + 0.05) * 4.0, 0.0, 1.0), 2.0) * 0.9;

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

/** A sky dome: gradient, sun disc and halo, clouds, and stars at night; under the sea, the water's surface from below */
export function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      atmoSunDirection: ATMOSPHERE.sunDirection,
      atmoSunColor: ATMOSPHERE.sunColor,
      horizon: ATMOSPHERE.horizon,
      zenith: ATMOSPHERE.zenith,
      clouds: ATMOSPHERE.clouds,
      night: ATMOSPHERE.night,
      aurora: ATMOSPHERE.aurora,
      underglow: ATMOSPHERE.underglow,
      underwater: ATMOSPHERE.underwater,
      surface: ATMOSPHERE.surface,
      surfaceGlow: ATMOSPHERE.surfaceGlow,
      time: ATMOSPHERE.time,
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}
