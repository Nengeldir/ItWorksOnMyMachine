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
  boostAcceleration: 24,
  boostSeconds: 2.5,
  boostRecharge: 0.22, // reserve per second after release
  controlResponse: 12,
  brakeDrag: 0.025,
  brakeFloor: 22, // brake force fades here; climbing can still stall
  minSpeed: 6, // steering denominator only; never injects speed
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
  boost: number; // additional fraction of universal boost acceleration
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
  boost?: number; // 0..1, held
  brake?: number; // 0..1, held
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

export class Flight {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  readonly forward = new Vector3(0, 0, -1);
  readonly up = new Vector3(0, 1, 0);
  readonly right = new Vector3(1, 0, 0);
  private readonly flightPath = new Vector3(0, 0, -1);
  speed = 35;
  boost = 0;
  brake = 0;
  boostCharge = 1;
  private exhausted = false;

  releaseControls() { this.boost = 0; this.brake = 0; }

  reset(position: Vector3, direction: Vector3, speed: number) {
    this.releaseControls();
    this.boostCharge = 1;
    this.exhausted = false;
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
    this.speed += speed;
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
    const brakeInput = clamp(input.brake ?? 0, 0, 1);
    const boostInput = brakeInput > 0 ? 0 : clamp(input.boost ?? 0, 0, 1);
    if (boostInput === 0) this.exhausted = false;
    const boosting = boostInput > 0 && !this.exhausted && this.boostCharge > 0;
    const response = 1 - Math.exp(-p.controlResponse * dt);
    this.brake += (brakeInput - this.brake) * response;
    this.boost += ((boosting ? boostInput : 0) - this.boost) * response;
    if (brakeInput > 0 || this.exhausted) this.boost = 0;
    if (boosting) {
      this.boostCharge = Math.max(0, this.boostCharge - boostInput * dt / p.boostSeconds);
      if (this.boostCharge === 0) { this.exhausted = true; this.boost = 0; }
    } else if (boostInput === 0) {
      this.boostCharge = Math.min(1, this.boostCharge + p.boostRecharge * dt);
    }
    // Glide lock: with pitch let go, ease the nose towards a shallow, efficient glide
    if (mods?.glideLock && Math.abs(input.pitch) < 0.05) {
      const angle = Math.asin(clamp(this.forward.y, -1, 1));
      locked.pitch = clamp((-GLIDE_ANGLE - angle) * 2.5, -0.6, 0.6);
      locked.roll = input.roll;
      input = locked;
    }

    // Pitch and roll in the pilot's own frame
    const stallSpeed = p.stallSpeed * (mods ? mods.stall : 1);
    const liftAuthority = clamp(this.speed / Math.max(stallSpeed, 0.01), 0, 1) ** 2;
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
      / Math.max(this.speed, p.minSpeed, 0.01) * liftAuthority * headingAuthority;
    turn.setFromAxisAngle(WORLD_UP, -yawRate * dt);
    this.quaternion.premultiply(turn);

    // Too slow: the nose drops towards the ground
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

    // Sink changes the glide angle, not the speed magnitude. This avoids adding
    // free kinetic energy and makes gravity respond to the actual flight path.
    const horizontal = Math.hypot(this.forward.x, this.forward.z);
    const bankSink = 1 / Math.max(Math.cos(this.bank), 0.25) ** 2;
    let sink = Math.min(30, p.sink * (p.sinkSpeed / Math.max(this.speed, p.minSpeed, 0.01)) ** 2
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
      const loadAngle = p.maxLoad * p.gravity / Math.max(this.speed, p.minSpeed, 0.01) * dt;
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
    const pathAccel = -p.gravity * this.flightPath.y * (1 - (mods?.hover ?? 0)) - glideLoss
      + p.proximityBoost * (mods?.proximityBoost ?? 1) * clamp(proximity, 0, 1)
      + this.boost * p.boostAcceleration * (1 + (mods?.boost ?? 0))
      - this.brake * p.brakeDrag * Math.max(0, this.speed ** 2 - p.brakeFloor ** 2);
    // Extra drag above the design speed replaces the old hard speed cutoff.
    const overspeed = Math.max(0, previousSpeed - p.maxSpeed);
    const drag = p.drag * (mods?.drag ?? 1) + 0.0001 * overspeed;
    const predictedSpeed = Math.max(0, previousSpeed
      + (pathAccel - drag * previousSpeed ** 2) * dt * 0.5);
    this.speed = Math.max(0, previousSpeed
      + (pathAccel - drag * predictedSpeed ** 2) * dt);
    const averageSpeed = (previousSpeed + this.speed) * 0.5;
    this.velocity.copy(this.flightPath).multiplyScalar(this.speed);
    this.position.addScaledVector(this.flightPath, averageSpeed * dt);
  }
}
