import * as THREE from "three";
import { Builder, cyl, leaf, lathe } from "../items/builder";
import { FX_LIGHT, Kind, SHAPES_GLSL } from "../particles";
import { toonMaterial } from "../toon";
import { JAR_FX } from "../tuning";
import { type JarId, jarSpec } from "./catalog";
import { disposeModel, paintedModel } from "./models";

// Particle jars (looks only, CLAUDE.md rule 6). Every jar holds one kind of particle of its own, with its own
// palette and motion (the variety follows Minecraft's particles: hearts, note-block notes, cherry leaves,
// bubble columns, dripping honey, poofs, happy villagers, snowflakes, flame and soul-fire flame, electric
// sparks, enchanting glyphs, fireflies, portal light, sculk souls, end-rod light, a totem's shower).
//
//  - In the jar: a little swarm of its particles going round inside the glass (the journal, pickups).
//  - Worn: the same swarm, larger, drifts in an aura round the pilot (`JarMotes`, one draw call, carried
//    by the pilot so it turns with them), and the particles stream off behind as a trail (pilotfx.ts).
//
// Common and uncommon jars hold plain shapes, drawn solid (ordinary blending, full color, no bloom); rare and
// legendary ones glow: added light, bright enough to bloom (× `JAR_FX.glow`). The rarer the jar, the more
// motes in its aura and the richer its trail; legendary trails throw a few big "hero" pieces.

/** How the aura's motes move round the pilot (or round inside the jar) */
export type JarMotion =
  | "drift" // bob about where they appear, floating up a little
  | "rise" // float up through the aura (bubbles, flames, souls)
  | "fall" // drift down through it (petals, snow, honey)
  | "orbit" // circle round the pilot's body
  | "inward" // appear round the edge and drift in towards the pilot (glyphs)
  | "spiral" // circle in towards the pilot (portal light)
  | "jitter" // jump about from place to place (sparks)
  | "hang"; // stay where they appear and twinkle (starlight)
const MOTIONS: JarMotion[] = ["drift", "rise", "fall", "orbit", "inward", "spiral", "jitter", "hang"];

export interface JarRecipe {
  kind: Kind;
  colors: readonly string[];
  motion: JarMotion;
  /** Metres, for a mote of the aura (× `JAR_FX.auraSize`) */
  size: number;
  /** Seconds a mote of the aura lives before it appears somewhere else */
  cycle: number;
  /** How fast the motion goes (laps, climbs…; 1 is the usual) */
  speed: number;
  trail: {
    /** Particles per second at rarity 0 (× the rarity's richness and `JAR_FX.trail`) */
    rate: number;
    /** Metres (× `JAR_FX.trailSize`) */
    size: readonly [number, number];
    life: readonly [number, number];
    /** m/s²: positive falls, negative rises */
    gravity: number;
    drag: number;
    /** m/s of random scatter */
    scatter: number;
  };
  /** Brightness of the glowing ones (× `JAR_FX.glow`); plain ones are drawn at their own color */
  light: number;
}

const trail = (rate: number, size: [number, number], life: [number, number], gravity = 0, drag = 2, scatter = 0.8) => ({ rate, size, life, gravity, drag, scatter });

export const JAR_RECIPES: Record<JarId, JarRecipe> = {
  // ── Common: plain shapes ──
  hearts: { kind: Kind.Heart, colors: ["#ff6f9a", "#ff9fbd", "#ff4f7d"], motion: "drift", size: 0.22, cycle: 1.6, speed: 1, light: 1,
    trail: trail(7, [0.2, 0.3], [0.9, 1.4], -0.6) },
  notes: { kind: Kind.Note, colors: ["#5ec8ff", "#7cf08a", "#ffe066", "#ff8a5c", "#ff6fc8", "#a48bff"], motion: "drift", size: 0.24, cycle: 1.8, speed: 1, light: 1,
    trail: trail(6, [0.22, 0.32], [1, 1.5], -0.5) },
  blossom: { kind: Kind.Petal, colors: ["#ffc6d8", "#ffe4ec", "#ff9fbf"], motion: "fall", size: 0.2, cycle: 2, speed: 0.8, light: 1,
    trail: trail(8, [0.18, 0.28], [1.2, 1.8], 0.8, 1.6, 1) },
  bubbles: { kind: Kind.Bubble, colors: ["#bff3ff", "#8fe3ff", "#ffffff"], motion: "rise", size: 0.2, cycle: 1.5, speed: 1, light: 1,
    trail: trail(7, [0.16, 0.3], [0.8, 1.3], -2, 1.5, 0.6) },
  // ── Uncommon: plain shapes ──
  honey: { kind: Kind.Drop, colors: ["#ffb43a", "#ffcf5a", "#f08f1e"], motion: "fall", size: 0.2, cycle: 1.4, speed: 1.2, light: 1,
    trail: trail(8, [0.16, 0.26], [0.8, 1.2], 4, 1, 0.3) },
  puffs: { kind: Kind.Cloud, colors: ["#ffffff", "#eef3ff", "#dfe7f5"], motion: "orbit", size: 0.32, cycle: 2.2, speed: 0.6, light: 1,
    trail: trail(7, [0.3, 0.5], [1, 1.6], -0.2, 2.4, 0.5) },
  joy: { kind: Kind.Sparkle, colors: ["#4fd97f", "#8cf5a5", "#2fbf63"], motion: "drift", size: 0.18, cycle: 1.2, speed: 1.4, light: 1,
    trail: trail(10, [0.14, 0.24], [0.6, 1], -0.3, 2, 1.2) },
  snow: { kind: Kind.Snowflake, colors: ["#ffffff", "#e3f4ff", "#c4e6ff"], motion: "fall", size: 0.22, cycle: 2, speed: 0.7, light: 1,
    trail: trail(9, [0.18, 0.3], [1.2, 1.8], 0.9, 1.4, 0.9) },
  // ── Rare: they glow ──
  flame: { kind: Kind.Flame, colors: ["#ffb347", "#ff7a2a", "#ffd86a"], motion: "rise", size: 0.22, cycle: 1, speed: 1.3, light: 1.5,
    trail: trail(12, [0.18, 0.3], [0.5, 0.8], -2.5, 2.5, 0.6) },
  soulfire: { kind: Kind.Flame, colors: ["#4fe3ff", "#7ff6ff", "#2fb8ff"], motion: "rise", size: 0.22, cycle: 1.1, speed: 1.2, light: 1.5,
    trail: trail(12, [0.18, 0.3], [0.5, 0.9], -2.2, 2.5, 0.6) },
  sparks: { kind: Kind.Bolt, colors: ["#fff06a", "#ffffff", "#bfe8ff"], motion: "jitter", size: 0.2, cycle: 0.45, speed: 1, light: 1.7,
    trail: trail(14, [0.14, 0.26], [0.2, 0.4], 0, 1, 2.2) },
  glyphs: { kind: Kind.Glyph, colors: ["#d9c4ff", "#ffffff", "#a98bff"], motion: "inward", size: 0.17, cycle: 1.6, speed: 1, light: 1.5,
    trail: trail(10, [0.14, 0.22], [0.9, 1.4], -0.4, 2.5, 0.5) },
  fireflies: { kind: Kind.Firefly, colors: ["#e4ff6a", "#bfff4a", "#fff27a"], motion: "orbit", size: 0.16, cycle: 3, speed: 0.4, light: 1.6,
    trail: trail(8, [0.12, 0.2], [1.6, 2.4], -0.2, 2.2, 0.6) },
  // ── Legendary: they glow, richest ──
  portal: { kind: Kind.Swirl, colors: ["#b45cff", "#e07bff", "#7a3cff", "#ffffff"], motion: "spiral", size: 0.24, cycle: 1.4, speed: 1, light: 1.6,
    trail: trail(12, [0.2, 0.32], [0.8, 1.2], 0, 2.6, 0.8) },
  souls: { kind: Kind.Soul, colors: ["#7af2ff", "#c9fbff", "#5fd8ff"], motion: "rise", size: 0.26, cycle: 1.8, speed: 0.7, light: 1.5,
    trail: trail(9, [0.24, 0.36], [1.2, 1.8], -1.2, 2, 0.5) },
  starlight: { kind: Kind.Star, colors: ["#ffffff", "#f3e8ff", "#e6f0ff"], motion: "hang", size: 0.3, cycle: 2.4, speed: 1, light: 1.8,
    trail: trail(12, [0.24, 0.4], [2, 3], -0.1, 3, 0.4) },
  totem: { kind: Kind.Confetti, colors: ["#6fdc58", "#ffd84a", "#3fbf4a", "#fff3a0"], motion: "rise", size: 0.17, cycle: 1.2, speed: 1.4, light: 1.4,
    trail: trail(14, [0.14, 0.22], [0.9, 1.4], 1.4, 1.6, 1.6) },
};

/** By rarity: motes in the aura, and how much richer the trail is */
const AURA_COUNT = [10, 14, 20, 28];
const TRAIL_RICHNESS = [1, 1.3, 1.7, 2.2];

/** Everything a worn jar needs to draw: its recipe and what its rarity gives it */
export interface JarLook {
  id: JarId;
  recipe: JarRecipe;
  rarity: number;
  /** Rare and legendary: added light that blooms; the others are solid */
  glow: boolean;
  auraCount: number;
  trailRichness: number;
  /** Each trail particle picks one */
  colors: THREE.Color[];
}
const looks = new Map<JarId, JarLook>();
export function jarLook(id: JarId): JarLook {
  let look = looks.get(id);
  if (!look) {
    const recipe = JAR_RECIPES[id];
    const rarity = jarSpec(id)?.rarity ?? 0;
    look = { id, recipe, rarity, glow: rarity >= 2, auraCount: AURA_COUNT[rarity], trailRichness: TRAIL_RICHNESS[rarity], colors: recipe.colors.map((c) => new THREE.Color(c)) };
    looks.set(id, look);
  }
  return look;
}

const vertexShader = /* glsl */ `
  attribute vec4 seed; // phase, angle, speed variation, size variation
  attribute vec3 tint;
  uniform float time;
  uniform float pixelScale;
  uniform float boost;
  uniform float kind;
  uniform float size;
  uniform float light;
  uniform float motion;
  uniform float speed;
  uniform float cycle;
  uniform float opacity;
  uniform vec3 extent; // half size of the swarm's space
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vSpin;
  varying float vPx;
  varying float vSeed;
  #include <fog_pars_vertex>

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float life = cycle * (0.75 + 0.5 * seed.z);
    float lives = time / life + seed.x;
    float c = fract(lives);
    float n = floor(lives) + seed.y * 13.0;
    // Each life appears somewhere new on the swarm's shell
    float theta = hash(n) * 6.2831853;
    float h = hash(n + 7.1) * 2.0 - 1.0;
    float ring = sqrt(max(0.0, 1.0 - h * h));
    vec3 dir = vec3(cos(theta) * ring, h, sin(theta) * ring);
    float depth = mix(0.55, 1.0, hash(n + 3.3));
    vec3 p = dir * extent * depth;
    float sway = sin(time * 2.1 + seed.y * 9.0);
    if (motion < 0.5) {
      // drift
      p += vec3(sway * 0.08, c * 0.3 * extent.y, cos(time * 1.7 + seed.y * 5.0) * 0.08);
    } else if (motion < 1.5) {
      // rise
      p.y = mix(-extent.y, extent.y, c) * 0.9;
      p.x += sway * 0.06 * extent.x;
    } else if (motion < 2.5) {
      // fall
      p.y = mix(extent.y, -extent.y, c) * 0.9;
      p.x += sway * 0.12 * extent.x;
    } else if (motion < 3.5) {
      // orbit round the body (its long axis, z)
      float a = theta + c * speed * 6.2831853 * (seed.z > 0.5 ? 1.0 : -1.0);
      p = vec3(cos(a) * extent.x * depth, sin(a) * extent.y * depth, h * extent.z);
    } else if (motion < 4.5) {
      // inward
      p *= 1.0 - 0.85 * c;
    } else if (motion < 5.5) {
      // spiral in
      float a = theta + c * speed * 6.2831853;
      float r = 1.0 - 0.8 * c;
      p = vec3(cos(a) * extent.x * r, sin(a) * extent.y * r, h * extent.z * r);
    } else if (motion < 6.5) {
      // jitter: a new spot several times a life
      float jump = floor(c * 5.0);
      p += (vec3(hash(n + jump), hash(n + jump + 1.7), hash(n + jump + 2.9)) - 0.5) * extent * 0.6;
    }
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float grow = smoothstep(0.0, 0.15, c) * (1.0 - 0.3 * c * c);
    gl_PointSize = size * (0.75 + 0.5 * seed.w) * grow * pixelScale / max(0.1, -mvPosition.z);
    vPx = gl_PointSize;
    #ifdef ALPHA_BLEND
      vColor = tint * light;
    #else
      vColor = tint * light * boost;
    #endif
    float fade = smoothstep(0.0, 0.12, c) * (1.0 - smoothstep(0.7, 1.0, c));
    // Fireflies blink; starlight twinkles
    if (kind > 3.5 && kind < 4.5) fade *= 0.15 + 0.85 * smoothstep(0.4, 0.95, sin(time * (1.3 + seed.z) + seed.y * 6.0));
    if (motion > 6.5) fade *= 0.55 + 0.45 * sin(time * 7.0 + seed.y * 11.0);
    vAlpha = fade * opacity * smoothstep(0.15, 0.6, -mvPosition.z);
    vKind = kind;
    vSpin = seed.y * 10.0 + time * 2.0;
    vSeed = seed.z;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vSpin;
  varying float vPx;
  varying float vSeed;
  #include <fog_pars_fragment>
  ${SHAPES_GLSL}
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    float a;
    if (vKind > 5.5) {
      a = shape(uv, vKind, vSpin, vPx, vSeed);
      #ifndef ALPHA_BLEND
        a *= shapeFace;
      #endif
    } else if (vKind > 4.5) {
      // A bubble: a thin bright rim and a glint
      float r = sqrt(r2);
      vec2 glint = uv + vec2(0.35);
      a = smoothstep(1.0, 0.86, r) * (0.16 + 0.84 * smoothstep(0.5, 0.9, r)) + exp(-dot(glint, glint) * 30.0) * 0.8;
    } else if (vKind > 0.5 && vKind < 1.5) {
      // A twinkle: a bright core and two rays
      float c = cos(vSpin * 0.4), s = sin(vSpin * 0.4);
      vec2 q = abs(mat2(c, -s, s, c) * uv);
      a = min(1.0, (exp(-q.x * 18.0) * exp(-q.y * 2.5) + exp(-q.y * 18.0) * exp(-q.x * 2.5)) * 0.35 + exp(-r2 * 20.0));
    } else {
      // A soft mote (fireflies)
      a = 0.88 * (1.0 - smoothstep(0.12, 0.48, sqrt(r2))) + 0.12 * exp(-r2 * 10.0);
    }
    if (a < 0.01) discard;
    #ifdef ALPHA_BLEND
      vec3 color = vColor * shapeFace;
      #ifdef USE_FOG
        color = mix(color, fogColor, smoothstep(fogNear, fogFar, vFogDepth));
      #endif
      gl_FragColor = vec4(color, clamp(a * vAlpha, 0.0, 1.0));
    #else
      vec3 color = vColor * a * vAlpha;
      #ifdef USE_FOG
        color *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      gl_FragColor = vec4(color, 1.0);
    #endif
  }
`;

const drawSize = new THREE.Vector2();

/**
 * A swarm of a jar's particles going round in a space of half size `extent`, in its parent's frame: round the
 * pilot as their aura, or inside a jar. One draw call; positions are worked out in the shader from the time
 */
export class JarMotes {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly glowing: THREE.ShaderMaterial;
  private readonly solid: THREE.ShaderMaterial;
  private readonly capacity: number;
  /** × the jar's mote size (the aura's follow `JAR_FX.auraSize`) */
  scale: number;
  private look: JarLook | null = null;
  /** 0..1, eased by the owner (hidden while not flying) */
  opacity = 1;
  private time = 0;

  constructor(capacity: number, extent: THREE.Vector3, scale = 1) {
    this.capacity = capacity;
    this.scale = scale;
    const geometry = new THREE.BufferGeometry();
    const seeds = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) seeds.set([(i * 0.618034) % 1, Math.random(), Math.random(), Math.random()], i * 4);
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
    geometry.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    const uniforms = () => ({
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      time: { value: 0 }, pixelScale: { value: 800 }, boost: FX_LIGHT.boost, kind: { value: 0 }, size: { value: 0.2 },
      light: { value: 1 }, motion: { value: 0 }, speed: { value: 1 }, cycle: { value: 1 }, opacity: { value: 1 },
      extent: { value: extent },
    });
    this.glowing = new THREE.ShaderMaterial({ uniforms: uniforms(), vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    this.solid = new THREE.ShaderMaterial({ uniforms: uniforms(), vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: true, defines: { ALPHA_BLEND: "" } });
    this.points = new THREE.Points(geometry, this.glowing);
    this.points.frustumCulled = false;
    this.points.visible = false;
    // Sizes are in metres: the view it is drawn in turns them into pixels
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const target = renderer.getRenderTarget();
      const height = target ? target.height : renderer.getDrawingBufferSize(drawSize).y;
      this.points.material.uniforms.pixelScale.value = (height * (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5]) / 2;
    };
  }

  /** Which jar's particles to show (none: hidden) */
  set(id: JarId | "none") {
    if (id === "none") {
      this.look = null;
      this.points.visible = false;
      return;
    }
    if (this.look?.id === id) return;
    const look = (this.look = jarLook(id));
    const material = look.glow ? this.glowing : this.solid;
    this.points.material = material;
    const tint = this.points.geometry.getAttribute("tint") as THREE.BufferAttribute;
    for (let i = 0; i < this.capacity; i++) look.colors[i % look.colors.length].toArray(tint.array, i * 3);
    tint.needsUpdate = true;
    const { recipe } = look;
    const u = material.uniforms;
    u.kind.value = recipe.kind;
    u.motion.value = MOTIONS.indexOf(recipe.motion);
    u.speed.value = recipe.speed;
    u.cycle.value = recipe.cycle;
    this.points.visible = true;
  }

  /** `count`: how many of its motes show (the jar's rarity decides, the particle budget trims) */
  update(dt: number, count = this.capacity) {
    const look = this.look;
    if (!look) return;
    this.time += dt;
    const u = this.points.material.uniforms;
    u.time.value = this.time;
    u.size.value = look.recipe.size * this.scale;
    u.light.value = look.glow ? look.recipe.light * JAR_FX.glow : 1;
    u.opacity.value = this.opacity;
    this.points.geometry.setDrawRange(0, Math.max(0, Math.min(this.capacity, Math.round(count))));
    this.points.visible = this.opacity > 0.01 && count >= 1;
  }

  dispose() {
    this.points.geometry.dispose();
    this.glowing.dispose();
    this.solid.dispose();
    this.points.removeFromParent();
  }
}

// --- the jar itself -----------------------------------------------------------------------------------------

// Glass: see-through, its silhouette drawn by a bright rim (an ink outline would show through it as a dark fill)
const glass = toonMaterial({ ghost: true, rim: 1.2, rimColor: "#ffffff" });
glass.opacity = 0.28;

/**
 * A little glass jar with a cork, a gold rim and a ribbon in the jar's color, its particles going round inside
 * (`animate` turns them). Sized about 0.45 m tall, standing on its base at the origin
 */
export function buildJar(id: JarId): { group: THREE.Group; animate: (dt: number) => void; dispose: () => void } {
  const spec = jarSpec(id);
  const color = spec?.color ?? "#ffffff";
  const group = new THREE.Group();
  // The glass: round-shouldered, a short neck and a lip
  const profile: [number, number][] = [[0.001, 0], [0.13, 0], [0.165, 0.025], [0.175, 0.09], [0.172, 0.22], [0.15, 0.275], [0.105, 0.305], [0.095, 0.33], [0.108, 0.345], [0.1, 0.355]];
  // Painted like every model (the toon material reads vertex colors): pale glass, a breath of the jar's color
  const tint = new THREE.Color("#eef8ff").lerp(new THREE.Color(color), 0.18).getStyle();
  const body = new Builder().add(lathe(profile, 28), tint, 0.15).build();
  const jar = new THREE.Mesh(body, glass);
  jar.renderOrder = 3;
  group.add(jar);
  // Cork, gold rim, a glass foot and a ribbon tied in a bow
  const b = new Builder()
    .add(cyl(0.088, 0.082, 0.075, 18), "#b9855a", 0, [0, 0.375, 0])
    .add(cyl(0.089, 0.089, 0.012, 18), "#9a6a42", 0, [0, 0.41, 0])
    .add(new THREE.TorusGeometry(0.104, 0.011, 6, 28), "#f3c869", 0.25, [0, 0.343, 0], [Math.PI / 2, 0, 0])
    // A thick glass foot, inked, so the clear jar keeps its shape against any background
    .add(new THREE.TorusGeometry(0.152, 0.016, 6, 32), "#dff1ff", 0.1, [0, 0.016, 0], [Math.PI / 2, 0, 0])
    .add(new THREE.TorusGeometry(0.1, 0.012, 6, 28), color, 0, [0, 0.318, 0], [Math.PI / 2, 0, 0])
    .add(leaf(0.09, 0.05, 0.01), color, 0, [0.02, 0.318, -0.1], [0, 0, -1.1])
    .add(leaf(0.09, 0.05, 0.01), color, 0, [-0.02, 0.318, -0.1], [0, 0, 1.1])
    .add(leaf(0.07, 0.025, 0.01), color, 0, [0.015, 0.31, -0.102], [0, 0, -2.6])
    .add(leaf(0.07, 0.025, 0.01), color, 0, [-0.015, 0.31, -0.102], [0, 0, 2.6]);
  const trims = paintedModel(b);
  group.add(trims);
  // The particles, inside the glass
  const motes = new JarMotes(14, new THREE.Vector3(0.1, 0.09, 0.1), 0.3);
  motes.points.position.set(0, 0.15, 0);
  motes.points.renderOrder = 2;
  motes.set(id);
  group.add(motes.points);
  // Glowing jars light up from within
  let lamp: THREE.Mesh | null = null;
  if (jarLook(id).glow) {
    lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    lamp.position.set(0, 0.15, 0);
    lamp.renderOrder = 1;
    group.add(lamp);
  }
  return {
    group,
    animate: (dt) => motes.update(dt),
    dispose: () => {
      motes.dispose();
      body.dispose();
      if (lamp) { lamp.geometry.dispose(); (lamp.material as THREE.Material).dispose(); }
      disposeModel(trims);
      group.removeFromParent();
    },
  };
}
