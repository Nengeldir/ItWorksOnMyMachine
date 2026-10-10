import { Matrix4, Quaternion, Vector3 } from "three";
import { clamp } from "./math";

// A simplified winged object with a short, load-limited flight-path response.
// Diving turns height into speed, climbing spends speed, and drag dissipates energy.
// Tune these live with ?tune in the URL.
export const FLIGHT = {
  gravity: 9.81, // Earth's gravitational acceleration, m/s²
  drag: 0.0013, // vertical terminal speed ≈ 87 m/s
  pitchRate: 2.4, // rad/s at full input
  rollRate: 4.2,
  turnRate: 1.4, // gameplay multiplier on coordinated turning
  autoLevel: 2, // how fast the wings level out when you let go (0 = off)
  pathResponse: 14, // flight-path response, 1/s (about 70 ms)
  maxLoad: 8, // maximum steering acceleration in g; tuned for arcade handling
  stallSpeed: 16, // below this the nose drops
  sink: 1.3, // m/s of sink at sinkSpeed, growing as you slow down
  sinkSpeed: 30,
  glideDrag: 0.5, // dissipate energy from lift-related sink rather than sustaining speed
  proximityBoost: 5, // gameplay bonus: extra m/s² while skimming terrain
  maxSpeed: 120, // overspeed drag onset, not an instantaneous speed clamp
  minSpeed: 6,
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
const desiredPath = new Vector3();
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
  private readonly flightPath = new Vector3(0, 0, -1);
  speed = 35;

  reset(position: Vector3, direction: Vector3, speed: number) {
    this.position.copy(position);
    // Matrix4.lookAt points -z at the target, which is our forward
    lookMatrix.lookAt(ORIGIN, direction, WORLD_UP);
    this.quaternion.setFromRotationMatrix(lookMatrix);
    this.speed = speed;
    this.updateAxes();
    this.flightPath.copy(this.forward);
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
    return Math.atan2(-this.right.y, this.up.y);
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
    const liftAuthority = clamp(this.speed / Math.max(p.stallSpeed, 0.01), 0, 1) ** 2;
    turn.setFromAxisAngle(LOCAL_RIGHT, clamp(input.pitch, -1, 1) * p.pitchRate * liftAuthority * dt);
    this.quaternion.multiply(turn);
    this.updateAxes();
    let rollRate = clamp(input.roll, -1, 1) * p.rollRate * liftAuthority;
    if (Math.abs(input.roll) < 0.05 && p.autoLevel > 0 && this.up.y > 0) {
      rollRate = clamp(-this.bank * p.autoLevel * 2, -p.rollRate * 0.5, p.rollRate * 0.5) * liftAuthority;
    }
    // Rolling right turns about the forward axis (-z), i.e. negative about +z
    turn.setFromAxisAngle(LOCAL_BACK, -rollRate * dt);
    this.quaternion.multiply(turn);

    // A coordinated turn tightens at lower airspeed. Limit the bank factor near
    // knife-edge, where maintaining altitude would require infinite lift.
    this.updateAxes();
    // Signed lateral lift stays continuous through knife-edge and inverted flight.
    const bankFactor = Math.sin(this.bank) / Math.max(Math.abs(Math.cos(this.bank)), 0.26);
    const headingAuthority = Math.hypot(this.forward.x, this.forward.z);
    const yawRate = p.turnRate * p.gravity * bankFactor
      / Math.max(this.speed, 6) * liftAuthority * headingAuthority;
    turn.setFromAxisAngle(WORLD_UP, -yawRate * dt);
    this.quaternion.premultiply(turn);

    // Too slow: the nose drops towards the ground
    const stallSpeed = p.stallSpeed * (mods ? mods.stall : 1);
    // const stall = clamp((stallSpeed - this.speed) / stallSpeed, 0, 1);
    const stall = clamp((stallSpeed - this.speed) / Math.max(stallSpeed, 0.01), 0, 1);
    if (stall > 0) {
      axis.crossVectors(this.forward, WORLD_DOWN);
      // Straight up has no unique cross-product axis: use the local pitch axis.
      if (axis.lengthSq() < 1e-8 && this.forward.y > 0) axis.copy(this.right).negate();
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
    // let sink = Math.min(30, p.sink * (p.sinkSpeed / Math.max(this.speed, 6)) ** 2);
    // if (mods) sink = sink * mods.sink * (1 - mods.hover) - mods.lift;
    // this.velocity.copy(this.forward).multiplyScalar(this.speed);
    // this.velocity.y -= sink;
    // this.position.addScaledVector(this.velocity, dt);
    // Sink changes the glide angle, not the speed magnitude. This avoids adding
    // free kinetic energy and makes gravity respond to the actual flight path.
    const horizontal = Math.hypot(this.forward.x, this.forward.z);
    const bankSink = 1 / Math.max(Math.cos(this.bank), 0.25) ** 2;
    let sink = Math.min(30, p.sink * (p.sinkSpeed / Math.max(this.speed, 6)) ** 2
      * bankSink) * horizontal;
    if (mods) sink = sink * mods.sink * (1 - mods.hover) - mods.lift;
    desiredPath.copy(this.forward).multiplyScalar(Math.max(this.speed, 0.01));
    desiredPath.y -= sink;
    desiredPath.normalize();
    axis.crossVectors(this.flightPath, desiredPath);
    const pathAngle = Math.acos(clamp(this.flightPath.dot(desiredPath), -1, 1));
    if (pathAngle > 1e-8) {
      if (axis.lengthSq() < 1e-12) axis.copy(this.right);
      axis.normalize();
      const responseAngle = pathAngle * (1 - Math.exp(-p.pathResponse * dt));
      const loadAngle = p.maxLoad * p.gravity / Math.max(this.speed, 6) * dt;
      turn.setFromAxisAngle(axis, Math.min(responseAngle, loadAngle));
      this.flightPath.applyQuaternion(turn).normalize();
    }

    // Terrain proximity grants an intentional gameplay speed boost.
    // Use midpoint speed for drag and displacement so gravity exchanges height
    // and speed consistently.
    const previousSpeed = this.speed;
    // Lift-related sink costs energy through induced drag. Without this loss,
    // the sink feeds gravity until it exactly balances drag, leaving a level
    // nose at a fixed glide speed indefinitely. Deliberate nose-down dives
    // still gain speed; holding the nose level spends speed until it stalls.
    const glideLoss = p.glideDrag * p.gravity * Math.max(0, this.forward.y - this.flightPath.y);
    const pathAccel = -p.gravity * this.flightPath.y - glideLoss
      + p.proximityBoost * clamp(proximity, 0, 1);
    // Extra drag above the design speed replaces the old hard speed cutoff.
    const overspeed = Math.max(0, previousSpeed - p.maxSpeed);
    const drag = p.drag + 0.0001 * overspeed;
    const predictedSpeed = Math.max(0, previousSpeed
      + (pathAccel - drag * previousSpeed ** 2) * dt * 0.5);
    this.speed = Math.max(0, previousSpeed
      + (pathAccel - drag * predictedSpeed ** 2) * dt);
    const averageSpeed = (previousSpeed + this.speed) * 0.5;
    this.velocity.copy(this.flightPath).multiplyScalar(this.speed);
    this.position.addScaledVector(this.flightPath, averageSpeed * dt);
  }
}
