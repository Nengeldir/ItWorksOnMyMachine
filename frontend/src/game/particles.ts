import * as THREE from "three";

// Every particle in the game lives in one ring buffer drawn as a single
// THREE.Points. Particles are fire-and-forget: the CPU writes a particle once
// when it is born (start, velocity, color, lifetime) and the vertex shader
// works out where it is from its age, so thousands cost almost nothing.

export const Kind = {
  Glow: 0, // soft round mote
  Star: 1, // four-pointed twinkle
  Shard: 2, // a diamond-shaped crystal chip (or a tumbling leaf)
  Wisp: 3, // a faint puff of air
  Firefly: 4, // a soft mote that blinks on and off
  Bubble: 5, // a thin bright rim and a glint (use with ordinary blending)
  // Crisp shapes with hard, anti-aliased edges (never a soft ball): they turn, and the flat ones tumble
  Feather: 6, // a slender vane with a bright shaft and barbs
  Snowflake: 7, // six branched arms
  Petal: 8, // a pointed petal or willow leaf with a midrib
  Sparkle: 9, // a four-pointed star with concave sides
  Ring: 10, // a thin hoop with a glint (pearls, halos, orbits)
  Cog: 11, // a gear with eight teeth and an axle hole
  Triangle: 12, // a folded paper or crystal chip
  Hex: 13, // a faceted hexagonal gem
  Scale: 14, // a crescent scale
  Maple: 15, // a five-lobed maple leaf on a stem
  Star5: 16, // a five-pointed star
  Confetti: 17, // a little card that flips end over end
  // More crisp shapes, for the particle jars (cosmetics/jars.ts); they sway rather than spin or tumble
  Heart: 18, // a plump heart
  Note: 19, // a music note: a round head, a stem and a flag
  Flame: 20, // a flickering tongue of fire
  Drop: 21, // a drop of water or honey, with a glint
  Cloud: 22, // a round little cloud puff, flat underneath
  Bolt: 23, // a zigzag of lightning
  Glyph: 24, // a rune of an old enchanting script (one of four)
  Swirl: 25, // a spiral, as of a portal's light
  Soul: 26, // a little ghost with two dark eyes and a wavy hem
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export interface ParticleSpec {
  life: number; // seconds
  size: number; // metres
  color: THREE.Color;
  kind: Kind;
  gravity?: number; // m/s², positive falls, negative rises
  drag?: number; // 1/s
  intensity?: number; // brightness; above 1 blooms
}

const shared: ParticleSpec = { life: 1, size: 1, color: new THREE.Color(), kind: 0 };

/**
 * A particle spec for one emit call, without allocating: every call returns the
 * same object (emit copies it straight away), so per-frame emitters create no garbage.
 */
export function fx(life: number, size: number, color: THREE.Color, kind: Kind, gravity = 0, drag = 0, intensity = 1): ParticleSpec {
  shared.life = life;
  shared.size = size;
  shared.color = color;
  shared.kind = kind;
  shared.gravity = gravity;
  shared.drag = drag;
  shared.intensity = intensity;
  return shared;
}

/** Shared by everything that animates with time in a shader: trails, particles, crystals */
export const fxTime = { value: 0 };
/** Scenery clock: hourglass slows the world while pilot/item clocks keep normal pace. */
export const sceneryTime = { value: 0 };

/**
 * How bright glowing effects are in this biome's light (bright skies wash additive light out), and whether
 * its sky is dark (`skyIsDark`): on light skies the pilot's wing particles are drawn as solid shapes
 */
export const FX_LIGHT = { boost: { value: 1 }, dark: false };

const vertexShader = /* glsl */ `
  attribute vec3 velocity;
  attribute vec4 timing; // birth, life, size, kind
  attribute vec3 physics; // gravity, drag, intensity
  attribute vec3 color;
  uniform float time;
  uniform float pixelScale;
  uniform float boost;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vSpin;
  varying float vPx;
  varying float vSeed;
  #include <fog_pars_vertex>

  void main() {
    float age = time - timing.x;
    float life = timing.y;
    if (age < 0.0 || age > life) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float t = age / life;
    float drag = physics.y;
    float travel = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
    vec3 p = position + velocity * travel;
    p.y -= 0.5 * physics.x * age * age;
    // A little curl so motes drift instead of flying in straight lines
    float seed = dot(position, vec3(12.9898, 78.233, 37.719));
    p += vec3(sin(age * 2.3 + seed), sin(age * 1.7 + seed * 1.3), cos(age * 2.1 + seed * 0.7)) * 0.35 * age;

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float kind = timing.w;
    float grow = smoothstep(0.0, 0.08, t);
    float shrink = kind > 0.5 && kind < 1.5 ? sin(3.14159 * t) : 1.0 - t * t;
    if (kind > 3.5 && kind < 4.5) shrink = sin(3.14159 * t);
    // Bubbles keep their size, and pop
    if (kind > 4.5 && kind < 5.5) shrink = 1.0 - smoothstep(0.92, 1.0, t);
    // Shapes keep most of their size (a flake does not melt into a dot)
    bool shaped = kind > 5.5;
    if (shaped) shrink = 1.0 - 0.3 * t * t;
    gl_PointSize = timing.z * grow * shrink * pixelScale / max(0.1, -mvPosition.z);
    vPx = gl_PointSize;
    #ifdef ALPHA_BLEND
      vColor = color * physics.z;
    #else
      vColor = color * physics.z * boost;
    #endif
    vAlpha = (kind > 2.5 && kind < 3.5 ? (1.0 - t) * 0.5 : pow(clamp(1.0 - t, 0.0, 1.0), 1.2)) * smoothstep(1.5, 7.0, -mvPosition.z);
    // Shapes stay clear for most of their life, then fade
    if (shaped) vAlpha = (1.0 - smoothstep(0.5, 1.0, t)) * smoothstep(1.5, 7.0, -mvPosition.z);
    // Fireflies blink: mostly dark, glowing up for a moment every few seconds
    if (kind > 3.5 && kind < 4.5) vAlpha *= 0.15 + 0.85 * smoothstep(0.55, 0.95, sin(age * (1.1 + fract(seed) * 1.4) + seed * 6.0));
    vKind = kind;
    vSpin = seed + age * 3.0;
    vSeed = fract(seed * 0.1);
    #include <fog_vertex>
  }
`;

/**
 * The crisp particle shapes (also drawn by the particle jars' own points, cosmetics/jars.ts): `shape(uv, kind,
 * spin, px, seed)` gives how much of a point sprite's pixel the shape covers, and sets `shapeFace` to how bright
 * that bit of its face is. `uv` runs from -1 to 1 across the sprite, `px` is its size in pixels
 */
export const SHAPES_GLSL = /* glsl */ `
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
  }

  // Signed distance to a five-pointed star (Inigo Quilez)
  float star5(vec2 p, float r, float rf) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
  }

  // How bright this point of a crisp shape's face is (set by shape())
  float shapeFace = 1.0;

  // The crisp shapes: how much of this pixel the shape covers (from a signed distance, negative inside), and
  // in shapeFace how bright each point of the face is. Edges are anti-aliased over about a pixel, so they read
  // sharp at any size.
  float shape(vec2 uv, float kind, float spin, float px, float seed) {
    // Cogs turn slowly, the jars' shapes sway, the rest spin
    float turn = kind > 17.5 ? (kind > 24.5 && kind < 25.5 ? spin * 1.4 : sin(spin * 0.7) * 0.3) : spin * (kind > 10.5 && kind < 11.5 ? 0.5 : 0.8);
    float c = cos(turn), s = sin(turn);
    vec2 q = mat2(c, -s, s, c) * uv;
    // Flat things tumble: one axis shrinks and grows as they flip over
    float flip = cos(spin * 0.9 + 1.3);
    bool tumbles = kind < 8.5 || (kind > 11.5 && kind < 12.5) || kind > 14.5 && kind < 15.5 || (kind > 16.5 && kind < 17.5);
    if (tumbles && !(kind > 6.5 && kind < 7.5)) q.x /= max(0.22, abs(flip));
    float shade = kind > 17.5 ? 1.0 : 0.82 + 0.18 * sign(flip); // the back of a tumbling flake is a little darker
    float e = 2.4 / max(px, 1.0);
    float d;
    float face = 1.0;
    if (kind < 6.5) {
      // Feather: a pointed vane, a bright shaft, fine barbs
      float w = 0.3 * clamp((0.92 - q.y) * 1.1, 0.0, 1.0) * smoothstep(-0.95, -0.45, q.y);
      d = max(abs(q.x) - w, abs(q.y + 0.03) - 0.95);
      d = min(d, max(abs(q.x) - 0.035, abs(q.y + 0.6) - 0.35)); // the quill
      float shaft = 1.0 - smoothstep(0.03, 0.07, abs(q.x));
      face = 0.62 + 0.18 * step(0.5, fract(q.y * 7.0 - abs(q.x) * 4.0)) + 0.5 * shaft;
    } else if (kind < 7.5) {
      // Snowflake: fold into one 60-degree sector, then an arm with two pairs of twigs
      float r = length(q);
      float ang = mod(atan(q.y, q.x) + 0.5236, 1.0472) - 0.5236;
      vec2 p = vec2(cos(ang), abs(sin(ang))) * r;
      d = segment(p, vec2(0.0), vec2(0.9, 0.0)) - 0.075;
      d = min(d, segment(p, vec2(0.45, 0.0), vec2(0.66, 0.2)) - 0.06);
      d = min(d, segment(p, vec2(0.68, 0.0), vec2(0.82, 0.13)) - 0.05);
      d = min(d, r - 0.2);
      face = 0.85 + 0.25 * (1.0 - smoothstep(0.0, 0.25, r));
    } else if (kind < 8.5) {
      // Petal: two arcs meeting in points, with a midrib
      d = max(length(q - vec2(0.55, 0.0)), length(q + vec2(0.55, 0.0))) - 0.92;
      face = 0.72 + 0.2 * (1.0 - abs(q.y)) + 0.25 * (1.0 - smoothstep(0.02, 0.06, abs(q.x)));
    } else if (kind < 9.5) {
      // Sparkle: concave four-pointed star
      vec2 a = abs(q);
      d = (sqrt(a.x) + sqrt(a.y) - 0.92) * 0.5;
      face = 0.8 + 0.6 * (1.0 - smoothstep(0.0, 0.3, length(q)));
    } else if (kind < 10.5) {
      // Ring with a glint
      float r = length(q);
      d = abs(r - 0.68) - 0.1;
      face = 0.75 + 0.6 * exp(-dot(q - vec2(0.48, 0.48), q - vec2(0.48, 0.48)) * 30.0);
    } else if (kind < 11.5) {
      // Cog
      float r = length(q);
      float ang = atan(q.y, q.x);
      float teeth = smoothstep(-0.25, 0.25, cos(ang * 8.0));
      d = max(r - (0.66 + 0.2 * teeth), 0.24 - r);
      face = 0.75 + 0.3 * smoothstep(0.5, 0.42, r);
    } else if (kind < 12.5) {
      // Triangle (equilateral), with one folded facet a shade darker
      vec2 p = q;
      const float k = 1.7320508;
      p.x = abs(p.x) - 0.8;
      p.y = p.y + 0.8 / k;
      if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
      p.x -= clamp(p.x, -1.6, 0.0);
      d = -length(p) * sign(p.y);
      face = q.x > 0.0 ? 1.0 : 0.72;
    } else if (kind < 13.5) {
      // Hexagonal gem with facets
      const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
      vec2 p = abs(q);
      p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
      p -= vec2(clamp(p.x, -k.z * 0.72, k.z * 0.72), 0.72);
      d = length(p) * sign(p.y);
      float ang = atan(q.y, q.x);
      face = 0.7 + 0.3 * step(0.5, fract(ang / 1.0472 + 0.5)) + 0.25 * step(length(q), 0.3);
    } else if (kind < 14.5) {
      // Crescent scale
      d = max(length(q) - 0.82, -(length(q - vec2(0.0, 0.42)) - 0.7));
      face = 0.75 + 0.35 * smoothstep(-0.3, -0.8, q.y);
    } else if (kind < 15.5) {
      // Maple leaf: five pointed lobes (the lower ones smaller) on a stem
      vec2 p = q - vec2(0.0, 0.08);
      float r = length(p);
      float ang = atan(p.x, p.y); // 0 straight up
      float lobes = pow(abs(cos(ang * 2.5)), 4.0);
      float R = (0.36 + 0.5 * lobes) * (0.72 + 0.28 * cos(ang * 0.5));
      d = (r - R) * 0.7;
      d = min(d, max(abs(q.x) - 0.04, abs(q.y + 0.72) - 0.22)); // stem
      float vein = min(min(abs(p.x), abs(p.x * 0.31 - p.y * 0.95)), abs(-p.x * 0.31 - p.y * 0.95));
      face = 0.72 + 0.35 * (1.0 - smoothstep(0.02, 0.06, vein));
    } else if (kind < 16.5) {
      d = star5(q, 0.92, 0.45);
      face = 0.8 + 0.45 * (1.0 - smoothstep(0.0, 0.35, length(q)));
    } else if (kind < 17.5) {
      // Confetti card, creased across the middle
      vec2 b = abs(q) - vec2(0.62, 0.4);
      d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0);
      face = q.y > 0.0 ? 1.0 : 0.78;
    } else if (kind < 18.5) {
      // Heart (Inigo Quilez's), tip down, a glint on the upper left lobe
      vec2 p = q * 1.05 + vec2(0.0, 0.62);
      p.x = abs(p.x);
      if (p.y + p.x > 1.0) d = length(p - vec2(0.25, 0.75)) - 0.35355339;
      else d = sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
      d /= 1.05;
      face = 0.8 + 0.5 * exp(-dot(q - vec2(-0.32, 0.28), q - vec2(-0.32, 0.28)) * 18.0);
    } else if (kind < 19.5) {
      // Music note: a tilted oval head, a stem, a curling flag
      vec2 h = q - vec2(-0.22, -0.5);
      h = mat2(0.866, 0.5, -0.5, 0.866) * h;
      d = length(h / vec2(1.0, 0.68)) * 0.68 - 0.27;
      d = min(d, segment(q, vec2(0.04, -0.45), vec2(0.04, 0.78)) - 0.07);
      d = min(d, segment(q, vec2(0.04, 0.78), vec2(0.42, 0.42)) - 0.08);
      d = min(d, segment(q, vec2(0.42, 0.42), vec2(0.36, 0.12)) - 0.06);
      face = 0.85 + 0.3 * exp(-dot(h - vec2(-0.08, 0.06), h - vec2(-0.08, 0.06)) * 40.0);
    } else if (kind < 20.5) {
      // Flame: round below, licking up to a point that flickers; a hot heart near the bottom
      vec2 p = q;
      p.x += sin(spin * 5.0 + p.y * 5.0) * 0.08 * clamp(p.y + 0.4, 0.0, 1.0);
      d = length(vec2(p.x * (1.0 + 1.3 * clamp(p.y + 0.25, 0.0, 1.4)), p.y + 0.22)) - 0.62;
      d = max(d, p.y - 0.9);
      face = 0.75 + 0.6 * (1.0 - smoothstep(0.0, 0.5, length(q - vec2(0.0, -0.3))));
    } else if (kind < 21.5) {
      // Drop: round below, pointed above, a bright glint
      d = length(vec2(q.x * (1.0 + 1.1 * clamp(q.y + 0.2, 0.0, 1.4)), q.y + 0.25)) - 0.6;
      d = max(d, q.y - 0.92);
      face = 0.78 + 0.25 * smoothstep(0.2, -0.6, q.y) + 0.6 * exp(-dot(q - vec2(-0.18, -0.12), q - vec2(-0.18, -0.12)) * 45.0);
    } else if (kind < 22.5) {
      // Cloud puff: three round lobes on a flat base, lit from above
      d = min(min(length(q - vec2(-0.42, -0.12)) - 0.36, length(q - vec2(0.04, 0.12)) - 0.48), length(q - vec2(0.46, -0.14)) - 0.34);
      d = max(d, -0.46 - q.y);
      face = 0.78 + 0.3 * smoothstep(-0.4, 0.5, q.y);
    } else if (kind < 23.5) {
      // Lightning bolt: a thick zigzag tapering to its tip
      d = segment(q, vec2(0.3, 0.92), vec2(-0.22, 0.08)) - 0.13;
      d = min(d, segment(q, vec2(-0.22, 0.08), vec2(0.22, 0.02)) - 0.11);
      d = min(d, segment(q, vec2(0.22, 0.02), vec2(-0.3, -0.92)) - 0.04 - 0.07 * clamp(q.y + 0.92, 0.0, 1.0));
      face = 0.9 + 0.3 * (1.0 - smoothstep(0.0, 0.12, abs(q.x + q.y * 0.3)));
    } else if (kind < 24.5) {
      // A rune of the enchanting script: which one comes from the particle's seed
      float g = floor(seed * 4.0);
      if (g < 0.5) {
        d = segment(q, vec2(-0.5, 0.62), vec2(0.45, 0.62));
        d = min(d, segment(q, vec2(0.45, 0.62), vec2(0.45, -0.62)));
        d = min(d, segment(q, vec2(-0.45, -0.05), vec2(0.15, -0.05)));
      } else if (g < 1.5) {
        d = segment(q, vec2(-0.5, 0.6), vec2(0.5, 0.6));
        d = min(d, segment(q, vec2(0.0, 0.6), vec2(0.0, -0.6)));
        d = min(d, segment(q, vec2(-0.35, -0.6), vec2(0.35, -0.6)));
      } else if (g < 2.5) {
        d = segment(q, vec2(-0.45, 0.6), vec2(-0.45, -0.6));
        d = min(d, segment(q, vec2(-0.45, -0.6), vec2(0.45, -0.6)));
        d = min(d, length(q - vec2(0.2, 0.25)) - 0.09);
      } else {
        d = segment(q, vec2(-0.5, -0.6), vec2(0.0, 0.62));
        d = min(d, segment(q, vec2(0.0, 0.62), vec2(0.5, -0.6)));
        d = min(d, segment(q, vec2(-0.25, -0.05), vec2(0.25, -0.05)));
      }
      d -= 0.085;
      face = 1.0;
    } else if (kind < 25.5) {
      // Spiral: a ribbon wound three times round, thinning towards the middle
      float r = length(q);
      float a = atan(q.y, q.x);
      float k = 0.1;
      float turns = floor((r / k - a) / 6.2831853 + 0.5);
      d = abs(r - k * (a + 6.2831853 * turns)) - 0.03 - 0.07 * r;
      d = max(d, r - 0.9);
      face = 0.75 + 0.45 * smoothstep(0.9, 0.1, r);
    } else {
      // Soul: a round head flowing into a wavy hem, two dark eyes
      float hem = -0.62 + 0.1 * sin(q.x * 11.0 + spin * 4.0);
      float body = max(abs(q.x) - 0.5 + 0.12 * clamp(-q.y, 0.0, 1.0), max(q.y - 0.1, hem - q.y));
      d = min(length(q - vec2(0.0, 0.1)) - 0.5, body);
      float eyes = min(length(q - vec2(-0.18, 0.16)), length(q - vec2(0.18, 0.16)));
      face = (0.85 + 0.3 * smoothstep(-0.6, 0.5, q.y)) * (0.25 + 0.75 * smoothstep(0.07, 0.1, eyes));
    }
    shapeFace = face * shade;
    return 1.0 - smoothstep(-e, e, d);
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
        a *= shapeFace; // added light: the face's shading is how much light it adds
      #endif
    } else if (vKind > 4.5) {
      float r = sqrt(r2);
      vec2 glint = uv + vec2(0.35);
      a = smoothstep(1.0, 0.86, r) * (0.16 + 0.84 * smoothstep(0.5, 0.9, r)) + exp(-dot(glint, glint) * 30.0) * 0.8;
    } else if (vKind < 0.5 || vKind > 3.5) {
      // A readable grain with a narrow soft edge, plus just a trace of halo.
      a = 0.88 * (1.0 - smoothstep(0.12, 0.48, sqrt(r2))) + 0.12 * exp(-r2 * 10.0);
    } else if (vKind < 1.5) {
      // A twinkle: bright core and two rays that slowly turn
      float c = cos(vSpin * 0.4), s = sin(vSpin * 0.4);
      vec2 q = abs(mat2(c, -s, s, c) * uv);
      float rays = exp(-q.x * 18.0) * exp(-q.y * 2.5) + exp(-q.y * 18.0) * exp(-q.x * 2.5);
      a = min(1.0, rays * 0.35 + exp(-r2 * 20.0));
    } else if (vKind < 2.5) {
      float c = cos(vSpin), s = sin(vSpin);
      vec2 q = abs(mat2(c, -s, s, c) * uv);
      float d = q.x * 1.6 + q.y;
      a = smoothstep(1.0, 0.85, d) * (0.55 + 0.45 * smoothstep(0.7, 0.0, d)) + exp(-r2 * 20.0);
    } else {
      a = exp(-r2 * 3.0) * 0.6;
    }
    if (a < 0.01) discard;
    #ifdef ALPHA_BLEND
      // Solid shapes are opaque where they cover, their face shading their color
      vec3 color = vColor * shapeFace;
      #ifdef USE_FOG
        color = mix(color, fogColor, smoothstep(fogNear, fogFar, vFogDepth));
      #endif
      gl_FragColor = vec4(color, clamp(a * vAlpha, 0.0, 1.0));
    #else
      vec3 color = vColor * a * vAlpha;
      #ifdef USE_FOG
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        color *= 1.0 - fogFactor;
      #endif
      gl_FragColor = vec4(color, 1.0);
    #endif
  }
`;

export class Particles {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Scales how many particles emitters spawn (lowered on slow machines) */
  budget = 1;
  private readonly capacity: number;
  private cursor = 0;
  private readonly start: Float32Array;
  private readonly velocity: Float32Array;
  private readonly timing: Float32Array;
  private readonly physics: Float32Array;
  private readonly color: Float32Array;
  private uploaded = 0; // the cursor at the last upload
  private pending = 0; // particles written since then

  /** `alpha`: ordinary blending (snow, leaves, ash, mist) instead of adding light */
  constructor(capacity = 6000, alpha = false) {
    this.capacity = capacity;
    this.start = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.timing = new Float32Array(capacity * 4);
    this.physics = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    // Start everything dead
    for (let i = 0; i < capacity; i++) this.timing[i * 4] = -1e6;

    const geometry = new THREE.BufferGeometry();
    const attribute = (array: Float32Array, size: number) =>
      new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", attribute(this.start, 3));
    geometry.setAttribute("velocity", attribute(this.velocity, 3));
    geometry.setAttribute("timing", attribute(this.timing, 4));
    geometry.setAttribute("physics", attribute(this.physics, 3));
    geometry.setAttribute("color", attribute(this.color, 3));

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { pixelScale: { value: 800 } }]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: alpha ? THREE.NormalBlending : THREE.AdditiveBlending,
      fog: true,
      defines: alpha ? { ALPHA_BLEND: "" } : {},
    });
    material.uniforms.time = fxTime;
    material.uniforms.boost = FX_LIGHT.boost;
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = alpha ? 4 : 5;
  }

  /** Converts metres to pixels: call when the viewport or field of view changes */
  setViewport(height: number, fov: number) {
    this.points.material.uniforms.pixelScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  /** `age`: seconds since a subframe birth, so moving emitters do not spawn in batches. */
  /** Particles alive now (the ?perf overlay; walks every slot, so not per frame) */
  alive(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (fxTime.value - this.timing[i * 4] < this.timing[i * 4 + 1]) n++;
    return n;
  }

  emit(position: THREE.Vector3, velocity: THREE.Vector3, spec: ParticleSpec, age = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pending++;
    this.start[i * 3] = position.x;
    this.start[i * 3 + 1] = position.y;
    this.start[i * 3 + 2] = position.z;
    this.velocity[i * 3] = velocity.x;
    this.velocity[i * 3 + 1] = velocity.y;
    this.velocity[i * 3 + 2] = velocity.z;
    this.timing[i * 4] = fxTime.value - age;
    this.timing[i * 4 + 1] = spec.life;
    this.timing[i * 4 + 2] = spec.size;
    this.timing[i * 4 + 3] = spec.kind;
    this.physics[i * 3] = spec.gravity ?? 0;
    this.physics[i * 3 + 1] = spec.drag ?? 0;
    this.physics[i * 3 + 2] = spec.intensity ?? 1;
    this.color[i * 3] = spec.color.r;
    this.color[i * 3 + 1] = spec.color.g;
    this.color[i * 3 + 2] = spec.color.b;
  }

  /** Uploads what was emitted since the last call: one run of slots, or two if it wrapped around */
  update() {
    if (this.pending === 0) return;
    const from = this.uploaded;
    const count = Math.min(this.pending, this.capacity);
    const ranges: [number, number][] =
      count === this.capacity
        ? [[0, this.capacity]]
        : from + count <= this.capacity
          ? [[from, count]]
          : [
              [from, this.capacity - from],
              [0, from + count - this.capacity],
            ];
    for (const name of ["position", "velocity", "timing", "physics", "color"]) {
      const attribute = this.points.geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      for (const [start, length] of ranges) {
        attribute.addUpdateRange(start * attribute.itemSize, length * attribute.itemSize);
      }
      attribute.needsUpdate = true;
    }
    this.uploaded = this.cursor;
    this.pending = 0;
  }

  /** Kills every particle (e.g. on a new map) */
  clear() {
    for (let i = 0; i < this.capacity; i++) this.timing[i * 4] = -1e6;
    this.pending = this.capacity; // upload everything next frame
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
