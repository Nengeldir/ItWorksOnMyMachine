import * as THREE from "three";
import { FLIGHT, type Flight } from "./flight";
import { clamp } from "./math";
import { AUTOPILOT } from "./tuning";
import type { Course } from "./world/course";

// The autopilot (the menu's chase view, the victory lap after a run): the
// pilot flies the racing line itself, on rails. The line goes through the
// middle of every gate, and both terrain generators carve a tube of
// TUBE_RADIUS (11 m) around it that rock, trees and structures keep out of,
// so on the line nothing is ever closer than that. Steering the flight model
// after it by feel cut corners and crashed a few times a course.
//
// Nothing it does is scored or saved: Game only uses it while nobody plays.
// The speed still follows the slope (gravity along the line against drag), so
// it glides slowly where the line flattens and picks up speed in dives, and it
// banks into the line's curves like a coordinated turn.

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const point = new THREE.Vector3();
const tangent = new THREE.Vector3();
const before = new THREE.Vector3();
const after = new THREE.Vector3();
const right = new THREE.Vector3();
/** Metres of z either side over which the line's curvature is measured */
const CURVE_SPAN = 8;
/** Seconds for a start off the line (a glide-in, a start slot) to settle onto it */
const SETTLE = 1.2;

export class Autopilot {
  private z = Number.NaN;
  private speed = 0;
  private bank = 0;
  private readonly offset = new THREE.Vector3();

  /** Takes over from wherever the pilot is on the next step (after a respawn or a new level) */
  reset() {
    this.z = Number.NaN;
  }

  /** One fixed step along the line: moves `flight` and points it down the line */
  step(dt: number, flight: Flight, course: Course) {
    if (Number.isNaN(this.z)) {
      this.z = flight.position.z;
      this.offset.subVectors(flight.position, course.pointAt(this.z, point));
      this.speed = clamp(flight.speed, AUTOPILOT.railMinSpeed, AUTOPILOT.railMaxSpeed);
      this.bank = flight.bank;
    }
    course.tangentAt(this.z, tangent);
    const accel = -FLIGHT.gravity * tangent.y - FLIGHT.drag * this.speed * this.speed;
    this.speed = clamp(this.speed + accel * dt, AUTOPILOT.railMinSpeed, Math.max(AUTOPILOT.railMinSpeed, AUTOPILOT.railMaxSpeed));
    // The line is a function of z: ds = dz / tangent.z
    this.z += this.speed * dt * tangent.z;
    this.offset.multiplyScalar(Math.exp(-dt / SETTLE));
    course.pointAt(this.z, point).add(this.offset);
    course.tangentAt(this.z, tangent);

    // Bank into the curve a moment before it, as far as a coordinated turn would: tan(bank) = v² κ / g
    const lead = this.z + this.speed * AUTOPILOT.railLead;
    course.tangentAt(lead + CURVE_SPAN, after).sub(course.tangentAt(lead - CURVE_SPAN, before));
    const curvature = after.multiplyScalar(tangent.z / (2 * CURVE_SPAN));
    right.crossVectors(tangent, WORLD_UP).normalize();
    const limit = (AUTOPILOT.railBank * Math.PI) / 180;
    const target = clamp(Math.atan2(this.speed * this.speed * curvature.dot(right), FLIGHT.gravity), -limit, limit);
    this.bank += (target - this.bank) * (1 - Math.exp(-dt * 3));
    flight.place(point, tangent, this.speed, this.bank);
  }
}
