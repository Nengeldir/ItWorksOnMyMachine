import { Matrix4, Quaternion, Vector3 } from "three";
import { clamp } from "./math";

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
  proximityBoost: 5, // extra m/s² while skimming rock
  minSpeed: 6,
  maxSpeed: 120,
  // The hitbox (see touching()): a ball for the body, a flat rectangle per wing.
  // A little smaller than the pilot drawn, so near misses stay graceful
  hitBody: 0.5, // radius of the body's ball (m)
  hitBodyAhead: 0.4, // the ball's centre, ahead of the hips (the pilot's origin): it covers the head too
  hitWingFrom: 0.35, // each wing's rectangle spans this far out from the middle…
  hitWingTo: 2.1, // …to this far
  hitWingChord: 0.9, // front to back
  hitWingAhead: -0.15, // the rectangle's middle, ahead of the hips (negative: behind; the wings sweep back)
  hitWingDihedral: 0.15, // radians the rectangles tilt up towards the tips, like the wings drawn mid-stroke
};

/**
 * Changes to the flight model from roguelike upgrades. Only runs pass these
 * (Game hands them over in run mode); races and time trials always fly the
 * plain model, so their times stay comparable.
 */
export interface FlightMods {
  drag: number; // multiplies FLIGHT.drag
  sink: number; // multiplies the sink
  stall: number; // multiplies the stall speed
  proximityBoost: number; // multiplies FLIGHT.proximityBoost
  boost: number; // extra m/s² right now (a dash, a thermal)
  lift: number; // m/s of climb right now (a thermal's updraft)
  hover: number; // 0..1: cancels the sink and gravity along the path
  glideLock: boolean; // let go of pitch and the nose holds a shallow glide
}

export function plainMods(): FlightMods {
  return { drag: 1, sink: 1, stall: 1, proximityBoost: 1, boost: 0, lift: 0, hover: 0, glideLock: false };
}

/** The shallow dive the glide lock holds (radians below the horizon) */
const GLIDE_ANGLE = 0.09;

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
const locked: FlightInput = { pitch: 0, roll: 0 };
const probe = new Vector3();

/** Which part of the pilot touched a surface */
export type HitPart = "body" | "left" | "right";

/** The wings' rectangles sit on the back, a little above the hips */
const WING_UP = 0.15;
/** Samples across each wing's rectangle: corners and edges catch flat rock exactly, the inner rows bumps and trunks */
const SPAN_SAMPLES = 4;
const CHORD_SAMPLES = 3;

/**
 * The pilot's hitbox against a distance field (negative inside): a ball for
 * the body and a flat rectangle for each wing, tilted up a little like the
 * wings drawn. It's fixed in the flight frame: the animated pose, flaps and
 * barrel rolls never change what you hit. `center` is the field at
 * `position`, which the caller already has: far from everything, nothing
 * else is sampled. Returns the part touching, and writes
 * the contact's offset in the pilot's own frame to `local`; null if clear.
 */
export function touching(
  field: (x: number, y: number, z: number) => number,
  position: Vector3,
  quaternion: Quaternion,
  center: number,
  local: Vector3,
  p = FLIGHT,
): HitPart | null {
  const lift = Math.tan(p.hitWingDihedral);
  const reach = Math.max(p.hitBodyAhead + p.hitBody, Math.hypot(p.hitWingTo, WING_UP + Math.abs(lift) * p.hitWingTo, Math.abs(p.hitWingAhead) + p.hitWingChord / 2));
  if (center > reach + 0.25) return null;
  local.set(0, 0, -p.hitBodyAhead);
  probe.copy(local).applyQuaternion(quaternion).add(position);
  if (field(probe.x, probe.y, probe.z) < p.hitBody) return "body";

  // Half the rectangle's diagonal (its span measured along the tilt)
  const halfDiagonal = Math.hypot(((p.hitWingTo - p.hitWingFrom) / 2) * Math.hypot(1, lift), p.hitWingChord / 2);
  for (let side = 1; side >= -1; side -= 2) {
    // The wing's middle first: if the nearest surface is beyond its corners, the whole wing is clear
    const middle = (p.hitWingFrom + p.hitWingTo) / 2;
    probe.set(middle * side, WING_UP + middle * lift, -p.hitWingAhead).applyQuaternion(quaternion).add(position);
    if (field(probe.x, probe.y, probe.z) > halfDiagonal) continue;
    let deepest = 0;
    for (let i = 0; i < SPAN_SAMPLES; i++) {
      const x = (p.hitWingFrom + ((p.hitWingTo - p.hitWingFrom) * i) / (SPAN_SAMPLES - 1)) * side;
      for (let j = 0; j < CHORD_SAMPLES; j++) {
        const z = -p.hitWingAhead + p.hitWingChord * (j / (CHORD_SAMPLES - 1) - 0.5);
        const y = WING_UP + Math.abs(x) * lift;
        probe.set(x, y, z).applyQuaternion(quaternion).add(position);
        const d = field(probe.x, probe.y, probe.z);
        if (d < deepest) {
          deepest = d;
          local.set(x, y, z);
        }
      }
    }
    if (deepest < 0) return side > 0 ? "right" : "left";
  }
  return null;
}

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

  /** A wingbeat (run mode): a burst of speed and the nose lifted a little */
  flap(speed: number, pitch: number) {
    this.speed = Math.min(FLIGHT.maxSpeed, this.speed + speed);
    turn.setFromAxisAngle(LOCAL_RIGHT, pitch);
    this.quaternion.multiply(turn).normalize();
    this.updateAxes();
  }

  /** Bank angle in radians, positive with the right wing down */
  get bank(): number {
    return Math.asin(clamp(-this.right.y, -1, 1));
  }

  step(dt: number, input: FlightInput, proximity: number, p = FLIGHT, mods: FlightMods | null = null) {
    this.updateAxes();
    // Glide lock: with pitch let go, ease the nose towards a shallow, efficient glide
    if (mods?.glideLock && Math.abs(input.pitch) < 0.05) {
      const angle = Math.asin(clamp(this.forward.y, -1, 1));
      locked.pitch = clamp((-GLIDE_ANGLE - angle) * 2.5, -0.6, 0.6);
      locked.roll = input.roll;
      input = locked;
    }

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
    const stallSpeed = p.stallSpeed * (mods ? mods.stall : 1);
    const stall = clamp((stallSpeed - this.speed) / stallSpeed, 0, 1);
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
    let accel = -p.gravity * this.forward.y - p.drag * this.speed * this.speed + p.proximityBoost * proximity;
    if (mods) {
      // The same terms, changed by upgrades (run mode only)
      const gravity = -p.gravity * this.forward.y * (1 - mods.hover);
      accel = gravity - p.drag * mods.drag * this.speed * this.speed + p.proximityBoost * mods.proximityBoost * proximity + mods.boost;
    }
    this.speed = clamp(this.speed + accel * dt, p.minSpeed, p.maxSpeed);
    let sink = Math.min(30, p.sink * (p.sinkSpeed / Math.max(this.speed, 6)) ** 2);
    if (mods) sink = sink * mods.sink * (1 - mods.hover) - mods.lift;
    this.velocity.copy(this.forward).multiplyScalar(this.speed);
    this.velocity.y -= sink;
    this.position.addScaledVector(this.velocity, dt);
  }
}
