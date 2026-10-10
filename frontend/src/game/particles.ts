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

/** How bright glowing effects are in this biome's light (bright skies wash additive light out) */
export const FX_LIGHT = { boost: { value: 1 } };

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
    if (kind > 3.5) shrink = sin(3.14159 * t);
    // Bubbles keep their size, and pop
    if (kind > 4.5) shrink = 1.0 - smoothstep(0.92, 1.0, t);
    gl_PointSize = timing.z * grow * shrink * pixelScale / max(0.1, -mvPosition.z);
    #ifdef ALPHA_BLEND
      vColor = color * physics.z;
    #else
      vColor = color * physics.z * boost;
    #endif
    vAlpha = (kind > 2.5 && kind < 3.5 ? (1.0 - t) * 0.5 : pow(clamp(1.0 - t, 0.0, 1.0), 1.2)) * smoothstep(1.5, 7.0, -mvPosition.z);
    // Fireflies blink: mostly dark, glowing up for a moment every few seconds
    if (kind > 3.5 && kind < 4.5) vAlpha *= 0.15 + 0.85 * smoothstep(0.55, 0.95, sin(age * (1.1 + fract(seed) * 1.4) + seed * 6.0));
    vKind = kind;
    vSpin = seed + age * 3.0;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vSpin;
  #include <fog_pars_fragment>

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    float a;
    if (vKind > 4.5) {
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
      vec3 color = vColor;
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
