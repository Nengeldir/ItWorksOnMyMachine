import * as THREE from "three";
import { PET_LOOKS } from "../tuning";
import type { PetId } from "./catalog";
import { PET_SPARKS, PetModel } from "./models";
import { type Kind, type Particles, fx } from "../particles";
import { Autopilot } from "../autopilot";
import { Flight } from "../flight";
import type { Course } from "../world/course";

// The companion plays around the pilot as they fly: it circles them in a
// loose, bobbing orbit (with now and then a little loop of joy), always
// travelling forward with them. Near a hoop it darts ahead on its own
// unscored rail through the hoop's centre, and once through it roams for a
// moment (dashing ahead, to the side, above) before it settles back into its
// orbit. A critically damped spring on its place relative to the pilot keeps
// every change smooth at any speed. Looks only: the pilot's flight never sees it.

const UP = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const want = new THREE.Vector3();
const look = new THREE.Matrix4();
const facing = new THREE.Quaternion();
const ORIGIN = new THREE.Vector3();

export class Companion {
  private readonly autopilot = new Autopilot();
  private readonly flight = new Flight();
  private course: Course | null = null;
  private model: PetModel | null = null;
  private placed = false;
  /** The pet's place relative to the pilot (springed), and how fast that is changing */
  private readonly offset = new THREE.Vector3();
  private readonly offsetVelocity = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly last = new THREE.Vector3();
  /** Where the pilot was last frame: a jump further than `snapDistance` is a teleport (respawn) */
  private readonly lastPilot = new THREE.Vector3();
  /** 0 playing around the pilot, 1 on the rail through a hoop */
  private guiding = 0;
  /** Seconds of roaming left after a hoop, and where it's roaming to */
  private roam = 0;
  private roamNext = 0;
  private readonly roamTo = new THREE.Vector3();
  private orbit = Math.random() * Math.PI * 2;
  private loop = -1;
  private loopWait = 6;
  private time = 0;
  private readonly scene: THREE.Object3D;
  private readonly particles: Particles | null;
  private sparkDebt = 0;
  private readonly at = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly color = new THREE.Color();
  constructor(scene: THREE.Object3D, particles: Particles | null = null) { this.scene = scene; this.particles = particles; }
  get id(): PetId { return this.model?.id ?? "none"; }
  get group(): THREE.Group | null { return this.model?.group ?? null; }
  set(id: PetId) {
    if (id === this.id) return;
    this.model?.dispose();
    this.model = id === "none" ? null : new PetModel(id);
    if (this.model) { this.scene.add(this.model.group); this.model.group.visible = false; }
    this.placed = false;
    this.guiding = 0;
    this.roam = 0;
    this.time = 0;
  }

  update(dt: number, pilot: THREE.Object3D, visible: boolean, course?: Course, speed = 32) {
    const model = this.model;
    if (!model) return;
    model.group.visible = visible && PET_LOOKS.size > 0;
    if (!visible) { this.placed = false; return; }
    if (dt <= 0 && this.placed) return;
    this.time += dt;
    const g = model.group;

    // The pilot's heading, level: the orbit turns with the pilot, but never rolls with a bank or a barrel roll
    forward.set(0, 0, -1).applyQuaternion(pilot.quaternion).setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    right.crossVectors(forward, UP).normalize();

    // Near a hoop it flies its own rail through the hoop's middle
    if (course && this.course !== course) { this.course = course; this.autopilot.reset(); this.guiding = 0; }
    let near = false;
    if (course) {
      this.autopilot.guide(dt, this.flight, course, pilot.position.z, PET_LOOKS.lead, speed);
      near = this.hoopNear(course, pilot.position);
    }
    const wasGuiding = this.guiding > 0.5;
    this.guiding = THREE.MathUtils.clamp(this.guiding + Math.sign((near ? 1 : 0) - this.guiding) * dt * PET_LOOKS.guideBlend, 0, 1);
    // Through the hoop: a moment of roaming before it orbits again
    if (wasGuiding && this.guiding <= 0.5) { this.roam = PET_LOOKS.roam; this.roamNext = 0; }

    // Where it wants to be relative to the pilot: its orbit, a roam, or the rail
    this.playful(dt, want);
    if (this.roam > 0) {
      this.roam = Math.max(0, this.roam - dt);
      if ((this.roamNext -= dt) <= 0) {
        // Dash somewhere new: ahead, to a side, above or below, never far
        this.roamNext = 0.55 + Math.random() * 0.5;
        const a = Math.random() * Math.PI * 2;
        // Within about 5 m: the line's 11 m tube is carved clear of rock, so the pet never grazes it
        const reach = PET_LOOKS.spacing * 0.9 + Math.random();
        this.roamTo.copy(right).multiplyScalar(Math.cos(a) * reach).addScaledVector(forward, Math.sin(a) * reach + 0.8).addScaledVector(UP, (Math.random() - 0.3) * 2.2);
      }
      // Fades back into the orbit over its last second
      want.lerp(this.roamTo, Math.min(1, this.roam));
    }
    const k = THREE.MathUtils.smootherstep(this.guiding, 0, 1);
    if (k > 0) want.lerp(this.target.subVectors(this.flight.position, pilot.position), k);

    const teleported = this.lastPilot.distanceToSquared(pilot.position) > PET_LOOKS.snapDistance ** 2;
    this.lastPilot.copy(pilot.position);
    const snap = !this.placed || teleported || this.offset.distanceToSquared(want) > PET_LOOKS.snapDistance ** 2;
    if (snap) {
      this.offset.copy(want);
      this.offsetVelocity.set(0, 0, 0);
    } else if (k >= 1) {
      // Fully on the rail: exactly through the hoop's centre
      this.offsetVelocity.subVectors(want, this.offset).divideScalar(Math.max(dt, 1e-4));
      this.offset.copy(want);
    } else {
      // A critically damped spring, solved exactly: smooth at any speed and frame rate, never wobbling
      const w = PET_LOOKS.follow;
      const decay = Math.exp(-w * dt);
      const error = this.at.subVectors(this.offset, want);
      const push = this.velocity.copy(error).multiplyScalar(w).add(this.offsetVelocity).multiplyScalar(dt);
      this.offsetVelocity.addScaledVector(push, -w).multiplyScalar(decay);
      this.offset.copy(want).add(error.add(push).multiplyScalar(decay));
    }
    this.last.copy(g.position);
    g.position.copy(pilot.position).add(this.offset);
    g.position.y += Math.sin(this.time * 2.2) * PET_LOOKS.bob;

    // It faces where it is going (the pilot's way, plus its own play), banking a little into its turns
    if (snap || !this.placed) g.quaternion.copy(pilot.quaternion);
    else if (k >= 1) g.quaternion.copy(this.flight.quaternion);
    else {
      this.velocity.subVectors(g.position, this.last);
      if (this.velocity.lengthSq() > 1e-6) {
        look.lookAt(ORIGIN, this.velocity, UP);
        facing.setFromRotationMatrix(look);
        g.quaternion.slerp(facing, 1 - Math.exp(-dt * 7));
      }
    }
    this.placed = true;
    g.scale.setScalar(PET_LOOKS.size);
    model.animate(dt);
    this.sparks(dt, model);
  }

  /**
   * Its orbit around the pilot, into `out` (relative to the pilot): a wide, slightly tilted circle
   * at a changing pace and height, and every so often a quick vertical loop of joy
   */
  private playful(dt: number, out: THREE.Vector3) {
    const t = this.time;
    const pace = (Math.PI * 2) / Math.max(1, PET_LOOKS.orbit);
    this.orbit += dt * pace * (1 + 0.35 * Math.sin(t * 0.7));
    const radius = PET_LOOKS.spacing * (1 + 0.12 * Math.sin(t * 0.9 + 1.3));
    const a = this.orbit;
    // Wider to the sides than ahead and behind, so it stays out of the camera's line to the pilot
    out.copy(right).multiplyScalar(Math.cos(a) * radius).addScaledVector(forward, Math.sin(a) * radius * 0.7 - PET_LOOKS.trail * 0.3);
    out.addScaledVector(UP, PET_LOOKS.height + Math.sin(a * 2 + t * 0.4) * 0.6);
    // A loop of joy: a quick vertical circle around its own place
    this.loopWait -= dt;
    if (this.loop < 0 && this.loopWait <= 0) { this.loop = 0; this.loopWait = 9 + Math.random() * 8; }
    if (this.loop >= 0) {
      this.loop += dt / 1.1;
      if (this.loop >= 1) this.loop = -1;
      else {
        const l = this.loop * Math.PI * 2;
        out.addScaledVector(UP, (1 - Math.cos(l)) * 0.6).addScaledVector(forward, Math.sin(l) * 0.6);
      }
    }
    return out;
  }

  /** A hoop not yet passed within `PET_LOOKS.hoopRange` of the pilot */
  private hoopNear(course: Course, at: THREE.Vector3): boolean {
    const range = PET_LOOKS.hoopRange;
    for (const ring of course.rings) {
      if (ring.position.z < at.z - 2) continue;
      if (ring.position.z > at.z + range) return false;
      if (ring.position.distanceToSquared(at) < range * range) return true;
    }
    return false;
  }

  /** The pet's own light, shed from its tail and left hanging in the air behind it */
  private sparks(dt: number, model: PetModel) {
    const particles = this.particles;
    if (!particles || dt <= 0 || PET_LOOKS.sparkle <= 0) return;
    const spec = PET_SPARKS[model.id], g = model.group, scale = PET_LOOKS.size;
    const rate = spec.rate * PET_LOOKS.sparkle * particles.budget;
    this.sparkDebt = Math.min(this.sparkDebt + rate * dt, 8);
    this.color.set(spec.color);
    for (; this.sparkDebt >= 1; this.sparkDebt--) {
      this.at.copy(model.sparkFrom).add(this.velocity.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(0.25))
        .multiplyScalar(scale).applyQuaternion(g.quaternion).add(g.position);
      this.velocity.set(Math.random() - .5, Math.random() * .6, Math.random() - .5).multiplyScalar(0.8);
      particles.emit(this.at, this.velocity, fx(spec.life * (0.7 + Math.random() * 0.6), spec.size * scale * (0.7 + Math.random() * 0.6),
        this.color, spec.kind as Kind, spec.gravity, 1.2, spec.intensity));
    }
  }
  dispose() { this.model?.dispose(); this.model = null; this.placed = false; }
}
