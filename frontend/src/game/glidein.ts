import * as THREE from "three";
import { clamp, smoothstep } from "./math";
import type { Flight } from "./flight";

// While the land around you is still being built, the pilot glides in on a
// fixed, slow, scripted path instead of hanging frozen in the air. The player
// gets control when the land has arrived.
//
// It must not be a way to get ahead, so it is deliberately dumb:
//  - it ignores every input, and it never runs the flight model, so there is
//    no crash, no proximity, no style, no gates and no portal while it lasts
//    (Game skips its physics step; nothing is recorded for ghosts);
//  - it covers at most GLIDE_DISTANCE metres, and always stops GATE_MARGIN
//    metres short of the next gate in front of it, then hovers in place;
//  - it backs off from rock (it slows down and stops before any surface);
//  - control is handed back at START_SPEED (Game), never at the speed the
//    pilot had before, and in a run the level clock keeps running.
// Races never see it: Game only glides in free flight (no countdown, no race).

const GLIDE_DISTANCE = 70; // metres at most
const GATE_MARGIN = 30; // metres short of the next gate, at least
const CRUISE = 18; // m/s while gliding in
const CLEARANCE = 6; // metres kept from any surface

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const look = new THREE.Matrix4();
const ahead = new THREE.Vector3();
const tmp = new THREE.Vector3();

export interface GateLike {
  position: THREE.Vector3;
}

type Field = (x: number, y: number, z: number) => number;

export class GlideIn {
  active = false;
  /** Metres glided so far */
  travelled = 0;
  private limit = 0;
  private speed = 0;
  private readonly direction = new THREE.Vector3();
  private readonly level = new THREE.Quaternion();

  /** Takes over from the pilot's current position and heading */
  start(flight: Flight, gates: readonly GateLike[]) {
    this.active = true;
    this.travelled = 0;
    this.speed = Math.min(flight.speed, 40);
    // Level out: a gentle, almost flat glide
    this.direction.copy(flight.forward);
    this.direction.y = clamp(this.direction.y, -0.2, 0.05);
    if (this.direction.lengthSq() < 1e-6) this.direction.set(0, 0, 1);
    this.direction.normalize();
    look.lookAt(ORIGIN, this.direction, WORLD_UP);
    this.level.setFromRotationMatrix(look);
    // Never as far as the next gate in front
    let nearest = Infinity;
    for (const gate of gates) {
      const along = tmp.subVectors(gate.position, flight.position).dot(this.direction);
      if (along > 0 && along < nearest) nearest = along;
    }
    this.limit = clamp(nearest - GATE_MARGIN, 0, GLIDE_DISTANCE);
  }

  stop() {
    this.active = false;
  }

  /** Moves the flight state along the glide; the caller keeps the previous state for interpolation */
  update(dt: number, flight: Flight, field: Field) {
    if (!this.active || dt <= 0) return;
    // Ease down to a cruise, then to a hover at the end of the glide
    const left = this.limit - this.travelled;
    let target = CRUISE * smoothstep(0, 12, left);
    // Slow down and stop before rock in the way
    ahead.copy(flight.position).addScaledVector(this.direction, Math.max(4, this.speed * 0.6));
    const gap = Math.min(field(ahead.x, ahead.y, ahead.z), field(flight.position.x, flight.position.y, flight.position.z));
    target *= smoothstep(CLEARANCE, CLEARANCE * 2.5, gap);
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * 1.6));
    const step = Math.min(this.speed * dt, Math.max(0, left));
    this.travelled += step;
    flight.position.addScaledVector(this.direction, step);
    flight.quaternion.slerp(this.level, 1 - Math.exp(-dt * 2.5));
    flight.speed = this.speed;
    flight.forward.set(0, 0, -1).applyQuaternion(flight.quaternion);
    flight.up.set(0, 1, 0).applyQuaternion(flight.quaternion);
    flight.right.set(1, 0, 0).applyQuaternion(flight.quaternion);
    flight.velocity.copy(this.direction).multiplyScalar(this.speed);
  }

  /** Where to hand control back: the glide's heading */
  get heading(): THREE.Vector3 {
    return this.direction;
  }
}
