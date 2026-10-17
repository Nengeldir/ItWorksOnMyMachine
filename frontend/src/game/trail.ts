import * as THREE from "three";
import { FX_LIGHT, fxTime } from "./particles";
import { FX } from "./tuning";

const LENGTH = 64;
const MIN_STEP = 0.8;
/** Drawn vertices per stored segment: the ribbon is a Catmull-Rom curve through the points, never a polyline */
const SUB = 4;
const DRAWN = (LENGTH - 1) * SUB + 1;

const p0 = new THREE.Vector3();
const p3 = new THREE.Vector3();
const point = new THREE.Vector3();
const side = new THREE.Vector3();

/** Centred Catmull-Rom between b and c at t (a and d the neighbours) */
function catmull(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number) {
  const t2 = t * t, t3 = t2 * t;
  const ka = -0.5 * t3 + t2 - 0.5 * t;
  const kb = 1.5 * t3 - 2.5 * t2 + 1;
  const kc = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const kd = 0.5 * t3 - 0.5 * t2;
  return out.set(
    a.x * ka + b.x * kb + c.x * kc + d.x * kd,
    a.y * ka + b.y * kb + c.y * kc + d.y * kd,
    a.z * ka + b.z * kb + c.z * kc + d.z * kd,
  );
}

const vertexShader = /* glsl */ `
  attribute vec2 along; // x: 0 at the newest point .. 1 at the end; y: -1..1 across
  varying vec2 vAlong;
  varying float vNear;
  #include <fog_pars_vertex>
  void main() {
    vAlong = along;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Fade where the ribbon passes right by the camera, or it fills the screen
    vNear = smoothstep(4.0, 14.0, -mvPosition.z);
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 head;
  uniform vec3 tail;
  uniform float opacity;
  uniform float glow;
  uniform float shimmer;
  uniform float time;
  varying vec2 vAlong;
  varying float vNear;
  #include <fog_pars_fragment>
  void main() {
    // Clamped: interpolation can overshoot a hair, and pow() of a negative is NaN (which bloom spreads)
    float t = clamp(vAlong.x, 0.0, 1.0);
    float across = clamp(1.0 - vAlong.y * vAlong.y, 0.0, 1.0); // soft edges
    float fade = pow(1.0 - t, 1.6) * smoothstep(0.0, 0.03, t);
    // Light pulses running down the ribbon
    float pulse = 1.0 + shimmer * (0.5 * sin(t * 46.0 - time * 14.0) + 0.35 * sin(t * 17.0 - time * 5.0));
    float core = pow(across, 3.0); // a bright thread in the middle
    vec3 color = mix(head, tail, smoothstep(0.0, 0.7, t)) * (across * 0.55 + core * 0.9) * pulse * glow;
    float a = fade * opacity * vNear;
    #ifdef USE_FOG
      a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    gl_FragColor = vec4(color * a, 1.0);
  }
`;

export interface TrailOptions {
  width?: number;
  tail?: string; // color the ribbon fades to
  shimmer?: number;
  length?: number; // multiplier on the point spacing
}

/** A glowing ribbon behind a wingtip (or the cape) */
export class Trail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly points: THREE.Vector3[] = [];
  private readonly sides: THREE.Vector3[] = [];
  private readonly positions: Float32Array;
  private readonly width: number;
  private readonly spacing: number;
  private readonly anchor = new THREE.Vector3();
  /** Where the newest point settles once it is left behind (see `push`) */
  private readonly settled = new THREE.Vector3();
  glowScale = 1;

  constructor(color: string, options: TrailOptions = {}) {
    this.width = options.width ?? 0.14;
    this.spacing = options.length ?? 1;
    this.positions = new Float32Array(DRAWN * 2 * 3);
    const along = new Float32Array(DRAWN * 2 * 2);
    for (let i = 0; i < DRAWN; i++) {
      along.set([i / (DRAWN - 1), 1, i / (DRAWN - 1), -1], i * 4);
    }
    const index: number[] = [];
    for (let i = 0; i < DRAWN - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("along", new THREE.BufferAttribute(along, 2));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            head: { value: new THREE.Color("#ffffff") },
            tail: { value: new THREE.Color(options.tail ?? color) },
            opacity: { value: 0 },
            glow: { value: 1 },
            shimmer: { value: options.shimmer ?? 1 },
          },
        ]),
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: true,
      }),
    );
    this.mesh.material.uniforms.time = fxTime;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.setColor(color, options.tail);
  }

  /** The newest end glows `head`, fading into `tail` */
  setColor(head: string, tail?: string) {
    const uniforms = this.mesh.material.uniforms;
    (uniforms.head.value as THREE.Color).set(head).lerp(new THREE.Color("#ffffff"), 0.55);
    (uniforms.tail.value as THREE.Color).set(tail ?? head);
  }

  reset() {
    this.points.length = 0;
    this.sides.length = 0;
  }

  /**
   * Moves every point but the newest by `offset`: a pilot held still in moving air (the finale's
   * void) still leaves a ribbon streaming behind, as if flying
   */
  drift(offset: THREE.Vector3) {
    for (let i = 1; i < this.points.length; i++) this.points[i].add(offset);
    this.anchor.add(offset);
    this.settled.add(offset);
  }

  /**
   * Adds the wingtip's current position; `side` is the direction the ribbon spans. `settled` is where
   * the point is kept once the ribbon moves on (the tip with fast flaps calmed): the newest end stays
   * glued to the wingtip, and the ribbon behind it waves gently instead of zigzagging every beat
   */
  push(point: THREE.Vector3, side: THREE.Vector3, lengthScale = 1, settled = point) {
    const last = this.points[0];
    const step = MIN_STEP * this.spacing * FX.trailLength * lengthScale;
    if (last && this.anchor.distanceToSquared(point) < step * step) {
      // Keep the newest end glued to the wingtip
      last.copy(point);
      this.sides[0].copy(side);
      this.settled.copy(settled);
    } else {
      // The point left behind takes its settled place
      if (last) last.copy(this.settled);
      this.settled.copy(settled);
      this.anchor.copy(point);
      // Reuse the dropped vector instead of allocating
      const recycled = this.points.length >= LENGTH ? this.points.pop()! : new THREE.Vector3();
      const recycledSide = this.sides.length >= LENGTH ? this.sides.pop()! : new THREE.Vector3();
      this.points.unshift(recycled.copy(point));
      this.sides.unshift(recycledSide.copy(side));
    }
    this.write();
  }

  private write() {
    const count = this.points.length;
    const width = this.width * FX.trailWidth;
    const points = this.points;
    const last = count - 1;
    for (let i = 0; i < DRAWN; i++) {
      // Unused slots collapse onto the oldest point
      const u = i / SUB;
      const j = Math.min(Math.floor(u), Math.max(0, last));
      const f = j >= last ? 0 : u - j;
      const b = points[j];
      const c = points[Math.min(j + 1, last)];
      // Missing neighbours at the ends are mirrored, so the curve leaves straight
      const a = j > 0 ? points[j - 1] : p0.copy(b).multiplyScalar(2).sub(c);
      const d = j + 2 <= last ? points[j + 2] : p3.copy(c).multiplyScalar(2).sub(b);
      catmull(point, a, b, c, d, f);
      side.lerpVectors(this.sides[j], this.sides[Math.min(j + 1, last)], f).normalize();
      const t = i / (DRAWN - 1);
      // Thin at the wingtip, swelling, then tapering away
      const w = width * (0.25 + 0.75 * Math.sin(Math.min(1, t * 5) * Math.PI * 0.5)) * (1 - t) ** 0.5;
      const k = i * 6;
      this.positions[k] = point.x + side.x * w;
      this.positions[k + 1] = point.y + side.y * w;
      this.positions[k + 2] = point.z + side.z * w;
      this.positions[k + 3] = point.x - side.x * w;
      this.positions[k + 4] = point.y - side.y * w;
      this.positions[k + 5] = point.z - side.z * w;
    }
    this.mesh.geometry.getAttribute("position").needsUpdate = true;
  }

  set opacity(value: number) {
    this.mesh.material.uniforms.opacity.value = value;
    this.mesh.material.uniforms.glow.value = FX.trailGlow * FX_LIGHT.boost.value * this.glowScale;
    this.mesh.visible = value > 0.01 && FX.trailGlow > 0 && this.points.length > 1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
