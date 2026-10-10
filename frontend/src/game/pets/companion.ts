import * as THREE from "three";
import { PET_LOOKS } from "../tuning";
import type { PetId } from "./catalog";
import { PetModel } from "./models";
import { Autopilot } from "../autopilot";
import { Flight } from "../flight";
import type { Course } from "../world/course";

/** The pet's own unscored rail flight leads through hoop centres; player physics stays independent. */
export class Companion {
  private readonly autopilot = new Autopilot();
  private readonly flight = new Flight();
  private course: Course | null = null;
  private model: PetModel | null = null;
  private readonly target = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private placed = false;
  private time = 0;
  private readonly scene: THREE.Object3D;
  constructor(scene: THREE.Object3D) { this.scene = scene; }
  get id(): PetId { return this.model?.id ?? "none"; }
  get group(): THREE.Group | null { return this.model?.group ?? null; }
  set(id: PetId) {
    if (id === this.id) return;
    this.model?.dispose();
    this.model = id === "none" ? null : new PetModel(id);
    if (this.model) { this.scene.add(this.model.group); this.model.group.visible = false; }
    this.placed = false;
    this.time = 0;
  }
  update(dt: number, pilot: THREE.Object3D, visible: boolean, course?: Course, speed = 32) {
    const model = this.model;
    if (!model) return;
    model.group.visible = visible && PET_LOOKS.size > 0;
    if (!visible) { this.placed = false; return; }
    if (dt <= 0 && this.placed) return;
    this.time += dt;
    if (course) {
      if (this.course !== course) { this.course = course; this.autopilot.reset(); this.placed = false; }
      this.autopilot.guide(dt, this.flight, course, pilot.position.z, PET_LOOKS.lead, speed);
      const g = model.group;
      g.position.copy(this.flight.position); g.quaternion.copy(this.flight.quaternion);
      g.scale.setScalar(PET_LOOKS.size); model.animate(dt); this.placed = true;
      return;
    }
    // Close enough to read, outside the pilot's wing fan, never blocking the next gate.
    this.offset.set(PET_LOOKS.spacing, PET_LOOKS.height, PET_LOOKS.trail).applyQuaternion(pilot.quaternion);
    this.target.copy(pilot.position).add(this.offset);
    this.target.y += Math.sin(this.time * 2.2) * PET_LOOKS.bob;
    const g = model.group;
    if (!this.placed || g.position.distanceToSquared(this.target) > PET_LOOKS.snapDistance ** 2) {
      g.position.copy(this.target); g.quaternion.copy(pilot.quaternion); this.placed = true;
    } else {
      const blend = 1 - Math.exp(-dt * PET_LOOKS.follow);
      g.position.lerp(this.target, blend);
      g.quaternion.slerp(pilot.quaternion, blend);
    }
    g.scale.setScalar(PET_LOOKS.size);
    model.animate(dt);
  }
  dispose() { this.model?.dispose(); this.model = null; this.placed = false; }
}
