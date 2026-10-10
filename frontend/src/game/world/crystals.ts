import * as THREE from "three";
import { sceneryTime as fxTime } from "../particles";
import { makeRng, range } from "../rng";
import { RINGS } from "../tuning";
import type { Ring } from "./course";

// The gates: a cohort of floating crystals around every ring, each bobbing and
// turning on its own, with a faint halo and a portal veil. Passing a gate makes
// its crystals flare white, burst outward and dissolve, and sends a shockwave
// across the veil. All gates share three instanced draw calls; the motion runs
// in the vertex shader from a few numbers per gate.

export type RingMode = "race" | "free" | "hidden";

const GOLD = new THREE.Color("#ffd23f");

/** Per-gate state on the CPU; uploaded as one vec4 per gate */
interface GateState {
  visible: number; // 0..1, crystals grow in and out
  highlight: number; // 0..1, the next gate glows
  passedAt: number; // fxTime of the last pass, or -1e3
}

const crystalVertex = /* glsl */ `
  attribute float gate;
  attribute vec4 crystal; // angle, distance from the center, phase, tilt
  attribute vec3 size; // half-length, thickness, lean
  uniform vec4 gates[GATE_COUNT]; // visible, highlight, passedAt, finish
  uniform float time;
  uniform vec4 motion; // drift, drift rate, spin, self-spin
  uniform float passDuration;
  varying vec3 vViewPosition;
  varying float vHighlight;
  varying float vFlash;
  varying float vFinish;
  varying float vSeed;
  #include <fog_pars_vertex>

  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

  void main() {
    vec4 g = gates[int(gate + 0.5)];
    float since = time - g.z;
    float k = since >= 0.0 && since < passDuration ? since / passDuration : 0.0;
    float passing = since >= 0.0 && since < passDuration ? 1.0 : 0.0;

    float phase = crystal.z;
    float angle = crystal.x + time * motion.z + passing * k * k * 2.5;
    float bob = sin(time * motion.y * 6.2831 + phase) * motion.x;
    float burst = passing * pow(k, 0.6) * 10.0;
    float radius = crystal.y + bob * 0.4 + burst;
    float pulse = 1.0 + g.y * 0.12 * sin(time * 4.0 + phase);
    float scale = g.x * pulse * (1.0 - passing * smoothstep(0.45, 1.0, k)) * (1.0 + passing * 0.35 * sin(3.14159 * min(k * 2.5, 1.0)));

    vec3 p = position * vec3(size.y, size.x, size.y) * scale;
    p = rotY(time * motion.w * (0.6 + 0.8 * fract(phase)) + phase + passing * k * 14.0) * p;
    p = rotX(crystal.w) * p;
    p = rotZ(angle - 1.5708 + size.z) * p;
    p += vec3(cos(angle) * radius, sin(angle) * radius, bob + passing * k * 3.0);

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vViewPosition = mvPosition.xyz;
    vHighlight = g.y;
    vFlash = passing * (exp(-k * 5.0) * 1.4 + 0.25 * (1.0 - k));
    vFinish = g.w;
    vSeed = phase;
    #include <fog_vertex>
  }
`;

const crystalFragment = /* glsl */ `
  uniform vec3 ice;
  uniform vec3 accent;
  uniform vec3 gold;
  uniform vec3 sunDirection; // view space
  uniform float glow;
  uniform float time;
  varying vec3 vViewPosition;
  varying float vHighlight;
  varying float vFlash;
  varying float vFinish;
  varying float vSeed;
  #include <fog_pars_fragment>

  void main() {
    // Flat facets from screen-space derivatives
    vec3 n = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    vec3 v = normalize(-vViewPosition);
    float facing = abs(dot(n, v));
    float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), 2.2);
    float diffuse = abs(dot(n, sunDirection)) * 0.5 + 0.5;
    float spec = pow(max(dot(reflect(-sunDirection, n), v), 0.0), 28.0);
    float facet = fract(sin(dot(floor(n * 3.0 + vSeed), vec3(12.9898, 78.233, 37.719))) * 43758.5453);

    vec3 base = mix(mix(ice, accent, vHighlight), gold, vFinish);
    vec3 color = base * (0.35 + 0.45 * diffuse + 0.3 * facet);
    // Bright rims and a thin-film shimmer, like light through a gem
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (fresnel * 1.3 + vec3(0.0, 0.33, 0.67)) + time * 0.6 + vSeed);
    color += fresnel * mix(vec3(1.0), base, 0.35) * (0.9 + vHighlight * 1.4 * glow);
    color += film * fresnel * 0.35;
    color += spec * 1.8;
    color *= 1.0 + vHighlight * glow * (0.45 + 0.25 * sin(time * 3.0 + vSeed));
    color += vFlash * vec3(3.2, 3.0, 2.6);

    #ifdef USE_FOG
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth) * (1.0 - vHighlight);
      color = mix(color, fogColor, fogFactor);
    #endif
    gl_FragColor = vec4(color, 1.0);
  }
`;

// A thin ring of light, and a disc for the portal veil and the pass shockwave
const haloVertex = /* glsl */ `
  attribute float gate;
  uniform vec4 gates[GATE_COUNT];
  uniform float time;
  uniform float passDuration;
  varying vec2 vLocal;
  varying vec4 vGate;
  varying float vK;
  #include <fog_pars_vertex>
  void main() {
    vGate = gates[int(gate + 0.5)];
    float since = time - vGate.z;
    vK = since >= 0.0 && since < passDuration ? since / passDuration : -1.0;
    vLocal = position.xy;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const veilFragment = /* glsl */ `
  uniform vec3 ice;
  uniform vec3 accent;
  uniform vec3 gold;
  uniform float glow;
  uniform float time;
  varying vec2 vLocal;
  varying vec4 vGate;
  varying float vK;
  #include <fog_pars_fragment>
  void main() {
    float r = length(vLocal); // 1 = the gate's radius
    vec3 base = mix(mix(ice, accent, vGate.y), gold, vGate.w);
    float a = 0.0;
    if (r < 1.0) {
      // A faint membrane, brighter at the rim, with ripples flowing inwards
      float ripple = 0.5 + 0.5 * sin(r * 18.0 - time * 2.5);
      a = (smoothstep(0.7, 1.0, r) * 0.35 + ripple * 0.05 * r * r) * (0.04 + vGate.y * 0.22 * glow) * vGate.x;
      a += smoothstep(0.93, 1.0, r) * smoothstep(1.0, 0.985, r) * (0.3 + vGate.y * 1.2 * glow) * vGate.x;
    }
    if (vK >= 0.0) {
      // The pass: a flash filling the gate, then a shockwave racing outwards
      float wave = 1.0 + vK * 2.0;
      a += exp(-abs(r - wave) * 22.0) * (1.0 - vK) * 2.2;
      a += (r < 1.0 ? 1.0 : 0.0) * exp(-vK * 9.0) * 0.9;
    }
    if (a < 0.002) discard;
    vec3 color = mix(base, vec3(1.0), 0.35) * a;
    #ifdef USE_FOG
      color *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth) * (1.0 - vGate.y);
    #endif
    gl_FragColor = vec4(color, 1.0);
  }
`;

// A pillar of light rising from the next gate and the finish, visible from afar
const beamVertex = /* glsl */ `
  attribute float gate;
  uniform vec4 gates[GATE_COUNT];
  uniform float time;
  uniform float passDuration;
  varying float vHeight;
  varying float vFacing;
  varying float vAngle;
  varying vec4 vGate;
  varying float vK;
  varying float vDepth;
  void main() {
    vGate = gates[int(gate + 0.5)];
    float since = time - vGate.z;
    vK = since >= 0.0 && since < passDuration ? since / passDuration : -1.0;
    vHeight = position.y;
    vAngle = atan(position.z, position.x);
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vFacing = abs(dot(n, normalize(-mvPosition.xyz)));
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 ice;
  uniform vec3 accent;
  uniform vec3 gold;
  uniform float glow;
  uniform float time;
  varying float vHeight;
  varying float vFacing;
  varying float vAngle;
  varying vec4 vGate;
  varying float vK;
  varying float vDepth;
  void main() {
    // Strongest for the finish, then the next gate; a flare runs up it on a pass
    float strength = vGate.x * max(vGate.y * 0.55, vGate.w * 0.8);
    if (vK >= 0.0) strength += (1.0 - vK) * 1.5 * step(abs(vHeight - vK * 1.2), 0.25);
    if (strength < 0.002) discard;
    float streaks = 0.65 + 0.35 * sin(vHeight * 60.0 - time * 2.5 + vAngle * 3.0);
    // pow() of a negative number is NaN, and bloom would smear one NaN pixel over the whole screen
    float fade = pow(clamp(1.0 - vHeight, 0.0, 1.0), 2.2) * smoothstep(0.0, 0.03, vHeight);
    float soft = pow(clamp(vFacing, 0.0, 1.0), 1.5);
    // Close up it would fill the screen: fade it out near the camera
    float near = smoothstep(20.0, 120.0, vDepth);
    vec3 base = mix(accent, gold, vGate.w);
    vec3 color = mix(base, vec3(1.0), 0.3) * strength * streaks * fade * soft * near * glow * 0.9;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** A crystal: a six-sided spindle, long axis y, from -1 to 1 */
function crystalGeometry(): THREE.BufferGeometry {
  const profile = [
    [0, -1],
    [0.42, -0.5],
    [0.5, 0.15],
    [0.38, 0.55],
    [0, 1],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = new THREE.LatheGeometry(profile, 6).toNonIndexed();
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  return geometry;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuaternion = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class CrystalGates {
  readonly group = new THREE.Group();
  private readonly rings: Ring[];
  private readonly states: GateState[];
  private readonly gateUniform: THREE.Vector4[];
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly sunView = new THREE.Vector3();
  private readonly sunDirection: THREE.Vector3;
  /** Per gate: the crystals' angle and distance from the center, for particle bursts */
  private readonly layout: { angle: number; radius: number }[][] = [];
  private mode: RingMode = "free";
  private next = 0;
  private readonly crystals: THREE.InstancedMesh;
  private readonly veils: THREE.InstancedMesh;
  /** Per gate: its first crystal's instance */
  private readonly firstCrystal: number[] = [];
  /** Per gate: the direction it faces now (Resonance can turn it; looks only, the run keeps its own) */
  private readonly facing: THREE.Vector3[];

  constructor(seed: number, rings: Ring[], colors: { ice: THREE.Color; accent: THREE.Color }, sunDirection: THREE.Vector3) {
    this.rings = rings;
    this.sunDirection = sunDirection;
    this.states = rings.map(() => ({ visible: 1, highlight: 0, passedAt: -1e3 }));
    this.facing = rings.map((r) => r.normal.clone());
    this.gateUniform = rings.map((r) => new THREE.Vector4(1, 0, -1e3, r.finish ? 1 : 0));
    const defines = { GATE_COUNT: Math.max(1, rings.length) };
    const shared = {
      gates: { value: this.gateUniform },
      time: fxTime,
      passDuration: { value: RINGS.passTime },
      ice: { value: colors.ice },
      accent: { value: colors.accent },
      gold: { value: GOLD },
      glow: { value: RINGS.glow },
    };

    // Crystals: per gate, a main circle of big ones and a scatter of small satellites
    const rng = makeRng(seed, "crystals");
    const gateIndex: number[] = [];
    const crystal: number[] = [];
    const size: number[] = [];
    rings.forEach((ring, g) => {
      const layout: { angle: number; radius: number }[] = [];
      const main = Math.round(RINGS.crystals * (ring.finish ? 1.5 : 1));
      const satellites = Math.round(main * 0.7);
      for (let i = 0; i < main + satellites; i++) {
        const big = i < main;
        const angle = big ? (i / main) * Math.PI * 2 + range(rng, -0.08, 0.08) : range(rng, 0, Math.PI * 2);
        // Sized for a 13 m ring; smaller gates get smaller crystals so the crown stays clear of the rock
        const k = Math.min(1, ring.radius / 13);
        const halfLength = (big ? range(rng, 1.3, 2.1) * (ring.finish ? 1.25 : 1) : range(rng, 0.35, 0.7)) * k;
        const radius = big ? ring.radius + 0.5 * k + halfLength : ring.radius + range(rng, 1.5, 5.5) * k;
        gateIndex.push(g);
        crystal.push(angle, radius, range(rng, 0, Math.PI * 2), range(rng, -0.4, 0.4));
        size.push(halfLength, (big ? range(rng, 1.1, 1.6) : range(rng, 0.6, 0.9)) * k, big ? 0.5 + range(rng, -0.2, 0.2) : range(rng, -1, 1));
        layout.push({ angle, radius });
      }
      this.layout.push(layout);
    });
    const count = gateIndex.length;
    const geometry = this.geometry(crystalGeometry());
    geometry.setAttribute("gate", new THREE.InstancedBufferAttribute(new Float32Array(gateIndex), 1));
    geometry.setAttribute("crystal", new THREE.InstancedBufferAttribute(new Float32Array(crystal), 4));
    geometry.setAttribute("size", new THREE.InstancedBufferAttribute(new Float32Array(size), 3));
    const crystalMaterial = this.material(
      new THREE.ShaderMaterial({
        defines,
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          ...shared,
          motion: { value: new THREE.Vector4() },
          sunDirection: { value: this.sunView },
        },
        vertexShader: crystalVertex,
        fragmentShader: crystalFragment,
        fog: true,
      }),
    );
    const crystals = new THREE.InstancedMesh(geometry, crystalMaterial, Math.max(1, count));
    crystals.count = count;
    let k = 0;
    rings.forEach((ring, g) => {
      const placement = this.placement(ring, 1);
      this.firstCrystal.push(k);
      for (let i = 0; i < this.layout[g].length; i++) crystals.setMatrixAt(k++, placement);
    });
    crystals.frustumCulled = false;

    // Halo and veil: one disc per gate, three times the radius so the shockwave fits
    const disc = this.geometry(new THREE.CircleGeometry(3, 96));
    disc.setAttribute("gate", new THREE.InstancedBufferAttribute(new Float32Array(rings.map((_, i) => i)), 1));
    const veilMaterial = this.material(
      new THREE.ShaderMaterial({
        defines,
        uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared },
        vertexShader: haloVertex,
        fragmentShader: veilFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: true,
      }),
    );
    const veils = new THREE.InstancedMesh(disc, veilMaterial, Math.max(1, rings.length));
    veils.count = rings.length;
    rings.forEach((ring, i) => veils.setMatrixAt(i, this.placement(ring, ring.radius)));
    veils.frustumCulled = false;
    veils.renderOrder = 3;

    // Light pillars: an open cylinder per gate, 700 m tall
    const tube = this.geometry(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true));
    tube.translate(0, 0.5, 0);
    tube.setAttribute("gate", new THREE.InstancedBufferAttribute(new Float32Array(rings.map((_, i) => i)), 1));
    const beamMaterial = this.material(
      new THREE.ShaderMaterial({
        defines,
        uniforms: { ...shared },
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const beams = new THREE.InstancedMesh(tube, beamMaterial, Math.max(1, rings.length));
    beams.count = rings.length;
    rings.forEach((ring, i) => {
      tmpMatrix.compose(
        tmpScale.copy(ring.position).setY(ring.position.y - ring.radius),
        tmpQuaternion.identity(),
        new THREE.Vector3(ring.radius * 0.35, 700, ring.radius * 0.35),
      );
      beams.setMatrixAt(i, tmpMatrix);
    });
    beams.frustumCulled = false;
    beams.renderOrder = 2;

    this.group.add(crystals, veils, beams);
    this.crystals = crystals;
    this.veils = veils;
  }

  /** Turns gate `index` (its crystals and veil) to face along `normal` (Resonance; looks only) */
  orient(index: number, normal: THREE.Vector3) {
    const ring = this.rings[index];
    if (!ring) return;
    this.facing[index].copy(normal).normalize();
    tmpQuaternion.setFromUnitVectors(Z, this.facing[index]);
    const placement = tmpMatrix.compose(ring.position, tmpQuaternion, tmpScale.setScalar(1));
    const first = this.firstCrystal[index];
    const count = this.layout[index].length;
    for (let i = 0; i < count; i++) this.crystals.setMatrixAt(first + i, placement);
    this.crystals.instanceMatrix.addUpdateRange(first * 16, count * 16);
    this.crystals.instanceMatrix.needsUpdate = true;
    this.veils.setMatrixAt(index, tmpMatrix.compose(ring.position, tmpQuaternion, tmpScale.setScalar(ring.radius)));
    this.veils.instanceMatrix.addUpdateRange(index * 16, 16);
    this.veils.instanceMatrix.needsUpdate = true;
  }

  private material(material: THREE.ShaderMaterial) {
    this.materials.push(material);
    return material;
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private placement(ring: Ring, scale: number): THREE.Matrix4 {
    tmpQuaternion.setFromUnitVectors(Z, this.facing[ring.index] ?? ring.normal);
    return tmpMatrix.compose(ring.position, tmpQuaternion, tmpScale.setScalar(scale));
  }

  /** "race": the next gate glows, passed ones are gone. "free": all shown quietly. */
  setMode(mode: RingMode, next: number) {
    const restart = mode !== this.mode || next < this.next;
    this.mode = mode;
    this.next = next;
    if (restart) {
      for (const state of this.states) {
        state.passedAt = -1e3;
        if (mode !== "hidden") state.visible = 0; // grow back in
      }
    }
  }

  /** Plays the pass animation on a gate */
  pass(index: number) {
    const state = this.states[index];
    if (state) state.passedAt = fxTime.value;
  }

  /** Are a gate's crystals (mostly) showing? */
  shown(index: number): boolean {
    return (this.states[index]?.visible ?? 0) > 0.5;
  }

  /** Is a gate in the middle of its pass animation? */
  passing(index: number): boolean {
    const since = fxTime.value - (this.states[index]?.passedAt ?? -1e3);
    return since >= 0 && since < RINGS.passTime;
  }

  /** World positions of a gate's crystals (roughly: without their bobbing), for particle bursts */
  crystalPositions(index: number, out: THREE.Vector3[]): THREE.Vector3[] {
    const ring = this.rings[index];
    const spin = fxTime.value * RINGS.spin;
    tmpQuaternion.setFromUnitVectors(Z, this.facing[index]);
    const layout = this.layout[index] ?? [];
    // Reuses the vectors already in `out`
    while (out.length < layout.length) out.push(new THREE.Vector3());
    out.length = layout.length;
    layout.forEach(({ angle, radius }, i) => {
      out[i]
        .set(Math.cos(angle + spin) * radius, Math.sin(angle + spin) * radius, 0)
        .applyQuaternion(tmpQuaternion)
        .add(ring.position);
    });
    return out;
  }

  update(dt: number, camera: THREE.Camera) {
    const k = 1 - Math.exp(-dt * 3);
    const now = fxTime.value;
    for (let i = 0; i < this.rings.length; i++) {
      const state = this.states[i];
      const passing = now - state.passedAt < RINGS.passTime && now >= state.passedAt;
      const wanted = this.mode === "hidden" ? 0 : this.mode === "free" || i >= this.next ? 1 : 0;
      if (passing) {
        state.visible = 1;
      } else if (state.passedAt > -1e3) {
        // The pass animation dissolved the crystals: in free flight they grow back from nothing
        state.passedAt = -1e3;
        state.visible = 0;
      } else {
        state.visible += (wanted - state.visible) * k;
      }
      const highlight = this.mode === "race" && i === this.next ? 1 : 0;
      state.highlight += (highlight - state.highlight) * k * 2;
      this.gateUniform[i].set(state.visible, state.highlight, state.passedAt, this.rings[i].finish ? 1 : 0);
    }
    const material = this.materials[0];
    material.uniforms.motion.value.set(RINGS.drift, RINGS.driftRate, RINGS.spin, RINGS.selfSpin);
    for (const m of this.materials) {
      m.uniforms.passDuration.value = RINGS.passTime;
      m.uniforms.glow.value = RINGS.glow;
    }
    this.sunView.copy(this.sunDirection).transformDirection(camera.matrixWorldInverse);
  }

  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
