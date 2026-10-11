import * as THREE from "three";
import { PET_LOOKS } from "../tuning";
import type { PetId } from "./catalog";
import { PET_SPARKS, PetModel } from "./models";
import { type Kind, type Particles, fx } from "../particles";
import { Autopilot } from "../autopilot";
import { Flight } from "../flight";
import type { Course } from "../world/course";

/** The pet flies close by the pilot; near a hoop it takes its own unscored rail through the hoop's centre. Player physics stays independent. */
export class Companion {
  private readonly autopilot = new Autopilot();
  private readonly flight = new Flight();
  private course: Course | null = null;
  private model: PetModel | null = null;
  private readonly target = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private placed = false;
  /** Where the pet would be beside the pilot, smoothed */
  private readonly near = new THREE.Vector3();
  private readonly nearTurn = new THREE.Quaternion();
  private readonly side = new THREE.Vector3();
  /** 0 beside the pilot, 1 on the rail */
  private guiding = 0;
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
    this.time = 0;
  }
  update(dt: number, pilot: THREE.Object3D, visible: boolean, course?: Course, speed = 32) {
    const model = this.model;
    if (!model) return;
    model.group.visible = visible && PET_LOOKS.size > 0;
    if (!visible) { this.placed = false; return; }
    if (dt <= 0 && this.placed) return;
    this.time += dt;
    // Close by the pilot, outside its wing fan
    this.offset.set(PET_LOOKS.spacing, PET_LOOKS.height, PET_LOOKS.trail).applyQuaternion(pilot.quaternion);
    this.target.copy(pilot.position).add(this.offset);
    const snap = !this.placed || this.near.distanceToSquared(this.target) > PET_LOOKS.snapDistance ** 2;
    if (snap) {
      this.side.copy(this.offset); this.nearTurn.copy(pilot.quaternion);
    } else {
      // Smoothed relative to the pilot, so it keeps up at any speed and only swings wide in turns
      const blend = 1 - Math.exp(-dt * PET_LOOKS.follow);
      this.side.lerp(this.offset, blend);
      this.nearTurn.slerp(pilot.quaternion, blend);
    }
    this.near.copy(pilot.position).add(this.side);
    this.near.y += Math.sin(this.time * 2.2) * PET_LOOKS.bob;
    // Near a hoop, it flies its own unscored rail through the hoop's middle instead, and back to the pilot after
    if (course && this.course !== course) { this.course = course; this.autopilot.reset(); this.guiding = 0; }
    if (!course) this.guiding = 0;
    else {
      this.autopilot.guide(dt, this.flight, course, pilot.position.z, PET_LOOKS.lead, speed);
      const want = this.hoopNear(course, pilot.position) ? 1 : 0;
      this.guiding = snap ? want : THREE.MathUtils.clamp(this.guiding + Math.sign(want - this.guiding) * dt * PET_LOOKS.guideBlend, 0, 1);
    }
    const g = model.group, k = THREE.MathUtils.smootherstep(this.guiding, 0, 1);
    if (k <= 0) { g.position.copy(this.near); g.quaternion.copy(this.nearTurn); }
    else if (k >= 1) { g.position.copy(this.flight.position); g.quaternion.copy(this.flight.quaternion); }
    else { g.position.lerpVectors(this.near, this.flight.position, k); g.quaternion.slerpQuaternions(this.nearTurn, this.flight.quaternion, k); }
    this.placed = true;
    g.scale.setScalar(PET_LOOKS.size);
    model.animate(dt);
    this.sparks(dt, model);
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
