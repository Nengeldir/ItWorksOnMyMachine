import * as THREE from "three";
import { Builder, cyl, leaf, sphere, star } from "../items/models";
import { FX_LIGHT, fxTime } from "../particles";
import { outlineMaterial, toonMaterial } from "../toon";

// Models for the run's abilities (run/abilities.ts has their rules), in the
// pilot's style: toon-shaded primitives painted per vertex with ink outlines
// for solid things (down feathers, the spirit manta), and soft additive
// shaders for light and wind (rings, blades of wind, the Gale Force tunnel,
// the hover sigil). Glowing parts write colors above 1 so they bloom, scaled
// by FX_LIGHT.boost like every other effect. All shaders clamp before pow()
// and never divide by something that can reach zero (one NaN blackens bloom).

const GOLD = "#f3c869";

// --- down feathers (Featherfalling) ---------------------------------------------------

/** A downy white feather along +y (0.62 m), a gold quill, a tip that glows */
export function downFeather(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(leaf(0.62, 0.15, 0.014), (p, out) => out.set("#ffffff").lerp(new THREE.Color("#fff1c9"), Math.max(0, p.y / 0.62 - 0.4)), 0.35);
  b.add(leaf(0.2, 0.08, 0.016), "#ffe9a8", 1, [0, 0.42, 0.004]);
  b.add(cyl(0.008, 0.012, 0.66, 6), GOLD, 0.6, [0, 0.3, 0.01]);
  return b.build();
}

// --- the spirit manta (Slipstream Rider) ------------------------------------------------

const MANTA_TOP = new THREE.Color("#22406f");
const MANTA_EDGE = new THREE.Color("#2f8f9a");
const MANTA_BELLY = new THREE.Color("#e2f2ff");

/** One wing's shape (x out, y forward), mirrored for the left */
function wingShape(points: [number, number][], side: 1 | -1): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0] * side, points[0][1]);
  for (let i = 1; i < points.length; i += 2) shape.quadraticCurveTo(points[i][0] * side, points[i][1], points[i + 1][0] * side, points[i + 1][1]);
  return shape;
}

/** A wing panel lying flat (y up), thinning towards `span`, with x out to the side and -z forward */
function wingPanel(points: [number, number][], side: 1 | -1, span: number, thickness: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(wingShape(points, side), { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.4, bevelSize: 0.06, bevelSegments: 2, curveSegments: 10 });
  geometry.translate(0, 0, -thickness / 2).rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const out = Math.min(1, Math.abs(position.getX(i)) / span);
    position.setY(i, position.getY(i) * (1 - out * 0.65));
  }
  geometry.computeVertexNormals();
  return geometry;
}

const paintWing = (span: number, from: number) => (p: THREE.Vector3, out: THREE.Color) => {
  if (p.y < -0.01) out.copy(MANTA_BELLY);
  else out.copy(MANTA_TOP).lerp(MANTA_EDGE, Math.min(1, (from + Math.abs(p.x)) / span));
};

export interface MantaModel {
  group: THREE.Group;
  /** Rotate about z to flap: inner panels (left, right) and the outer panels hung off them */
  wings: [THREE.Object3D, THREE.Object3D];
  tips: [THREE.Object3D, THREE.Object3D];
  /** Wingtip markers, for the ribbons */
  ends: [THREE.Object3D, THREE.Object3D];
  tail: THREE.Object3D[];
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

/**
 * A spirit manta like the ones of Sky's Isle of Dawn, in Genshin's colors:
 * a deep blue back fading to teal at the wingtips, a pale belly, gold along
 * the leading edges, rows of glowing spots and a whip of a tail with a star at
 * its end. About 7.5 m across, facing -z
 */
export function buildManta(): MantaModel {
  const materials: THREE.Material[] = [toonMaterial({ rim: 0.6, rimColor: "#bff8ff" }), outlineMaterial(0.04)];
  const [skin, ink] = materials;
  const geometries: THREE.BufferGeometry[] = [];
  const mesh = (geometry: THREE.BufferGeometry, parent: THREE.Object3D) => {
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, skin);
    m.add(new THREE.Mesh(geometry, ink));
    parent.add(m);
    return m;
  };
  const group = new THREE.Group();
  const rig = new THREE.Group();
  rig.scale.setScalar(0.85);
  group.add(rig);

  // Body: a broad, flattened teardrop with two curled head fins, eyes and a glowing crown
  const body = new Builder()
    .add(sphere(1, 24, 16), (p, out) => (p.y < -0.05 ? out.copy(MANTA_BELLY) : out.copy(MANTA_TOP).lerp(MANTA_EDGE, Math.max(0, p.z) * 0.6)), 0, [0, 0, 0.1], [0, 0, 0], [1.05, 0.42, 1.9])
    .add(sphere(0.5, 16, 10), (p, out) => (p.y < -0.05 ? out.copy(MANTA_BELLY) : out.copy(MANTA_TOP)), 0, [0, 0.05, -1.45], [0, 0, 0], [1.3, 0.55, 1]);
  for (const s of [1, -1]) {
    body.add(leaf(0.75, 0.2, 0.06), (p, out) => out.copy(MANTA_TOP).lerp(MANTA_EDGE, p.y / 0.75), 0.15, [0.42 * s, -0.05, -1.75], [-Math.PI / 2 + 0.35, 0, 0.35 * s]);
    body.add(sphere(0.07, 8, 6), "#141428", 0, [0.55 * s, 0.08, -1.5]);
    body.add(sphere(0.025, 6, 4), "#ffffff", 1, [0.58 * s, 0.11, -1.53]);
  }
  for (let i = 0; i < 4; i++) body.add(sphere(0.09 - i * 0.012, 8, 6), "#aef6ff", 1, [0, 0.36 - i * 0.02, -0.7 + i * 0.45], [0, 0, 0], [1, 0.35, 1]);
  body.add(star(0.13, 0.055, 0.04), GOLD, 1, [0, 0.42, -1.05], [-Math.PI / 2, 0, 0]);
  mesh(body.build(), rig);

  const wings: THREE.Object3D[] = [];
  const tips: THREE.Object3D[] = [];
  const ends: THREE.Object3D[] = [];
  for (const side of [-1, 1] as const) {
    const root = new THREE.Group();
    root.position.set(0.75 * side, 0, 0.05);
    rig.add(root);
    // The inner panel, rows of glowing spots, gold along the leading edge
    const inner = new Builder().add(wingPanel([[0, 1.25], [1.2, 1.15], [2.15, 0.55], [2.25, -0.1], [2.15, -0.5], [1.0, -0.8], [0, -1.15]], side, 4.4, 0.16), paintWing(4.4, 0), 0);
    // Two rows of glowing spots, like the markings of Sky's mantas
    for (let i = 0; i < 4; i++) {
      inner.add(sphere(0.17 - i * 0.02, 10, 6), "#aef6ff", 1.4, [(0.45 + i * 0.45) * side, 0.08 - i * 0.012, 0.3 - i * 0.14], [0, 0, 0], [1, 0.3, 1]);
      inner.add(sphere(0.11 - i * 0.015, 8, 6), "#d9fbff", 1.4, [(0.6 + i * 0.42) * side, 0.08 - i * 0.012, -0.35 - i * 0.05], [0, 0, 0], [1, 0.3, 1]);
    }
    inner.add(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.03, -1.22), new THREE.Vector3(1.25 * side, 0.03, -1.15), new THREE.Vector3(2.15 * side, 0.02, -0.55)), 16, 0.045, 5), GOLD, 0.5);
    mesh(inner.build(), root);
    const hinge = new THREE.Group();
    hinge.position.set(2.15 * side, 0, 0);
    root.add(hinge);
    // The outer panel sweeps back to a fine tip, a spot at its middle
    const outer = new Builder().add(wingPanel([[0, 0.55], [1.1, 0.3], [2.35, -0.55], [1.0, -0.55], [0, -0.5]], side, 2.4, 0.1), paintWing(4.4, 2.1), 0);
    outer.add(sphere(0.12, 8, 6), "#aef6ff", 1.4, [0.7 * side, 0.05, -0.05], [0, 0, 0], [1, 0.3, 1]);
    outer.add(sphere(0.08, 8, 6), "#d9fbff", 1.4, [1.3 * side, 0.03, 0.05], [0, 0, 0], [1, 0.3, 1]);
    outer.add(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.02, -0.55), new THREE.Vector3(1.1 * side, 0.02, -0.32), new THREE.Vector3(2.3 * side, 0.01, 0.52)), 14, 0.035, 5), GOLD, 0.5);
    mesh(outer.build(), hinge);
    const end = new THREE.Object3D();
    end.position.set(2.3 * side, 0, 0.5);
    hinge.add(end);
    wings.push(root);
    tips.push(hinge);
    ends.push(end);
  }

  // The tail: three tapering segments, a glowing star at the end
  const tail: THREE.Object3D[] = [];
  let parent: THREE.Object3D = rig;
  for (let i = 0; i < 3; i++) {
    const joint = new THREE.Group();
    joint.position.set(0, 0, i === 0 ? 1.85 : 1.3);
    parent.add(joint);
    const r = 0.11 - i * 0.03;
    const segment = new Builder().add(cyl(r * 0.7, r, 1.3, 8), (_p, out) => out.copy(MANTA_TOP).lerp(MANTA_EDGE, 0.3 + i * 0.25), 0, [0, 0, 0.65], [Math.PI / 2, 0, 0]);
    if (i === 2) segment.add(star(0.16, 0.07, 0.05), "#bff8ff", 1.2, [0, 0, 1.35], [0, 0, 0]);
    mesh(segment.build(), joint);
    tail.push(joint);
    parent = joint;
  }
  return { group, wings: wings as [THREE.Object3D, THREE.Object3D], tips: tips as [THREE.Object3D, THREE.Object3D], ends: ends as [THREE.Object3D, THREE.Object3D], tail, materials, geometries };
}

// --- rings of light: gate markers, wind halos, shockwaves ----------------------------------

const ringVertex = /* glsl */ `
  attribute vec3 center;
  attribute vec3 axis; // the ring's normal; zero: it faces the camera
  attribute vec4 ring; // radius (m), opacity, band width, style
  attribute vec3 tint;
  attribute float seed;
  varying vec2 vUv;
  varying vec3 vTint;
  varying vec4 vRing;
  varying float vSeed;
  void main() {
    vUv = position.xy;
    vTint = tint;
    vRing = ring;
    vSeed = seed;
    vec3 right;
    vec3 up;
    if (dot(axis, axis) < 0.01) {
      right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    } else {
      vec3 n = normalize(axis);
      right = normalize(abs(n.y) < 0.95 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
      up = cross(right, n);
    }
    vec3 world = center + (right * position.x + up * position.y) * ring.x;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform float time;
  uniform float boost;
  varying vec2 vUv;
  varying vec3 vTint;
  varying vec4 vRing;
  varying float vSeed;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float a = atan(vUv.y, vUv.x + 1e-5);
    float width = max(vRing.z, 0.005);
    float d = (r - 0.86) / width;
    float band = exp(-d * d);
    float light;
    if (vRing.w < 0.5) {
      // A marker seen from afar: a ring of ticks turning slowly, breathing, a faint glow inside
      float ticks = 0.55 + 0.45 * smoothstep(0.3, 1.0, sin(a * 12.0 + time * 1.2 + vSeed * 6.0));
      light = band * ticks * (0.8 + 0.2 * sin(time * 3.0 + vSeed * 6.2832)) * 1.6 + exp(-r * r * 3.0) * 0.08;
    } else if (vRing.w < 1.5) {
      // A shockwave: a hard bright edge, light streaming in behind it
      float streaks = 0.7 + 0.3 * sin(a * 23.0 + vSeed * 9.0);
      light = band * 1.4 + smoothstep(0.86, 0.3, r) * smoothstep(0.0, 0.7, r) * 0.12 * streaks;
    } else {
      // A ring of wind: streaks chasing round it
      float swirl = smoothstep(0.2, 1.0, sin(a * 5.0 - time * 7.0 + r * 9.0 + vSeed * 4.0));
      light = band * (0.45 + 0.9 * swirl) * 1.5;
    }
    float edge = smoothstep(1.0, 0.94, r);
    gl_FragColor = vec4(vTint * light * vRing.y * edge * boost, 1.0);
  }
`;

/**
 * Up to `capacity` rings of light in one draw call: each faces the camera or
 * lies across an axis, in one of three styles (0 a marker of ticks, 1 a
 * shockwave, 2 a ring of wind). `depthTest` false shows them through rock
 */
export class RingQuads {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly axis: THREE.InstancedBufferAttribute;
  private readonly ring: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private count = 0;

  constructor(capacity: number, depthTest: boolean) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const attribute = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
    this.center = attribute(3);
    this.axis = attribute(3);
    this.ring = attribute(4);
    this.tint = attribute(3);
    const seeds = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) seeds[i] = Math.random();
    geometry.setAttribute("center", this.center);
    geometry.setAttribute("axis", this.axis);
    geometry.setAttribute("ring", this.ring);
    geometry.setAttribute("tint", this.tint);
    geometry.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 1));
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      uniforms: { time: fxTime, boost: FX_LIGHT.boost },
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = depthTest ? 6 : 20;
  }

  /** Start a new batch of rings this frame */
  begin() {
    this.count = 0;
  }

  /** A ring at `center`; `axis` null faces the camera. `style` 0 marker, 1 shockwave, 2 wind */
  add(center: THREE.Vector3, axis: THREE.Vector3 | null, radius: number, opacity: number, width: number, style: number, tint: THREE.Color) {
    const i = this.count;
    if (i >= this.center.count || opacity <= 0.002) return;
    this.count++;
    this.center.setXYZ(i, center.x, center.y, center.z);
    if (axis) this.axis.setXYZ(i, axis.x, axis.y, axis.z);
    else this.axis.setXYZ(i, 0, 0, 0);
    this.ring.setXYZW(i, radius, opacity, width, style);
    this.tint.setXYZ(i, tint.r, tint.g, tint.b);
  }

  end() {
    const geometry = this.mesh.geometry;
    geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    for (const a of [this.center, this.axis, this.ring, this.tint]) {
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

// --- blades of wind (Wind-Shear Dash, Gale Force) ----------------------------------------

const bladeVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vNear;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNear = smoothstep(0.8, 4.0, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const bladeFragment = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  uniform float boost;
  varying vec2 vUv;
  varying float vNear;
  void main() {
    // Along the arc (u: 0 tail … 1 head): a sharp head and a tapering tail; across (v) soft
    float along = clamp(vUv.x, 0.0, 1.0);
    float head = smoothstep(1.0, 0.86, along) * pow(along, 1.6);
    float across = clamp(1.0 - abs(vUv.y * 2.0 - 1.0), 0.0, 1.0);
    float thin = mix(0.25, 1.0, along);
    float core = smoothstep(1.0 - thin, 1.0, across);
    // Painted on (normal blending), so a blade of wind reads against a bright sky instead of glaring
    vec3 c = mix(color, vec3(1.0), core * 0.7) * (0.9 + 0.2 * boost);
    gl_FragColor = vec4(c, clamp((core * 0.85 + across * 0.2) * head * opacity * vNear, 0.0, 1.0));
  }
`;

/** A crescent of wind, the arc in the xy plane around the origin (radius 1, about 130°), its head at +y */
export function bladeGeometry(): THREE.BufferGeometry {
  const segments = 32;
  const arc = 2.3;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const a = Math.PI / 2 - arc + u * arc;
    // Thickest a little behind the head
    const w = 0.06 + 0.16 * Math.sin(Math.PI * Math.min(1, u * 1.15));
    for (const [k, r] of [[0, 1 - w], [1, 1 + w * 0.4]] as const) {
      positions.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      uvs.push(u, k);
    }
    if (i < segments) {
      const b = i * 2;
      index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

export function bladeMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 }, boost: FX_LIGHT.boost },
    vertexShader: bladeVertex,
    fragmentShader: bladeFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

// --- the Gale Force tunnel ----------------------------------------------------------------

const tunnelVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vNear;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNear = smoothstep(2.0, 12.0, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const tunnelFragment = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  uniform float reach; // 0..1 of the length the wind has rushed out to
  uniform float opacity;
  uniform float length;
  uniform float boost;
  varying vec2 vUv;
  varying float vNear;
  void main() {
    float a = vUv.x * 6.2832;
    float z = vUv.y * length; // metres from the mouth
    if (vUv.y > reach) discard;
    // Thin streaks spiralling along the walls, rushing away from you; the walls themselves are clear
    float s1 = smoothstep(0.93, 1.0, sin(a * 7.0 + z * 0.05 - time * 9.0));
    float s2 = smoothstep(0.97, 1.0, sin(a * 13.0 - z * 0.08 - time * 13.0 + 1.7));
    // Rings of wind every 32 m, running ahead
    float k = fract(z / 32.0 - time * 1.6);
    float rings = exp(-k * k * 900.0) + exp(-(1.0 - k) * (1.0 - k) * 900.0);
    float ends = smoothstep(0.0, 0.04, vUv.y) * smoothstep(reach, reach - 0.08, vUv.y);
    // Painted on (normal blending): over a bright sky it reads as wind, not a whiteout
    float alpha = clamp(s1 * 0.55 + s2 * 0.45 + rings * 0.6, 0.0, 1.0) * ends * opacity * vNear;
    vec3 c = mix(color, vec3(1.0), s2 * 0.5 + rings * 0.3) * (0.85 + 0.25 * boost);
    gl_FragColor = vec4(c, alpha);
  }
`;

/** An open tube along -z from the origin, 1 m wide and 1 m long: scale it to the tunnel */
export function tunnelMesh(color: THREE.ColorRepresentation): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 48, 24, true);
  // Along -z, from 0 at the mouth; uv.y runs from the mouth (0) to the far end (1)
  geometry.rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  const uv = geometry.getAttribute("uv");
  const position = geometry.getAttribute("position");
  for (let i = 0; i < uv.count; i++) uv.setY(i, -position.getZ(i));
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: fxTime, reach: { value: 0 }, opacity: { value: 0 }, length: { value: 1 }, boost: FX_LIGHT.boost },
    vertexShader: tunnelVertex,
    fragmentShader: tunnelFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

// --- the hover sigil (Hover-Stall) ----------------------------------------------------------

const sigilVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const sigilFragment = /* glsl */ `
  uniform vec3 color;
  uniform vec3 accent;
  uniform float time;
  uniform float opacity;
  uniform float progress; // the timer: the outer ring's arc left, 1 … 0
  uniform float boost;
  varying vec2 vUv;
  float line(float x, float at, float w) { float d = (x - at) / w; return exp(-d * d); }
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float a = atan(vUv.y, vUv.x + 1e-5);
    // Two rings, the outer one an arc that runs down with the time left
    float turn = fract((a / 6.2832) + 0.25);
    float timer = line(r, 0.93, 0.018) * (turn < progress ? 1.0 : 0.18);
    float rings = timer + line(r, 0.84, 0.01) * 0.7 + line(r, 0.4, 0.012) * 0.8;
    // Eight feather-shaped petals turning slowly between the rings
    float spin = a + time * 0.6;
    float petal = abs(sin(spin * 4.0));
    // Outlines only: a filled disc over a bright sky would glare
    float petals = line(abs(r - 0.62) - 0.2 * pow(clamp(petal, 0.0, 1.0), 3.0), 0.0, 0.012) * (0.35 + 0.65 * petal) * 0.8;
    // Runes: dashes on a circle turning the other way
    float rune = step(0.55, fract((a - time * 0.9) * 24.0 / 6.2832)) * line(r, 0.76, 0.012);
    float heart = exp(-r * r * 22.0) * 0.25;
    // Painted on, not added: it reads on a bright day sky without glaring; only the runes glow
    float alpha = clamp(rings + petals + heart + rune, 0.0, 1.0) * opacity * smoothstep(1.0, 0.97, r);
    vec3 c = mix(color, accent * (1.0 + 0.6 * boost), clamp(rune * 1.5, 0.0, 1.0));
    gl_FragColor = vec4(c, alpha);
  }
`;

/** The circle of wind the pilot stands on while hovering: lies flat, 1 m radius */
export function sigilMesh(color: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial> {
  // Flat in the xz plane; the shader draws on the circle's own uv
  const geometry = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, accent: { value: new THREE.Color(accent) }, time: fxTime, opacity: { value: 0 }, progress: { value: 1 }, boost: FX_LIGHT.boost },
    vertexShader: sigilVertex,
    fragmentShader: sigilFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 6;
  return mesh;
}

/** Three chevrons pointing along -z (where a hover-stall will launch you), in one flat shape */
export function chevronGeometry(): THREE.BufferGeometry {
  const shapes: THREE.Shape[] = [];
  for (let i = 0; i < 3; i++) {
    const z = -i * 0.9;
    const s = new THREE.Shape();
    s.moveTo(-0.55, z + 0.25);
    s.lineTo(0, z - 0.3);
    s.lineTo(0.55, z + 0.25);
    s.lineTo(0.55, z + 0.47);
    s.lineTo(0, z - 0.08);
    s.lineTo(-0.55, z + 0.47);
    shapes.push(s);
  }
  // Drawn in the xy plane with y standing for z, then laid flat (y → z)
  return new THREE.ShapeGeometry(shapes).rotateX(Math.PI / 2);
}

// --- the recovery spiral (Acrobatic Recovery) ---------------------------------------------

const helixVertex = /* glsl */ `
  attribute float along;
  varying float vAlong;
  varying float vAcross;
  void main() {
    vAlong = along;
    vAcross = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const helixFragment = /* glsl */ `
  uniform vec3 color;
  uniform float head; // 0..1 along the spiral
  uniform float opacity;
  uniform float boost;
  varying float vAlong;
  varying float vAcross;
  void main() {
    float behind = head - vAlong;
    if (behind < 0.0) discard;
    float trail = exp(-behind * 5.0);
    float across = clamp(1.0 - abs(vAcross * 2.0 - 1.0), 0.0, 1.0);
    vec3 c = mix(color, vec3(1.0), smoothstep(0.6, 1.0, across) * 0.7) * (across * 0.6 + smoothstep(0.7, 1.0, across) * 1.4);
    gl_FragColor = vec4(c * trail * opacity * boost, 1.0);
  }
`;

/** A ribbon spiralling one and a half turns round the z axis (radius 1.3 m, 3 m long) */
export function helixMesh(color: THREE.ColorRepresentation): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const segments = 72;
  const positions: number[] = [];
  const uvs: number[] = [];
  const along: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = t * Math.PI * 3;
    const z = 1.5 - t * 3;
    for (const k of [0, 1]) {
      const r = 1.3 + (k - 0.5) * 0.35;
      positions.push(Math.cos(a) * r, Math.sin(a) * r, z);
      uvs.push(t, k);
      along.push(t);
    }
    if (i < segments) index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
  geometry.setIndex(index);
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, head: { value: 0 }, opacity: { value: 0 }, boost: FX_LIGHT.boost },
    vertexShader: helixVertex,
    fragmentShader: helixFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return mesh;
}
