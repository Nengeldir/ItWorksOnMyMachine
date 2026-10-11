import * as THREE from "three";
import type { Flight } from "../flight";
import { FX_LIGHT, Kind, type Particles, fx, fxTime } from "../particles";
import { segmentDistanceSq } from "./segments";
import type { World } from "../world/World";

// Stamina orbs (adventure only). In a run the boost reserve doesn't refill by
// itself: it comes back from these floating orbs of warm light along the
// racing line, and from abilities and items that refill it. Each level holds
// fewer orbs, and each restores less, the deeper the run goes. Rules and looks
// together: the rules are a list of points, the looks one instanced draw call.

/** Orb rules and size. In ?tune as "Stamina orbs", not saved (like ITEM): they change the game */
export const ORB = {
  restore: 0.42, // boost reserve one orb gives back on level 1…
  falloff: 0.04, // …this much less per level after…
  least: 0.14, // …but never less than this
  radius: 3.6, // metres: flown through within this, it's collected (swept)
  spacing: 72, // metres of course between orbs on level 1…
  spacingPerLevel: 8, // …this much more per level after
  hoopGap: 12, // metres along the course kept clear around each hoop
  size: 1.1, // metres: the orb's radius as drawn
};

/** Boost reserve one orb restores on run level `level` (1-based) */
export const orbRestore = (level: number): number => Math.max(ORB.least, ORB.restore - ORB.falloff * (level - 1));

export interface Orb {
  position: THREE.Vector3;
  phase: number;
  collected: boolean;
}

/** Orbs along the line between the hoops of a level, seeded by the level (the same for everyone) */
export function placeOrbs(world: World, level: number): Orb[] {
  const course = world.course;
  const orbs: Orb[] = [];
  const spacing = ORB.spacing + ORB.spacingPerLevel * (level - 1);
  const side = new THREE.Vector3(), lift = new THREE.Vector3(), tangent = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let i = 0;
  for (let z = course.start.z + 70; z < course.endZ - 50; z += spacing, i++) {
    if (course.rings.some((ring) => Math.abs(ring.position.z - z) < ORB.hoopGap)) continue;
    course.tangentAt(z, tangent);
    side.crossVectors(tangent, UP).normalize();
    lift.crossVectors(side, tangent).normalize();
    // A gentle weave across the line, inside the tube carved clear of rock
    const sway = Math.sin(i * 1.7 + world.seed * 0.37) * 4.5;
    const rise = Math.cos(i * 2.3 + world.seed * 0.11) * 1.8;
    const position = course.pointAt(z).addScaledVector(side, sway).addScaledVector(lift, rise);
    if (world.distance(position.x, position.y, position.z) < 3 || course.rings.some((ring) => Math.abs(ring.position.z - position.z) < ORB.hoopGap)) continue;
    orbs.push({ position, phase: (i * 2.399) % (Math.PI * 2), collected: false });
  }
  return orbs;
}

const vertexShader = /* glsl */ `
  uniform float time;
  attribute float phase;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vPhase;
  #include <fog_pars_vertex>
  void main() {
    vec3 p = position * (1.0 + 0.06 * sin(time * 3.0 + phase));
    vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
    world.y += sin(time * 1.6 + phase) * 0.35;
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vPhase = phase;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float time;
  uniform float boost;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vPhase;
  #include <fog_pars_fragment>
  void main() {
    float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    float rim = (1.0 - facing) * (1.0 - facing);
    float core = facing * facing * facing * facing;
    float pulse = 0.85 + 0.15 * sin(time * 4.0 + vPhase * 3.0);
    vec3 amber = vec3(1.0, 0.55, 0.16);
    vec3 heart = vec3(1.0, 0.86, 0.55);
    // A warm translucent shell, a bright rim that blooms, and a soft glowing heart
    vec3 color = (amber * (0.5 + 1.5 * rim) + heart * core * 1.1) * pulse * (0.8 + 0.4 * boost);
    float alpha = clamp(0.32 + 0.6 * rim + 0.35 * core, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
    #include <fog_fragment>
  }
`;

const MAX = 64;
const matrix = new THREE.Matrix4();
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const ORANGE = new THREE.Color("#ffa040");
const GOLD = new THREE.Color("#ffd98a");
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class Orbs {
  readonly group = new THREE.Group();
  orbs: Orb[] = [];
  private level = 1;
  private readonly mesh: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.ShaderMaterial>;
  private readonly phases = new Float32Array(MAX);
  private readonly previous = new THREE.Vector3();
  private sampled = false;
  private emberDebt = 0;
  /** Orbs collected since the last frame: each gets its burst of light */
  private readonly fresh: Orb[] = [];

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, boost: { value: 1 } }]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    material.uniforms.time = fxTime;
    material.uniforms.boost = FX_LIGHT.boost;
    const geometry = new THREE.IcosahedronGeometry(ORB.size, 3);
    geometry.setAttribute("phase", new THREE.InstancedBufferAttribute(this.phases, 1));
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  setLevel(world: World, level: number) {
    this.level = level;
    this.orbs = placeOrbs(world, level);
    this.sampled = false;
  }

  /** After a teleport (respawn, revive): no sweep from where the pilot was */
  reset() {
    this.sampled = false;
  }

  /** Per physics step: orbs flown through refill the boost. `potency` × the level's restore, `reach` + radius */
  step(flight: Flight, potency = 1, reach = 0): number {
    let restored = 0;
    const radius = (ORB.radius + reach) ** 2;
    for (const orb of this.orbs) {
      if (orb.collected) continue;
      const d = this.sampled ? segmentDistanceSq(orb.position, this.previous, flight.position) : orb.position.distanceToSquared(flight.position);
      if (d > radius) continue;
      orb.collected = true;
      const amount = orbRestore(this.level) * potency;
      flight.refillBoost(amount);
      restored += amount;
      this.fresh.push(orb);
    }
    this.previous.copy(flight.position);
    this.sampled = true;
    return restored;
  }

  /** Per frame: the orbs near the camera, a few embers drifting off them, a burst for each one collected */
  frame(dt: number, camera: THREE.Vector3, particles: Particles) {
    let count = 0;
    for (const orb of this.orbs) {
      if (orb.collected || count >= MAX || orb.position.distanceToSquared(camera) > 500 ** 2) continue;
      matrix.makeTranslation(orb.position.x, orb.position.y, orb.position.z);
      this.mesh.setMatrixAt(count, matrix);
      this.phases[count++] = orb.phase;
      // Embers rising off the nearest orbs
      if (orb.position.distanceToSquared(camera) < 120 ** 2) this.emberDebt += dt * 2.5 * particles.budget;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.geometry.getAttribute("phase") as THREE.InstancedBufferAttribute).needsUpdate = true;
    for (; this.emberDebt >= 1; this.emberDebt--) {
      const orb = this.orbs[Math.floor(Math.random() * this.orbs.length)];
      if (!orb || orb.collected) continue;
      at.copy(orb.position).add(vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(ORB.size));
      particles.emit(at, vel.set(rand(-0.3, 0.3), rand(0.6, 1.4), rand(-0.3, 0.3)), fx(rand(0.8, 1.4), rand(0.08, 0.14), ORANGE, Kind.Glow, -0.3, 1, 1.4));
    }
    for (const orb of this.fresh) {
      for (let k = 0; k < Math.round(26 * particles.budget); k++) {
        vel.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 6));
        particles.emit(orb.position, vel, k % 3 ? fx(rand(0.5, 0.9), rand(0.14, 0.26), ORANGE, Kind.Glow, -0.5, 2, 1.8) : fx(rand(0.6, 1), rand(0.2, 0.35), GOLD, Kind.Star, -0.3, 1.5, 2));
      }
      particles.emit(orb.position, vel.set(0, 0.5, 0), fx(0.45, 3.2, ORANGE, Kind.Glow, 0, 3, 1.2));
    }
    this.fresh.length = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.group.removeFromParent();
  }
}
