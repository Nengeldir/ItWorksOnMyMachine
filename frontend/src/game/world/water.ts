import * as THREE from "three";
import { FX_LIGHT, fxTime } from "../particles";
import { TOON_LIGHT } from "../toon";
import { WATER } from "../tuning";
import { ATMOSPHERE, MIST } from "./atmosphere";
import type { RiverSpec, WaterKind } from "./terrain/river";
import type { World } from "./World";

// Stylized water for every biome: river pools stepping down the valley, the
// falls between them, and seas. One shader, four kinds:
// - water: tinted by depth (the real depth over the carved ground), foam where
//   it meets the shore and below the falls, flow streaks, the sky reflected by
//   a Fresnel term, and sun glitter bright enough to bloom;
// - lava: a dark crust cracked over a glow that pulses and blooms;
// - ice: frozen pools with cracks, still and reflective;
// - glow: dark pools with bioluminescent specks (night biomes).
// All of it takes its light from ATMOSPHERE, glows with FX_LIGHT and TOON_LIGHT.

const KINDS: Record<WaterKind, number> = { water: 0, lava: 1, ice: 2, glow: 3 };

const NOISE = /* glsl */ `
  float waterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float waterNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), u.x), mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Two octaves, about 0..1
  float waterFbm(vec2 p) { return waterNoise(p) * 0.65 + waterNoise(p * 2.3 + 7.1) * 0.35; }
`;

const COMMON = /* glsl */ `
  uniform float time;
  uniform float kind;
  uniform vec3 deep;
  uniform vec3 shallow;
  uniform vec3 foamColor;
  uniform float glitter;
  uniform float glow;
  uniform float night;
  uniform vec3 horizon;
  uniform vec3 zenith;
  uniform vec3 atmoSunDirection;
  uniform vec3 atmoSunColor;
  uniform vec3 atmoMistColor;
  uniform float atmoMistDensity;
  uniform float atmoMistMode;
  uniform float atmoMistHeight;
  uniform float atmoMistThickness;
  ${MIST}
  ${NOISE}
  vec3 waterSunGlow(vec3 dir) {
    float d = max(dot(dir, atmoSunDirection), 0.0);
    return atmoSunColor * (pow(d, 6.0) * 0.35 + pow(d, 48.0) * 0.5);
  }
  vec3 waterAir(vec3 color, vec3 world, float fogDepth) {
    vec3 toFrag = world - cameraPosition;
    float dist = length(toFrag);
    vec3 viewDir = toFrag / max(dist, 0.001);
    #ifdef USE_FOG
      float fogFactor = smoothstep(fogNear, fogFar, fogDepth);
      color = mix(color, atmoMistColor, clamp(atmoMist(world, dist), 0.0, 0.85) * (1.0 - fogFactor));
      color = mix(color, fogColor + waterSunGlow(viewDir), fogFactor);
    #endif
    return color;
  }
`;

const poolVertex = /* glsl */ `
  attribute float depth;
  attribute vec2 flow;
  attribute float foam;
  varying vec3 vWorld;
  varying float vDepth;
  varying vec2 vFlow;
  varying float vFoam;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vDepth = depth;
    vFlow = flow;
    vFoam = foam;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const poolFragment = /* glsl */ `
  #include <fog_pars_fragment>
  ${COMMON}
  varying vec3 vWorld;
  varying float vDepth;
  varying vec2 vFlow;
  varying float vFoam;

  void main() {
    vec3 toFrag = vWorld - cameraPosition;
    vec3 view = toFrag / max(length(toFrag), 0.001);
    float t = time;
    float still = kind > 1.5 && kind < 2.5 ? 0.0 : 1.0; // ice doesn't move
    // Ripples: two noise layers drifting downstream (+z), as a bumped normal
    vec2 p = vWorld.xz * 0.16;
    vec2 drift = vec2(0.0, t * 0.5) * still;
    float e = 0.12;
    float h0 = waterFbm(p - drift) + 0.5 * waterFbm(p * 2.7 + drift.yx * 0.7);
    float hx = waterFbm(p + vec2(e, 0.0) - drift) + 0.5 * waterFbm((p + vec2(e, 0.0)) * 2.7 + drift.yx * 0.7);
    float hz = waterFbm(p + vec2(0.0, e) - drift) + 0.5 * waterFbm((p + vec2(0.0, e)) * 2.7 + drift.yx * 0.7);
    float bump = kind > 1.5 && kind < 2.5 ? 0.25 : 0.9;
    vec3 n = normalize(vec3((h0 - hx) / e * 0.12 * bump, 1.0, (h0 - hz) / e * 0.12 * bump));
    float facing = clamp(dot(n, -view), 0.0, 1.0);
    float fresnel = 0.03 + 0.97 * pow(1.0 - facing, 5.0);
    vec3 r = reflect(view, n);
    r.y = abs(r.y);
    vec3 sky = mix(horizon, zenith, pow(clamp(r.y, 0.0, 1.0), 0.6)) + waterSunGlow(r);
    float depthW = 1.0 - exp(-max(vDepth, 0.0) / 3.5);
    // How much light falls into the water: less with a low sun, much less by moonlight
    float sunUp = clamp(atmoSunDirection.y * 1.5 + 0.35, 0.25, 1.0) * mix(1.0, 0.32, night);
    vec3 color;
    float alpha = 1.0;

    if (kind < 0.5 || kind > 2.5) {
      // Water (and glowing pools): depth tint, sky reflection, glitter, foam
      vec3 body = mix(shallow, deep, depthW) * sunUp;
      // Stylized reflection: capped, and tinted by the water, so a river seen
      // at a low angle stays a river instead of a strip of sky
      color = mix(body, mix(sky, body, 0.3), clamp(fresnel * 0.55 + 0.05, 0.0, 0.6));
      float spec = pow(clamp(dot(r, atmoSunDirection), 0.0, 1.0), 260.0);
      float sparkle = smoothstep(0.55, 0.9, waterNoise(vWorld.xz * 1.9 + vec2(t * 1.3, -t * 0.9)));
      color += atmoSunColor * spec * (1.5 + 5.0 * sparkle) * glitter * (1.0 - night * 0.6);
      // Foam at the shore, below falls, and streaks carried by the current
      float shore = 1.0 - smoothstep(0.0, 0.5 + 0.7 * waterNoise(vWorld.xz * 0.45 + t * 0.2), vDepth);
      // flow = (across 0..1, metres downstream): streaks stretched along the current
      float streak = smoothstep(0.62, 0.86, waterFbm(vec2(vFlow.x * 9.0, vFlow.y * 0.06 - t * 0.9)));
      float churn = vFoam * (0.55 + 0.45 * waterFbm(vWorld.xz * 0.35 - vec2(0.0, t * 1.2)));
      float foamW = clamp(shore * 0.85 + churn + streak * 0.35 * (0.3 + vFoam), 0.0, 1.0);
      color = mix(color, foamColor * (0.75 + 0.35 * sunUp), foamW);
      alpha = clamp(smoothstep(-0.15, 0.45, vDepth) * 0.92 + foamW * 0.3, 0.0, 0.97);
      if (kind > 2.5) {
        // Bioluminescence: specks drifting in the water, brightest at night
        float speck = smoothstep(0.82, 0.97, waterNoise(vWorld.xz * 1.3 + vec2(sin(t * 0.3), t * 0.15)));
        float edge = 1.0 - smoothstep(0.0, 2.5, vDepth);
        color += foamColor * (speck * 2.2 + edge * 0.6) * glow;
      }
    } else if (kind < 1.5) {
      // Lava: crust plates over a glowing melt, cracks pulsing, bright at the edges
      vec2 q = vWorld.xz * 0.07 + vec2(0.0, -t * 0.08);
      float plates = waterFbm(q * 1.4) + 0.4 * waterFbm(q * 4.1 + 3.3);
      float crack = 1.0 - smoothstep(0.03, 0.12, abs(plates - 0.72));
      float melt = smoothstep(0.55, 0.85, waterFbm(q * 0.8 - t * 0.02));
      float pulse = 0.75 + 0.25 * sin(t * 1.7 + plates * 9.0);
      float edge = 1.0 - smoothstep(0.0, 2.0, vDepth);
      vec3 hot = shallow * (2.2 + 1.2 * pulse) * glow;
      color = mix(deep, hot, clamp(crack + melt * 0.6 + edge * 0.7 + vFoam * 0.5, 0.0, 1.0));
      color += foamColor * pow(clamp(crack * pulse, 0.0, 1.0), 2.0) * 1.5 * glow;
    } else {
      // Ice: frozen pools, white-blue with dark cracks, reflective
      vec2 q = vWorld.xz * 0.05;
      float cells = waterFbm(q * 2.0);
      float crack = 1.0 - smoothstep(0.015, 0.05, abs(cells - 0.5));
      vec3 body = mix(shallow, deep, depthW * 0.6) * sunUp;
      color = mix(body, sky, clamp(fresnel * 0.6 + 0.15, 0.0, 1.0));
      color = mix(color, deep * 0.55, crack * 0.6);
      float spec = pow(clamp(dot(r, atmoSunDirection), 0.0, 1.0), 120.0);
      color += atmoSunColor * spec * 1.6 * glitter;
      color = mix(color, foamColor, (1.0 - smoothstep(0.0, 0.6, vDepth)) * 0.7);
    }
    gl_FragColor = vec4(waterAir(color, vWorld, vFogDepth), alpha);
    #include <colorspace_fragment>
  }
`;

const fallVertex = /* glsl */ `
  attribute vec2 fall; // across 0..1, down 0..1
  varying vec3 vWorld;
  varying vec2 vFall;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vFall = fall;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fallFragment = /* glsl */ `
  #include <fog_pars_fragment>
  ${COMMON}
  varying vec3 vWorld;
  varying vec2 vFall;
  void main() {
    float u = vFall.x;
    float v = vFall.y;
    // Streaks falling and speeding up
    float speed = kind > 0.5 && kind < 1.5 ? 0.35 : 1.6;
    float streak = waterFbm(vec2(u * 22.0, v * 2.0 - time * speed * (0.6 + v)));
    float sheet = waterFbm(vec2(u * 7.0 + 3.0, v * 0.8 - time * speed * 0.5));
    float sides = 1.0 - pow(abs(u * 2.0 - 1.0), 3.0);
    float lip = smoothstep(0.0, 0.04, v);
    float spray = smoothstep(0.75, 1.0, v);
    vec3 color;
    float alpha;
    if (kind > 0.5 && kind < 1.5) {
      // A lava fall: glowing, crusting as it cools down the face
      vec3 hot = shallow * (2.4 + 1.2 * streak) * glow;
      color = mix(hot, deep, smoothstep(0.4, 0.9, sheet) * 0.6);
      alpha = sides * lip * (0.85 + 0.15 * streak);
    } else {
      vec3 water = mix(shallow, foamColor, 0.55 + 0.45 * streak);
      float sunUp = clamp(atmoSunDirection.y * 1.5 + 0.35, 0.25, 1.0) * mix(1.0, 0.4, night);
      color = water * (0.7 + 0.45 * sunUp) + atmoSunColor * pow(streak, 6.0) * 0.6 * glitter;
      if (kind > 2.5) color += foamColor * pow(streak, 4.0) * 1.5 * glow;
      alpha = sides * lip * (0.45 + 0.4 * streak + 0.25 * sheet) * (1.0 - spray * 0.5);
    }
    gl_FragColor = vec4(waterAir(color, vWorld, vFogDepth), clamp(alpha, 0.0, 0.95));
    #include <colorspace_fragment>
  }
`;

/** Metres along z between cross-sections of a pool */
const STEP = 4;
const ACROSS = 10;

export class WaterView {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(world: World) {
    const steps = world.steps;
    const river = steps?.river;
    if (!steps || !river || !world.land?.ground) return;
    const ground = world.land.ground;
    const uniforms = this.uniforms(river, world.palette.night);

    // Pools: ribbons across the river, from one fall to the next
    const positions: number[] = [];
    const depth: number[] = [];
    const flow: number[] = [];
    const foam: number[] = [];
    const index: number[] = [];
    let base = 0;
    steps.pools.forEach((pool, p) => {
      const z0 = pool.z0 - (p > 0 ? 3 : 0);
      const z1 = pool.z1 + 0.5;
      const rows = Math.max(2, Math.ceil((z1 - z0) / STEP));
      for (let r = 0; r <= rows; r++) {
        const z = z0 + ((z1 - z0) * r) / rows;
        const center = steps.center(z);
        const half = steps.width(z) / 2 + 8;
        // Churned up just below the previous fall
        const churn = p > 0 ? Math.exp(-Math.max(0, z - pool.z0) / 14) : 0;
        for (let c = 0; c <= ACROSS; c++) {
          const across = c / ACROSS;
          const x = center - half + half * 2 * across;
          positions.push(x, pool.level, z);
          depth.push(pool.level - ground.height(x, z));
          flow.push(across, z);
          foam.push(churn);
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < ACROSS; c++) {
          const a = base + r * (ACROSS + 1) + c;
          const b = a + ACROSS + 1;
          // Counter-clockwise seen from above
          index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      base += (rows + 1) * (ACROSS + 1);
    });
    const pools = new THREE.BufferGeometry();
    pools.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    pools.setAttribute("depth", new THREE.Float32BufferAttribute(depth, 1));
    pools.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 2));
    pools.setAttribute("foam", new THREE.Float32BufferAttribute(foam, 1));
    pools.setIndex(index);
    pools.computeBoundingSphere();
    this.geometries.push(pools);
    const poolMaterial = this.material(poolVertex, poolFragment, uniforms, river.kind !== "lava" && river.kind !== "ice");
    const poolMesh = new THREE.Mesh(pools, poolMaterial);
    poolMesh.renderOrder = 1;
    this.group.add(poolMesh);

    // Falls: curtains arcing off each lip down to the next pool
    const fp: number[] = [];
    const fu: number[] = [];
    const fi: number[] = [];
    let fb = 0;
    const DOWN = 14;
    const SIDE = 6;
    for (const fall of steps.falls) {
      const drop = fall.top - fall.bottom;
      if (drop < 3) continue;
      const throwOut = 3 + drop * 0.07;
      const center = steps.center(fall.z);
      const half = Math.max(3, fall.width / 2);
      for (let d = 0; d <= DOWN; d++) {
        const t = d / DOWN;
        const y = fall.top + 0.2 - (drop + 1) * t;
        const z = fall.z - 2 + throwOut * Math.sqrt(t);
        for (let s = 0; s <= SIDE; s++) {
          const u = s / SIDE;
          // A little wider at the bottom, where it spreads
          fp.push(center + (u * 2 - 1) * half * (1 + t * 0.25), y, z);
          fu.push(u, t);
        }
      }
      for (let d = 0; d < DOWN; d++) {
        for (let s = 0; s < SIDE; s++) {
          const a = fb + d * (SIDE + 1) + s;
          const b = a + SIDE + 1;
          fi.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      fb += (DOWN + 1) * (SIDE + 1);
    }
    if (fi.length) {
      const falls = new THREE.BufferGeometry();
      falls.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
      falls.setAttribute("fall", new THREE.Float32BufferAttribute(fu, 2));
      falls.setIndex(fi);
      falls.computeBoundingSphere();
      this.geometries.push(falls);
      const fallMaterial = this.material(fallVertex, fallFragment, uniforms, true);
      fallMaterial.side = THREE.DoubleSide;
      const fallMesh = new THREE.Mesh(falls, fallMaterial);
      fallMesh.renderOrder = 2;
      this.group.add(fallMesh);
    }
  }

  private uniforms(spec: RiverSpec, night: number): Record<string, THREE.IUniform> {
    return {
      time: fxTime,
      kind: { value: KINDS[spec.kind] },
      deep: { value: new THREE.Color(spec.colors.deep) },
      shallow: { value: new THREE.Color(spec.colors.shallow) },
      foamColor: { value: new THREE.Color(spec.colors.foam) },
      glitter: { value: 1 },
      glow: { value: 1 },
      night: { value: night },
      horizon: ATMOSPHERE.horizon,
      zenith: ATMOSPHERE.zenith,
      atmoSunDirection: ATMOSPHERE.sunDirection,
      atmoSunColor: ATMOSPHERE.sunColor,
      atmoMistColor: ATMOSPHERE.mistColor,
      atmoMistDensity: ATMOSPHERE.mistDensity,
      atmoMistMode: ATMOSPHERE.mistMode,
      atmoMistHeight: ATMOSPHERE.mistHeight,
      atmoMistThickness: ATMOSPHERE.mistThickness,
    };
  }

  private material(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, transparent: boolean): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
      vertexShader,
      fragmentShader,
      transparent,
      depthWrite: !transparent,
      fog: true,
    });
    this.materials.push(material);
    return material;
  }

  /** Per frame: glitter and glow follow the tuning and the biome's light */
  update() {
    for (const m of this.materials) {
      m.uniforms.glitter.value = WATER.glitter * FX_LIGHT.boost.value;
      m.uniforms.glow.value = WATER.glow * (0.55 + TOON_LIGHT.glow.value * 0.6);
    }
  }

  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.group.clear();
  }
}
