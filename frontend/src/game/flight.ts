import { Matrix4, Quaternion, Vector3 } from "three";
import { clamp } from "./world/terrain";

// An arcade wingsuit: the nose points where you go. Diving turns height into
// speed, climbing turns speed back into height, and air drag caps both.
// Tune these live with ?tune in the URL.
export const FLIGHT = {
  gravity: 16, // m/s² along the flight path when pointing straight down
  drag: 0.0013, // top speed in a vertical dive is sqrt(gravity / drag) ≈ 110 m/s
  pitchRate: 1.6, // rad/s at full input
  rollRate: 3.2,
  turnRate: 1.15, // yaw rad/s at 90° of bank
  autoLevel: 1.2, // how fast the wings level out when you let go (0 = off)
  stallSpeed: 16, // below this the nose drops
  sink: 1.3, // m/s of sink at sinkSpeed, growing as you slow down
  sinkSpeed: 30,
  proximityBoost: 5, // extra m/s² while skimming the terrain
  minSpeed: 6,
  maxSpeed: 120,
};

export interface FlightInput {
  pitch: number; // -1..1, positive = nose up
  roll: number; // -1..1, positive = roll right
}

const LOCAL_RIGHT = new Vector3(1, 0, 0);
const LOCAL_BACK = new Vector3(0, 0, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_DOWN = new Vector3(0, -1, 0);
const turn = new Quaternion();
const axis = new Vector3();
const lookMatrix = new Matrix4();
const ORIGIN = new Vector3();

export class Flight {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  readonly forward = new Vector3(0, 0, -1);
  readonly up = new Vector3(0, 1, 0);
  readonly right = new Vector3(1, 0, 0);
  speed = 35;

  reset(position: Vector3, direction: Vector3, speed: number) {
    this.position.copy(position);
    // Matrix4.lookAt points -z at the target, which is our forward
    lookMatrix.lookAt(ORIGIN, direction, WORLD_UP);
    this.quaternion.setFromRotationMatrix(lookMatrix);
    this.speed = speed;
    this.updateAxes();
    this.velocity.copy(this.forward).multiplyScalar(speed);
  }

  private updateAxes() {
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  /** Bank angle in radians, positive with the right wing down */
  get bank(): number {
    return Math.asin(clamp(-this.right.y, -1, 1));
  }

  step(dt: number, input: FlightInput, proximity: number, p = FLIGHT) {
    this.updateAxes();

    // Pitch and roll in the pilot's own frame
    turn.setFromAxisAngle(LOCAL_RIGHT, input.pitch * p.pitchRate * dt);
    this.quaternion.multiply(turn);
    let rollRate = input.roll * p.rollRate;
    if (Math.abs(input.roll) < 0.05 && p.autoLevel > 0 && this.up.y > 0) {
      rollRate = clamp(-this.bank * p.autoLevel * 2, -p.rollRate * 0.5, p.rollRate * 0.5);
    }
    // Rolling right turns about the forward axis (-z), i.e. negative about +z
    turn.setFromAxisAngle(LOCAL_BACK, -rollRate * dt);
    this.quaternion.multiply(turn);

    // Banking turns you, like a glider
    this.updateAxes();
    turn.setFromAxisAngle(WORLD_UP, -p.turnRate * Math.sin(this.bank) * dt);
    this.quaternion.premultiply(turn);

    // Too slow: the nose drops towards the ground
    const stall = clamp((p.stallSpeed - this.speed) / p.stallSpeed, 0, 1);
    if (stall > 0) {
      axis.crossVectors(this.forward, WORLD_DOWN);
      const length = axis.length();
      if (length > 1e-4) {
        const toDown = Math.acos(clamp(this.forward.dot(WORLD_DOWN), -1, 1));
        turn.setFromAxisAngle(axis.divideScalar(length), Math.min(toDown, stall * 2.4 * dt));
        this.quaternion.premultiply(turn);
      }
    }
    this.quaternion.normalize();
    this.updateAxes();

    // Energy: gravity along the flight path, drag, and a boost for flying close
    const accel = -p.gravity * this.forward.y - p.drag * this.speed * this.speed + p.proximityBoost * proximity;
    this.speed = clamp(this.speed + accel * dt, p.minSpeed, p.maxSpeed);
    const sink = Math.min(30, p.sink * (p.sinkSpeed / Math.max(this.speed, 6)) ** 2);
    this.velocity.copy(this.forward).multiplyScalar(this.speed);
    this.velocity.y -= sink;
    this.position.addScaledVector(this.velocity, dt);
  }
}
