import * as THREE from "three";
import { FX_LIGHT, sceneryTime as fxTime } from "../particles";
import { TOON_LIGHT } from "../toon";
import { WATER } from "../tuning";
import { ATMOSPHERE, MIST } from "./atmosphere";
import { BLOCK } from "./course";
import type { WaterKind } from "./terrain/river";
import type { IslandFall, World } from "./World";

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
  uniform float flowing; // 1 for rivers, 0 for still seas
  uniform float fallBlend; // metres below the lip before the curtain is fully foamy
  uniform float fallSpeed; // downward foam animation rate
  uniform float fade; // falls into the void fade out on the way down
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

const FALL_COLOR = /* glsl */ `
  vec4 fallingWater(vec2 fall, float drop) {
    float u = fall.x;
    float v = fall.y;
    // Advect a fixed pattern through a travel coordinate measured from the lip.
    // Its gradient stays positive at every time, so foam always moves down;
    // the square root stretches the streaks as they accelerate with the drop.
    float speed = fallSpeed * (kind > 0.5 && kind < 1.5 ? 0.22 : 1.0);
    float travel = sqrt(1.0 + max(drop, 0.0)) - 1.0;
    float phase = travel - time * speed;
    float streak = waterFbm(vec2(u * 22.0, phase * 2.0));
    float sheet = waterFbm(vec2(u * 7.0 + 3.0, phase * 0.7));
    float sides = 1.0 - pow(abs(u * 2.0 - 1.0), 3.0);
    // River curtains start at the edge; only island falls fade in from nowhere.
    float lip = mix(1.0, smoothstep(0.0, 0.04, v), fade) * (1.0 - fade * smoothstep(0.3, 1.0, v));
    float spray = smoothstep(0.75, 1.0, v);
    vec3 color;
    float alpha;
    if (kind > 0.5 && kind < 1.5) {
      // A lava fall: glowing, crusting as it cools down the face
      vec3 hot = shallow * (2.4 + 1.2 * streak) * glow;
      color = mix(hot, deep, smoothstep(0.4, 0.9, sheet) * 0.6);
      alpha = sides * lip * (0.85 + 0.15 * streak);
    } else {
      float foam = smoothstep(0.32, 0.72, streak * 0.8 + sheet * 0.2);
      vec3 water = mix(shallow, foamColor, 0.4 + 0.6 * foam);
      float sunUp = clamp(atmoSunDirection.y * 1.5 + 0.35, 0.25, 1.0) * mix(1.0, 0.4, night);
      color = water * (0.7 + 0.45 * sunUp) + atmoSunColor * pow(streak, 6.0) * 0.6 * glitter;
      if (kind > 2.5) color += foamColor * pow(streak, 4.0) * 1.5 * glow;
      alpha = sides * lip * (0.65 + 0.3 * foam) * (1.0 - spray * 0.35);
    }
    return vec4(color, clamp(alpha, 0.0, 0.95));
  }
`;

const poolVertex = /* glsl */ `
  attribute float depth;
  attribute vec2 flow;
  attribute float foam;
  attribute float lipDistance; // metres upstream of an outgoing fall; -1 disables
  attribute vec2 fall;
  attribute float fallDrop;
  varying vec3 vWorld;
  varying float vDepth;
  varying vec2 vFlow;
  varying float vFoam;
  varying float vLipDistance;
  varying vec2 vFall;
  varying float vFallDrop;
  varying vec3 vNormal;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vDepth = depth;
    vFlow = flow;
    vFoam = foam;
    vLipDistance = lipDistance;
    vFall = fall;
    vFallDrop = fallDrop;
    vNormal = mat3(modelMatrix) * normal;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const poolFragment = /* glsl */ `
  #include <fog_pars_fragment>
  ${COMMON}
  ${FALL_COLOR}
  uniform float lipFoam;
  uniform float lipFoamWidth;
  varying vec3 vWorld;
  varying float vDepth;
  varying vec2 vFlow;
  varying float vFoam;
  varying float vLipDistance;
  varying vec2 vFall;
  varying float vFallDrop;
  varying vec3 vNormal;

  void main() {
    // Padded vertices outside the upstream channel must not spill off the cliff.
    if (flowing > 0.5 && vDepth <= -0.15) discard;
    // Most of the curtain only needs the inexpensive falling-water shader.
    if (vFallDrop >= max(fallBlend, 0.001)) {
      vec4 curtain = fallingWater(vFall, vFallDrop);
      curtain.a *= smoothstep(-0.15, 0.45, vDepth);
      gl_FragColor = vec4(waterAir(curtain.rgb, vWorld, vFogDepth), curtain.a);
      #include <colorspace_fragment>
      return;
    }
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
    vec3 n = normalize(vNormal + vec3((h0 - hx) / e * 0.12 * bump, 0.0, (h0 - hz) / e * 0.12 * bump));
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
      float streak = smoothstep(0.62, 0.86, waterFbm(vec2(vFlow.x * 9.0, vFlow.y * 0.06 - t * 0.9))) * flowing;
      float churn = vFoam * (0.55 + 0.45 * waterFbm(vWorld.xz * 0.35 - vec2(0.0, t * 1.2)));
      // Evaluate distance per pixel: vertex foam weights would smear over the
      // last 4 m of river. A broken, narrow band softens only the actual lip.
      float crest = 0.0;
      if (vLipDistance >= 0.0 && vLipDistance < lipFoamWidth) {
        float flecks = waterFbm(vWorld.xz * vec2(1.6, 3.0) - vec2(0.0, t * 1.8));
        float band = 1.0 - smoothstep(0.0, max(lipFoamWidth, 0.001) * (0.55 + 0.45 * flecks), vLipDistance);
        crest = band * smoothstep(0.25, 0.7, flecks) * lipFoam;
      }
      float foamW = clamp(shore * 0.85 + churn + crest + streak * 0.35 * (0.3 + vFoam), 0.0, 1.0);
      color = mix(color, foamColor * (0.75 + 0.35 * sunUp), foamW);
      alpha = clamp(smoothstep(-0.15, 0.45, vDepth) * 0.92 + foamW * 0.3, 0.0, 0.97);
      alpha *= mix(1.0, smoothstep(-0.15, 0.45, vDepth), flowing);
      if (kind > 2.5) {
        // Bioluminescence: specks drifting in the water, brightest at night
        float speck = smoothstep(0.82, 0.97, waterNoise(vWorld.xz * 1.3 + vec2(sin(t * 0.3), t * 0.15)));
        float edge = 1.0 - smoothstep(0.0, 2.5, vDepth);
        color += foamColor * (speck * 1.4 + edge * 0.45) * glow;
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
      // A soft sheen, glinting in specks rather than one blinding spot
      float spec = pow(clamp(dot(r, atmoSunDirection), 0.0, 1.0), 260.0);
      float specks = smoothstep(0.7, 0.95, waterNoise(vWorld.xz * 2.3));
      color += atmoSunColor * spec * (0.25 + 1.6 * specks) * glitter * (1.0 - night * 0.5);
      color = mix(color, foamColor, (1.0 - smoothstep(0.0, 0.6, vDepth)) * 0.7);
    }
    // The lip keeps the exact river shading; aerated streaks emerge as it drops.
    if (vFallDrop > 0.0) {
      float blend = smoothstep(0.0, max(fallBlend, 0.001), vFallDrop);
      vec4 curtain = fallingWater(vFall, vFallDrop);
      // The padded river ribbon includes dry banks. They must not become a fall.
      curtain.a *= smoothstep(-0.15, 0.45, vDepth);
      color = mix(color, curtain.rgb, blend);
      alpha = mix(alpha, curtain.a, blend);
    }
    gl_FragColor = vec4(waterAir(color, vWorld, vFogDepth), alpha);
    #include <colorspace_fragment>
  }
`;

const fallVertex = /* glsl */ `
  attribute vec2 fall; // across 0..1, down 0..1
  attribute float fallDrop;
  varying vec3 vWorld;
  varying vec2 vFall;
  varying float vFallDrop;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vFall = fall;
    vFallDrop = fallDrop;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fallFragment = /* glsl */ `
  #include <fog_pars_fragment>
  ${COMMON}
  ${FALL_COLOR}
  varying vec3 vWorld;
  varying vec2 vFall;
  varying float vFallDrop;
  void main() {
    vec4 water = fallingWater(vFall, vFallDrop);
    gl_FragColor = vec4(waterAir(water.rgb, vWorld, vFogDepth), water.a);
    #include <colorspace_fragment>
  }
`;

/** Metres along z between cross-sections of a pool */
const STEP = 4;
const ACROSS = 10;

/** One block of an endless line (z from z0 to z1) */
interface Span {
  block: number;
  z0: number;
  z1: number;
}

export class WaterView {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  /**
   * All of a level's water; or, given `block`, just that block of an endless line's (its piece of the
   * sea, its pools and falls, the island falls found in it), made once its land is
   */
  constructor(world: World, block: number | null = null) {
    const terrain = world.biome.terrain;
    if (terrain.kind !== "v2") return;
    const span: Span | null = block === null ? null : { block, z0: block * BLOCK, z1: (block + 1) * BLOCK };
    if (world.hasSea && terrain.sea) this.buildSea(world, this.uniforms("water", terrain.sea.colors, world.palette.night, 0, 0), span);
    const islandFalls = span ? world.islandFalls.filter((f) => f.z >= span.z0 && f.z < span.z1) : world.islandFalls;
    if (islandFalls.length && terrain.islandFalls) {
      this.buildIslandFalls(islandFalls, this.uniforms("water", terrain.islandFalls.colors, world.palette.night, 1, 1));
    }
    const steps = world.steps;
    const river = steps?.river;
    if (!steps || !river || !world.land?.ground) return;
    const ground = world.land.ground;
    const uniforms = this.uniforms(river.kind, river.colors, world.palette.night, 1, 0);
    // An endless line's block: its pools, each with a fall at its end and a pool before it
    const section = span ? steps.section(span.block) : null;
    const riverPools = section ? section.pools : steps.pools;
    const stepFalls = section ? section.falls : steps.falls;

    // Pools: ribbons across the river, from one fall to the next
    const positions: number[] = [];
    const depth: number[] = [];
    const flow: number[] = [];
    const foam: number[] = [];
    const lipDistance: number[] = [];
    const index: number[] = [];
    const poolEnds: number[] = [];
    let base = 0;
    riverPools.forEach((pool, p) => {
      const outgoing = stepFalls[p];
      const hasFall = outgoing && outgoing.top - outgoing.bottom >= 3;
      const upstream = !!section || p > 0;
      const z0 = pool.z0 - (upstream ? 3 : 0);
      const z1 = pool.z1;
      const rows = Math.max(2, Math.ceil((z1 - z0) / STEP));
      for (let r = 0; r <= rows; r++) {
        const z = z0 + ((z1 - z0) * r) / rows;
        const center = steps.center(z);
        // At the boundary Steps switches to the lower pool. Keep the upstream width.
        const half = steps.width(Math.min(z, pool.z1 - 0.001)) / 2 + 8;
        // The ground drops before the lip. Its vertical distance is no longer
        // river depth: carry the upstream bed tint and shoreline over the edge.
        const depthZ = section || p + 1 < riverPools.length ? Math.min(z, pool.z1 - STEP * 2) : z;
        const depthCenter = steps.center(depthZ);
        const depthHalf = steps.width(Math.min(depthZ, pool.z1 - 0.001)) / 2 + 8;
        // Churned up just below the previous fall
        const churn = upstream ? Math.exp(-Math.max(0, z - pool.z0) / 14) : 0;
        for (let c = 0; c <= ACROSS; c++) {
          const across = c / ACROSS;
          const x = center - half + half * 2 * across;
          positions.push(x, pool.level, z);
          depth.push(pool.level - ground.height(depthCenter - depthHalf + depthHalf * 2 * across, depthZ));
          flow.push(across, z);
          foam.push(churn);
          lipDistance.push(hasFall ? pool.z1 - z : -1);
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
      poolEnds.push(base + rows * (ACROSS + 1));
      base += (rows + 1) * (ACROSS + 1);
    });
    const pools = new THREE.BufferGeometry();
    pools.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    pools.setAttribute("depth", new THREE.Float32BufferAttribute(depth, 1));
    pools.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 2));
    pools.setAttribute("foam", new THREE.Float32BufferAttribute(foam, 1));
    pools.setAttribute("lipDistance", new THREE.Float32BufferAttribute(lipDistance, 1));
    pools.setAttribute("fall", new THREE.Float32BufferAttribute(new Float32Array(depth.length * 2), 2));
    pools.setAttribute("fallDrop", new THREE.Float32BufferAttribute(new Float32Array(depth.length), 1));
    pools.setIndex(index);
    pools.computeVertexNormals();
    pools.computeBoundingSphere();
    this.geometries.push(pools);
    const poolMaterial = this.material(poolVertex, poolFragment, uniforms, river.kind !== "lava" && river.kind !== "ice");
    // The river must occlude the curtain behind it when viewed from upstream.
    // Dry padded banks are discarded by the shader before they can write depth.
    poolMaterial.depthWrite = true;
    const poolMesh = new THREE.Mesh(pools, poolMaterial);
    poolMesh.renderOrder = 1;
    this.group.add(poolMesh);

    // Falls: curtains arcing off each lip down to the next pool
    const fp: number[] = [];
    const fu: number[] = [];
    const fi: number[] = [];
    const fn: number[] = [];
    const fd: number[] = [];
    const ff: number[] = [];
    const foamFall: number[] = [];
    const drops: number[] = [];
    let fb = 0;
    const DOWN = 14;
    const SIDE = ACROSS;
    for (const [p, fall] of stepFalls.entries()) {
      const drop = fall.top - fall.bottom;
      if (drop < 3) continue;
      const throwOut = 3 + drop * 0.07;
      const center = steps.center(fall.z);
      // Use the same padded cross-section as the pool's final row.
      const half = steps.width(fall.z - 0.001) / 2 + 8;
      const curtainHalf = Math.max(3, fall.width / 2);
      const lip = poolEnds[p];
      for (let d = 0; d <= DOWN; d++) {
        const t = d / DOWN;
        // Ballistic arc: horizontal at the lip, accelerating downward.
        const descended = (drop + 1) * t * t;
        const y = fall.top - descended;
        const z = fall.z + throwOut * t;
        const narrow = t * t * (3 - 2 * t);
        const width = half + (curtainHalf * (1 + t * 0.25) - half) * narrow;
        const normalLength = Math.hypot(throwOut, 2 * (drop + 1) * t);
        for (let s = 0; s <= SIDE; s++) {
          const u = s / SIDE;
          fp.push(center - width + width * 2 * u, y, z);
          fu.push(u, t * t);
          fn.push(0, throwOut / normalLength, 2 * (drop + 1) * t / normalLength);
          fd.push(depth[lip + s]);
          ff.push(u, z);
          foamFall.push(foam[lip + s]);
          drops.push(descended);
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
      falls.setAttribute("normal", new THREE.Float32BufferAttribute(fn, 3));
      falls.setAttribute("depth", new THREE.Float32BufferAttribute(fd, 1));
      falls.setAttribute("flow", new THREE.Float32BufferAttribute(ff, 2));
      falls.setAttribute("foam", new THREE.Float32BufferAttribute(foamFall, 1));
      // Continue the lip's foam into the short join with the falling shader.
      falls.setAttribute("lipDistance", new THREE.Float32BufferAttribute(new Float32Array(drops.length), 1));
      falls.setAttribute("fallDrop", new THREE.Float32BufferAttribute(drops, 1));
      falls.setIndex(fi);
      falls.computeBoundingSphere();
      this.geometries.push(falls);
      const fallMaterial = this.material(poolVertex, poolFragment, uniforms, true);
      fallMaterial.side = THREE.DoubleSide;
      const fallMesh = new THREE.Mesh(falls, fallMaterial);
      fallMesh.renderOrder = 2;
      this.group.add(fallMesh);
    }
  }

  /**
   * A sea: a grid over the whole level (or one block of an endless line, its rows meeting the next
   * block's exactly), with the depth over the ground (and the rock standing in it) per vertex
   */
  private buildSea(world: World, uniforms: Record<string, THREE.IUniform>, span: Span | null) {
    const field = world.land!;
    const ground = field.ground;
    const { course } = world;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let z = span ? span.z0 : course.start.z - 600; z <= (span ? span.z1 : course.endZ + 900); z += 50) {
      xMin = Math.min(xMin, course.x(z));
      xMax = Math.max(xMax, course.x(z));
    }
    const step = 22;
    const x0 = xMin - 1500;
    const z0 = span ? span.z0 : course.start.z - 1400;
    const columns = Math.ceil((xMax + 1500 - x0) / step);
    const rows = span ? Math.ceil(BLOCK / step) : Math.ceil((course.endZ + 1600 - z0) / step);
    const stepZ = span ? BLOCK / rows : step;
    // Rock standing in the water (stacks, islets): foam rings around them
    const standing = field.shapes.filter((s) => {
      if (span && (s.max.z < span.z0 - 30 || s.min.z > span.z1 + 30)) return false;
      const lo = world.seaAt(s.min.z)!;
      const hi = world.seaAt(s.max.z)!;
      return s.min.y < Math.max(lo, hi) + 2 && s.max.y > Math.min(lo, hi) - 2;
    });
    const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
    const normals = new Float32Array(positions.length);
    const depth = new Float32Array((columns + 1) * (rows + 1));
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= columns; c++) {
        const i = r * (columns + 1) + c;
        const x = x0 + c * step;
        const z = z0 + r * stepZ;
        const sea = world.seaAt(z)!;
        positions[i * 3] = x;
        positions[i * 3 + 1] = sea;
        positions[i * 3 + 2] = z;
        normals[i * 3 + 1] = 1;
        let d = ground ? sea - ground.height(x, z) : 40;
        for (const s of standing) {
          if (x > s.min.x - 30 && x < s.max.x + 30 && z > s.min.z - 30 && z < s.max.z + 30) {
            d = Math.min(d, Math.max(-2, field.distance(x, sea, z) * 0.6));
            break;
          }
        }
        depth[i] = d;
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const a = r * (columns + 1) + c;
        const b = a + columns + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("depth", new THREE.BufferAttribute(depth, 1));
    geometry.setAttribute("flow", new THREE.BufferAttribute(new Float32Array((columns + 1) * (rows + 1) * 2), 2));
    geometry.setAttribute("foam", new THREE.BufferAttribute(new Float32Array((columns + 1) * (rows + 1)), 1));
    geometry.setAttribute("lipDistance", new THREE.BufferAttribute(new Float32Array(depth.length).fill(-1), 1));
    geometry.setAttribute("fall", new THREE.BufferAttribute(new Float32Array(depth.length * 2), 2));
    geometry.setAttribute("fallDrop", new THREE.BufferAttribute(new Float32Array(depth.length), 1));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, this.material(poolVertex, poolFragment, uniforms, true));
    mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  /** Curtains pouring off island rims, arcing out and fading into the clouds far below */
  private buildIslandFalls(falls: IslandFall[], uniforms: Record<string, THREE.IUniform>) {
    const DOWN = 26;
    const SIDE = 5;
    const positions: number[] = [];
    const uv: number[] = [];
    const drops: number[] = [];
    const index: number[] = [];
    let base = 0;
    for (const f of falls) {
      const half = f.width / 2;
      for (let d = 0; d <= DOWN; d++) {
        const t = d / DOWN;
        const out = 4 + Math.sqrt(t) * (6 + f.drop * 0.05);
        for (let s = 0; s <= SIDE; s++) {
          const u = s / SIDE;
          const across = (u * 2 - 1) * half * (1 + t * 0.6);
          positions.push(f.x + f.dx * out - f.dz * across, f.y - f.drop * t, f.z + f.dz * out + f.dx * across);
          uv.push(u, t);
          drops.push(f.drop * t);
        }
      }
      for (let d = 0; d < DOWN; d++) {
        for (let s = 0; s < SIDE; s++) {
          const a = base + d * (SIDE + 1) + s;
          const b = a + SIDE + 1;
          index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      base += (DOWN + 1) * (SIDE + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("fall", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute("fallDrop", new THREE.Float32BufferAttribute(drops, 1));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    this.geometries.push(geometry);
    const material = this.material(fallVertex, fallFragment, uniforms, true);
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  private uniforms(kind: WaterKind, colors: { deep: string; shallow: string; foam: string }, night: number, flowing: number, fade: number): Record<string, THREE.IUniform> {
    return {
      time: fxTime,
      kind: { value: KINDS[kind] },
      deep: { value: new THREE.Color(colors.deep) },
      shallow: { value: new THREE.Color(colors.shallow) },
      foamColor: { value: new THREE.Color(colors.foam) },
      glitter: { value: 1 },
      glow: { value: 1 },
      night: { value: night },
      flowing: { value: flowing },
      fade: { value: fade },
      fallBlend: { value: WATER.fallBlend },
      fallSpeed: { value: WATER.fallSpeed },
      lipFoam: { value: WATER.lipFoam },
      lipFoamWidth: { value: WATER.lipFoamWidth },
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
      m.uniforms.fallBlend.value = WATER.fallBlend;
      m.uniforms.fallSpeed.value = WATER.fallSpeed;
      m.uniforms.lipFoam.value = WATER.lipFoam;
      m.uniforms.lipFoamWidth.value = WATER.lipFoamWidth;
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
