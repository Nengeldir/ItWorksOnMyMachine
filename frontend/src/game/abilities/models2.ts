import * as THREE from "three";
import { FX_LIGHT, fxTime } from "../particles";

// Models for the design list's abilities 11 to 20 (run/abilities.ts has
// their rules, fx2.ts animates them), in the game's style: creatures of light
// like Sky's spirits (moths, butterflies, a falcon) painted in the fragment
// shader with glowing rims, and soft painted shaders for wind and song.
// Shapes that can cover much of the screen (funnels, the song, the cushion)
// use normal blending so they read on a bright day sky instead of whiting it
// out under bloom; small, thin things (ribbons, creatures' rims) glow above 1.
// Every shader clamps before pow() and never divides by something that can
// reach zero (one NaN blackens the bloomed frame).

// --- creatures of light: moths, butterflies, the spirit falcon ------------------------------

export type Creature = "moth" | "butterfly" | "falcon";

/** Points along a smooth closed-ish outline through `control` (x out, z back), `count` of them */
function outline(control: [number, number][], count: number): [number, number][] {
  const curve = new THREE.CatmullRomCurve3(control.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal");
  return curve.getPoints(count).map((p) => [p.x, p.z]);
}

interface Parts {
  position: number[];
  edge: number[]; // 0 at a wing's root … 1 at its outline (the rim glows)
  wing: number[]; // -1 left wing, +1 right, 0 the body (doesn't flap)
  hind: number[]; // 0 fore wing, 1 hind wing (it lags the stroke)
  pattern: number[]; // which painting: 0 body, 1 fore wing, 2 hind wing
  local: number[]; // the unflapped position, for the pattern
}

/** A wing as a fan of triangles from its root, so `edge` runs from the root out to the rim */
function fan(parts: Parts, points: [number, number][], side: 1 | -1, hind: 0 | 1, root: [number, number] = [0, 0], still = false) {
  const push = (x: number, z: number, edge: number) => {
    parts.position.push(x * side, 0, z);
    parts.local.push(x, 0, z);
    parts.edge.push(edge);
    parts.wing.push(still ? 0 : side);
    parts.hind.push(hind);
    parts.pattern.push(1 + hind);
  };
  for (let i = 0; i < points.length - 1; i++) {
    // Wound so the face is up for the right wing; mirrored for the left
    const [a, b] = side > 0 ? [points[i + 1], points[i]] : [points[i], points[i + 1]];
    push(root[0], root[1], 0);
    push(a[0], a[1], 1);
    push(b[0], b[1], 1);
  }
}

/** A body: a little spindle along z, `length` long, `width` across */
function body(parts: Parts, length: number, width: number, z0: number, sides = 10, rings = 8) {
  const at = (i: number, j: number): [number, number, number] => {
    const t = i / rings;
    const r = width * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.7;
    const a = (j / sides) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r * 0.8, z0 + t * length];
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const [x, y, z] of quad) {
        parts.position.push(x, y, z);
        parts.local.push(x, y, z);
        parts.edge.push(0.35);
        parts.wing.push(0);
        parts.hind.push(0);
        parts.pattern.push(0);
      }
    }
  }
}

/** A thin glowing feeler from `from` to `to` (two crossed blades) */
function feeler(parts: Parts, from: [number, number, number], to: [number, number, number], width: number) {
  for (const [dx, dy] of [[width, 0], [0, width]]) {
    const quad = [
      [from[0] - dx, from[1] - dy, from[2]], [to[0] - dx * 0.3, to[1] - dy * 0.3, to[2]], [to[0] + dx * 0.3, to[1] + dy * 0.3, to[2]],
      [from[0] - dx, from[1] - dy, from[2]], [to[0] + dx * 0.3, to[1] + dy * 0.3, to[2]], [from[0] + dx, from[1] + dy, from[2]],
    ];
    quad.forEach(([x, y, z], k) => {
      parts.position.push(x, y, z);
      parts.local.push(x, y, z);
      parts.edge.push(k === 1 || k === 2 || k === 4 ? 1 : 0.4);
      parts.wing.push(0);
      parts.hind.push(0);
      parts.pattern.push(0);
    });
  }
}

/**
 * A creature's geometry, facing -z, wings in the xz plane (y up), about 1 m
 * across: a moth (soft rounded wings, feathered feelers), a butterfly (broad
 * fore wings, lobed hind wings with tails, eyespots) or a falcon (long swept
 * pointed wings, a fan of a tail)
 */
export function creatureGeometry(kind: Creature): THREE.BufferGeometry {
  const parts: Parts = { position: [], edge: [], wing: [], hind: [], pattern: [], local: [] };
  for (const side of [1, -1] as const) {
    if (kind === "moth") {
      fan(parts, outline([[0.02, -0.08], [0.22, -0.2], [0.48, -0.16], [0.52, 0.02], [0.3, 0.08], [0.04, 0.04]], 18), side, 0);
      fan(parts, outline([[0.03, 0.02], [0.3, 0.06], [0.36, 0.22], [0.18, 0.3], [0.03, 0.18]], 14), side, 1);
    } else if (kind === "butterfly") {
      fan(parts, outline([[0.02, -0.06], [0.2, -0.3], [0.5, -0.36], [0.56, -0.16], [0.42, 0.04], [0.05, 0.04]], 20), side, 0);
      fan(parts, outline([[0.04, 0.03], [0.36, 0.08], [0.42, 0.26], [0.26, 0.36], [0.17, 0.52], [0.1, 0.36], [0.03, 0.2]], 18), side, 1);
    } else {
      // A falcon's long, swept, pointed wing, and half of its tail
      fan(parts, outline([[0.05, -0.12], [0.35, -0.2], [0.7, -0.12], [1.05, 0.12], [0.72, 0.1], [0.4, 0.14], [0.06, 0.12]], 22), side, 0);
      fan(parts, outline([[0.0, 0.36], [0.1, 0.5], [0.18, 0.78], [0.08, 0.84], [0.0, 0.82]], 10), side, 1, [0, 0.36], true);
    }
  }
  if (kind === "falcon") {
    body(parts, 0.82, 0.11, -0.42);
    // The head and beak, a little ahead
    body(parts, 0.22, 0.075, -0.56, 8, 6);
  } else {
    body(parts, kind === "moth" ? 0.42 : 0.5, kind === "moth" ? 0.06 : 0.045, -0.16);
    for (const s of [1, -1]) feeler(parts, [0.02 * s, 0.02, -0.15], [0.16 * s, 0.1, kind === "moth" ? -0.36 : -0.42], 0.012);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(parts.position, 3));
  geometry.setAttribute("local", new THREE.Float32BufferAttribute(parts.local, 3));
  geometry.setAttribute("edge", new THREE.Float32BufferAttribute(parts.edge, 1));
  geometry.setAttribute("wing", new THREE.Float32BufferAttribute(parts.wing, 1));
  geometry.setAttribute("hind", new THREE.Float32BufferAttribute(parts.hind, 1));
  geometry.setAttribute("pattern", new THREE.Float32BufferAttribute(parts.pattern, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

const creatureVertex = /* glsl */ `
  attribute vec3 local;
  attribute float edge;
  attribute float wing;
  attribute float hind;
  attribute float pattern;
  attribute vec4 flap; // phase, rate (Hz), amplitude (rad), opacity
  attribute vec3 tint;
  uniform float time;
  varying vec3 vLocal;
  varying float vEdge;
  varying float vPattern;
  varying float vOpacity;
  varying vec3 vTint;
  varying float vLift;
  void main() {
    vLocal = local;
    vEdge = edge;
    vPattern = pattern;
    vOpacity = flap.w;
    vTint = tint;
    vec3 p = position;
    if (abs(wing) > 0.5) {
      // Both wings beat about the body's long axis together; the hind wing lags, the tips bend more
      float stroke = sin(time * flap.y * 6.2832 + flap.x - hind * 0.5);
      float a = (stroke * flap.z + 0.1) * wing * (1.0 + 0.25 * edge);
      float c = cos(a);
      float s = sin(a);
      p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
      vLift = stroke;
    } else {
      vLift = 0.0;
    }
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const creatureFragment = /* glsl */ `
  uniform float boost;
  uniform float kind; // 0 moth, 1 butterfly, 2 falcon
  uniform vec3 inner;
  uniform vec3 outer;
  uniform vec3 rim;
  varying vec3 vLocal;
  varying float vEdge;
  varying float vPattern;
  varying float vOpacity;
  varying vec3 vTint;
  varying float vLift;
  void main() {
    float e = clamp(vEdge, 0.0, 1.0);
    vec3 c = mix(inner, outer, smoothstep(0.15, 0.95, e)) * vTint;
    float alpha = 0.9;
    float glow = 0.0;
    if (vPattern > 0.5) {
      // Veins fanning from the root, a glowing rim, the wings brighter on the downstroke
      vec2 q = vLocal.xz;
      float angle = atan(q.y, abs(q.x) + 1e-4);
      float veins = smoothstep(0.86, 1.0, sin(angle * 9.0)) * smoothstep(0.2, 0.7, e) * 0.35;
      c = mix(c, rim, veins);
      glow = smoothstep(0.78, 1.0, e) * 1.3;
      if (kind > 0.5 && kind < 1.5) {
        // Butterfly: eyespots on every wing, a dusting of light towards the rim
        vec2 spot = vPattern < 1.5 ? vec2(0.36, -0.14) : vec2(0.24, 0.22);
        float d = length(vec2(abs(q.x), q.y) - spot);
        float ring = exp(-pow(max(d - 0.06, 0.0) * 40.0, 2.0));
        float eye = 1.0 - smoothstep(0.03, 0.045, d);
        c = mix(c, rim, ring * 0.9);
        c = mix(c, vec3(1.0), eye);
        glow += ring * 0.9 + eye * 0.6;
      } else if (kind > 1.5) {
        // Falcon: barred feathers along the wing
        float bars = smoothstep(0.7, 1.0, sin(e * 22.0)) * smoothstep(0.3, 0.9, e);
        c = mix(c, rim, bars * 0.4);
      }
      alpha = mix(0.55, 0.9, smoothstep(0.0, 0.6, e)) * (0.85 + 0.15 * vLift);
    } else {
      glow = 0.6 + smoothstep(0.9, 1.0, e) * 1.6; // the body glows softly, the feelers' tips brightly
    }
    // Painted on, with only the rims and spots above 1 (they bloom)
    vec3 color = c * (0.9 + glow * (0.4 + 0.5 * boost));
    gl_FragColor = vec4(color, clamp(alpha * vOpacity, 0.0, 1.0));
  }
`;

const CREATURE_COLORS: Record<Creature, [string, string, string]> = {
  moth: ["#fff7e0", "#d9c8ff", "#ffe39a"],
  butterfly: ["#ffe4f4", "#b8a0ff", "#7df5d8"],
  falcon: ["#fff4d6", "#f3c869", "#ffffff"],
};

/**
 * Up to `capacity` creatures of one kind in a single draw call. Each has its
 * own transform, flap (phase, rate, amplitude), opacity and tint; the wings
 * beat in the vertex shader
 */
export class Swarm {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly flap: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private count = 0;

  constructor(kind: Creature, capacity: number, colors: [string, string, string] = CREATURE_COLORS[kind]) {
    const geometry = creatureGeometry(kind);
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("flap", this.flap);
    geometry.setAttribute("tint", this.tint);
    const [inner, outer, rim] = colors;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: fxTime,
        boost: FX_LIGHT.boost,
        kind: { value: kind === "moth" ? 0 : kind === "butterfly" ? 1 : 2 },
        inner: { value: new THREE.Color(inner) },
        outer: { value: new THREE.Color(outer) },
        rim: { value: new THREE.Color(rim) },
      },
      vertexShader: creatureVertex,
      fragmentShader: creatureFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
  }

  begin() {
    this.count = 0;
  }

  /** One creature this frame: placed by `matrix`, beating `rate` Hz by `amplitude` rad */
  add(matrix: THREE.Matrix4, phase: number, rate: number, amplitude: number, opacity: number, tint?: THREE.Color) {
    const i = this.count;
    if (i >= this.mesh.instanceMatrix.count || opacity <= 0.003) return;
    this.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.flap.setXYZW(i, phase, rate, amplitude, opacity);
    if (tint) this.tint.setXYZ(i, tint.r, tint.g, tint.b);
    else this.tint.setXYZ(i, 1, 1, 1);
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    for (const a of [this.mesh.instanceMatrix, this.flap, this.tint]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// --- wind funnels: Zenith's updraft, the Draft-Weaving tornado, Ascension's column -------------

const funnelVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vNear;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNear = smoothstep(0.6, 3.0, -mvPosition.z);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mvPosition.xyz)));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const funnelFragment = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  uniform float opacity;
  uniform float twist; // turns of the streaks along the funnel
  uniform float flow; // how fast the streaks run along it (+: from the mouth to the far end)
  uniform float spin; // how fast they turn round it
  uniform float streaks; // how many
  uniform float rings; // rings of wind running along it (0: none)
  uniform float reach; // 0..1 of the length shown (it grows out from the mouth)
  uniform float boost;
  varying vec2 vUv;
  varying float vNear;
  varying float vFacing;
  void main() {
    float along = clamp(vUv.y, 0.0, 1.0);
    if (along > reach) discard;
    float a = vUv.x * 6.2832;
    // Streaks winding round the funnel (twist), turning (spin) and broken into dashes that run along it (flow)
    float phase = a * streaks + along * twist * 6.2832 - time * spin;
    float dashes = 0.55 + 0.45 * sin(along * 18.0 - time * flow * 3.0);
    float s1 = smoothstep(0.9, 1.0, sin(phase)) * dashes;
    float s2 = smoothstep(0.95, 1.0, sin(phase * 1.7 + 2.1 + along * 4.0)) * (0.5 + 0.5 * sin(along * 31.0 - time * flow * 4.5));
    float k = fract(along * 4.0 - time * flow * 0.8);
    float ring = rings > 0.5 ? exp(-k * k * 260.0) + exp(-(1.0 - k) * (1.0 - k) * 260.0) : 0.0;
    // Soft at both ends and where the wall is seen face-on (the edges of the funnel carry it)
    float ends = smoothstep(0.0, 0.12, along) * smoothstep(reach, reach - 0.2, along);
    float edgeOn = mix(0.35, 1.0, 1.0 - vFacing);
    float alpha = clamp(s1 * 0.7 + s2 * 0.5 + ring * 0.5, 0.0, 1.0) * ends * edgeOn * opacity * vNear;
    vec3 c = mix(color, vec3(1.0), s2 * 0.6 + ring * 0.3) * (0.95 + 0.35 * boost);
    gl_FragColor = vec4(c, alpha);
  }
`;

export interface FunnelOptions {
  /** Radius at the mouth (z = 0) and at the far end (z = -1) */
  mouth: number;
  end: number;
  color: THREE.ColorRepresentation;
  twist: number;
  flow: number;
  spin: number;
  streaks: number;
  rings?: boolean;
}

/** An open funnel along -z from the origin, 1 m long: scale z to its length */
export function funnelMesh(o: FunnelOptions): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> {
  // Laid along -z: the cylinder's bottom becomes the mouth at z = 0, its top the far end at z = -1
  const geometry = new THREE.CylinderGeometry(o.end, o.mouth, 1, 40, 12, true);
  geometry.rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  const uv = geometry.getAttribute("uv");
  const position = geometry.getAttribute("position");
  for (let i = 0; i < uv.count; i++) uv.setY(i, -position.getZ(i));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(o.color) },
      time: fxTime,
      opacity: { value: 0 },
      twist: { value: o.twist },
      flow: { value: o.flow },
      spin: { value: o.spin },
      streaks: { value: o.streaks },
      rings: { value: o.rings ? 1 : 0 },
      reach: { value: 1 },
      boost: FX_LIGHT.boost,
    },
    vertexShader: funnelVertex,
    fragmentShader: funnelFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  return mesh;
}

// --- the song (Resonance) and the air cushion (Aero-Braking) ------------------------------------

const shellVertex = /* glsl */ `
  varying vec3 vLocal;
  varying float vFacing;
  varying float vNear;
  void main() {
    vLocal = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mvPosition.xyz)));
    vNear = smoothstep(1.0, 6.0, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const songFragment = /* glsl */ `
  uniform vec3 color;
  uniform vec3 accent;
  uniform float time;
  uniform float opacity;
  uniform float cone; // the cap's half angle (radians)
  uniform float boost;
  varying vec3 vLocal;
  varying float vFacing;
  varying float vNear;
  void main() {
    // Angle from the cap's axis (-z), 0 … cone
    vec3 d = normalize(vLocal);
    float off = acos(clamp(-d.z, -1.0, 1.0)) / max(cone, 0.01);
    float a = atan(d.y, d.x + 1e-5);
    // Ripples running out from the middle, notes of light dancing on them, a soft rim
    float ripple = smoothstep(0.75, 1.0, sin(off * 26.0 - time * 9.0));
    float notes = smoothstep(0.93, 1.0, sin(a * 14.0 + time * 2.0)) * smoothstep(0.85, 1.0, sin(off * 13.0 - time * 4.0));
    float grazing = pow(clamp(1.0 - vFacing, 0.0, 1.0), 2.0);
    float fade = 1.0 - smoothstep(0.75, 1.0, off);
    float alpha = clamp(ripple * 0.35 + notes * 0.8 + grazing * 0.5, 0.0, 1.0) * fade * opacity * vNear;
    vec3 c = mix(color, accent, notes) * (1.0 + 0.4 * boost) + vec3(notes * 0.4 * boost);
    gl_FragColor = vec4(c, alpha);
  }
`;

/** A cap of a sphere of radius 1 round -z, `cone` radians either side: scale it to the song's front */
export function songMesh(cone: number, color: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  // SphereGeometry's theta starts at +y: rotate so the cap faces -z
  const geometry = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, cone);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, accent: { value: new THREE.Color(accent) }, time: fxTime, opacity: { value: 0 }, cone: { value: cone }, boost: FX_LIGHT.boost },
    vertexShader: shellVertex,
    fragmentShader: songFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.visible = false;
  return mesh;
}

const cushionFragment = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  uniform float opacity;
  uniform float squash; // 0..1: how hard the air is pressed together (ripples tighten)
  uniform float boost;
  varying vec3 vLocal;
  varying float vFacing;
  varying float vNear;
  void main() {
    vec3 d = normalize(vLocal);
    float off = acos(clamp(-d.z, -1.0, 1.0)) / 1.5708; // 0 at the nose … 1 at the rim
    float a = atan(d.y, d.x + 1e-5);
    // Air pressed together ahead: rings racing outwards, streaks spilling round the rim
    float rings = smoothstep(0.7, 1.0, sin(off * mix(10.0, 22.0, squash) - time * 16.0));
    float spill = smoothstep(0.86, 1.0, sin(a * 11.0 + off * 4.0)) * smoothstep(0.4, 1.0, off);
    float grazing = pow(clamp(1.0 - vFacing, 0.0, 1.0), 1.5);
    float alpha = clamp(rings * 0.3 + spill * 0.6 + grazing * 0.55, 0.0, 1.0) * smoothstep(1.0, 0.8, off) * opacity * vNear;
    vec3 c = mix(color, vec3(1.0), spill * 0.5 + grazing * 0.3) * (0.95 + 0.3 * boost);
    gl_FragColor = vec4(c, alpha);
  }
`;

/** A half sphere of air ahead of the pilot (round -z, radius 1), hollow towards it */
export function cushionMesh(color: THREE.ColorRepresentation): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: fxTime, opacity: { value: 0 }, squash: { value: 0 }, boost: FX_LIGHT.boost },
    vertexShader: shellVertex,
    fragmentShader: cushionFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  mesh.visible = false;
  return mesh;
}

// --- ribbons: the ley line along the course, the Echo-Trail ---------------------------------------

const ribbonVertex = /* glsl */ `
  attribute vec2 along; // x: 0 … 1 along the ribbon; y: -1 … 1 across
  attribute float fade; // 0..1 per point (age, distance)
  attribute float flash; // 0..1 per point (a closed circle lights up)
  varying vec2 vAlong;
  varying float vFade;
  varying float vFlash;
  varying float vNear;
  void main() {
    vAlong = along;
    vFade = fade;
    vFlash = flash;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNear = smoothstep(4.0, 14.0, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const ribbonFragment = /* glsl */ `
  uniform vec3 head;
  uniform vec3 tail;
  uniform vec3 flashColor;
  uniform float time;
  uniform float opacity;
  uniform float runes; // 1: runes of light flowing along (the ley line); 0: soft pulses (the echo)
  uniform float boost;
  varying vec2 vAlong;
  varying float vFade;
  varying float vFlash;
  varying float vNear;
  void main() {
    float t = clamp(vAlong.x, 0.0, 1.0);
    float across = clamp(1.0 - vAlong.y * vAlong.y, 0.0, 1.0);
    float core = pow(across, 4.0);
    float pulse = 0.75 + 0.25 * sin(t * 60.0 - time * 6.0);
    float rune = runes * smoothstep(0.82, 1.0, sin(t * 140.0 - time * 10.0)) * smoothstep(0.3, 0.9, across);
    vec3 c = mix(head, tail, t);
    c = mix(c, flashColor, clamp(vFlash, 0.0, 1.0));
    vec3 light = c * (across * 0.45 + core * 1.1) * pulse * (0.8 + 0.6 * boost) + c * rune * 1.6 * boost;
    float a = clamp(vFade, 0.0, 1.0) * opacity * vNear * (1.0 + vFlash * 1.5);
    gl_FragColor = vec4(light * a, 1.0);
  }
`;

/**
 * A glowing ribbon through up to `capacity` points, rebuilt from the CPU each
 * frame (additive: keep it thin): `set(i, point, side, width, fade, flash)`
 * for each point in order, then `commit(count)`
 */
export class Ribbon {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions: Float32Array;
  private readonly fades: Float32Array;
  private readonly flashes: Float32Array;
  private readonly capacity: number;

  constructor(capacity: number, head: THREE.ColorRepresentation, tail: THREE.ColorRepresentation, flash: THREE.ColorRepresentation, runes: boolean) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 2 * 3);
    this.fades = new Float32Array(capacity * 2);
    this.flashes = new Float32Array(capacity * 2);
    const along = new Float32Array(capacity * 2 * 2);
    for (let i = 0; i < capacity; i++) along.set([i / (capacity - 1), 1, i / (capacity - 1), -1], i * 4);
    const index: number[] = [];
    for (let i = 0; i < capacity - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("along", new THREE.BufferAttribute(along, 2));
    geometry.setAttribute("fade", new THREE.BufferAttribute(this.fades, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("flash", new THREE.BufferAttribute(this.flashes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        head: { value: new THREE.Color(head) },
        tail: { value: new THREE.Color(tail) },
        flashColor: { value: new THREE.Color(flash) },
        time: fxTime,
        opacity: { value: 1 },
        runes: { value: runes ? 1 : 0 },
        boost: FX_LIGHT.boost,
      },
      vertexShader: ribbonVertex,
      fragmentShader: ribbonFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  get size(): number {
    return this.capacity;
  }

  set(i: number, point: THREE.Vector3, side: THREE.Vector3, width: number, fade: number, flash: number) {
    const k = i * 6;
    this.positions[k] = point.x + side.x * width;
    this.positions[k + 1] = point.y + side.y * width;
    this.positions[k + 2] = point.z + side.z * width;
    this.positions[k + 3] = point.x - side.x * width;
    this.positions[k + 4] = point.y - side.y * width;
    this.positions[k + 5] = point.z - side.z * width;
    this.fades[i * 2] = this.fades[i * 2 + 1] = fade;
    this.flashes[i * 2] = this.flashes[i * 2 + 1] = flash;
  }

  /** Draws the first `count` points */
  commit(count: number) {
    const n = Math.min(count, this.capacity);
    this.mesh.visible = n > 1;
    this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    if (n < 2) return;
    const g = this.mesh.geometry;
    for (const [name, size] of [["position", 6], ["fade", 2], ["flash", 2]] as const) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * size);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// --- the ley line's pips (Ley-Line Surger) ------------------------------------------------------

/** A small faceted crystal of light (a gem, 1 m tall), toon-free: drawn with a basic material that blooms */
export function pipGeometry(): THREE.BufferGeometry {
  return new THREE.OctahedronGeometry(0.5, 0).scale(0.6, 1, 0.6);
}
