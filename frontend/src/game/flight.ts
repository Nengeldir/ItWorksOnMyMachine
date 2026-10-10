import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { clamp } from "./math";

// A simplified winged object with a short, load-limited flight-path response.
// Diving turns height into speed, climbing spends speed, and drag dissipates energy.
// Tune these live with ?tune in the URL.
export const FLIGHT = {
  gravity: 9.81, // Earth's gravitational acceleration, m/s²
  drag: 0.0013, // vertical terminal speed ≈ 87 m/s
  pitchRate: 2.4, // rad/s at full input
  rollRate: 4.2, // maximum bank response, rad/s
  maxBank: 80, // degrees: steering cannot roll past this
  dodgeDistance: 5, // metres along the unbanked right axis at activation
  dodgeDuration: 0.6,
  dodgeCooldown: 1, // seconds between starts
  turnRate: 1.4, // gameplay multiplier on coordinated turning
  autoLevel: 2, // bank-target and upright recovery response, 1/s
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
  boost: number; // additional fraction of universal boost acceleration
  lift: number; // m/s of climb right now (a thermal's updraft)
  hover: number; // 0..1: cancels the sink and gravity along the path
  glideLock: boolean; // let go of pitch and the nose holds a shallow glide
  thrust: number; // m/s² pushed along the flight path (slipstreams, cloud surfing, Gale Force, a plunge)
  dive: number; // 0..1: the nose is pulled down towards `diveAngle` (Plunging Attack)
  diveAngle: number; // radians below the horizon
  hang: boolean; // Hover-Stall: no flight model, the pilot hangs in the air and turns on the spot (`hangStep`)
}

export function plainMods(): FlightMods {
  return { drag: 1, sink: 1, stall: 1, proximityBoost: 1, boost: 0, lift: 0, hover: 0, glideLock: false, thrust: 0, dive: 0, diveAngle: 1, hang: false };
}

/** The shallow dive the glide lock holds (radians below the horizon) */
const GLIDE_ANGLE = 0.09;

export interface FlightInput {
  boost?: number; // 0..1, held
  brake?: number; // 0..1, held
  pitch: number; // -1..1, positive = nose up
  roll: number; // -1..1 steering target, positive = turn right
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
const euler = new Euler(0, 0, 0, "YXZ");
/** Hover-Stall: how fast the pilot turns on the spot (rad/s), and how far it can look up or down */
const HANG_YAW = 2;
const HANG_PITCH = 1.4;
const HANG_PITCH_LIMIT = 1.2;

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

/**
 * The same hitbox in world space, for testing against the land drawn: the
 * body ball's centre into `ball`, and each wing's rectangle as four corners in
 * order into `wings` (right wing 0 to 3, left wing 4 to 7). The outer leading
 * corners (1 and 5) are the wingtips
 */
export function hitboxWorld(position: Vector3, quaternion: Quaternion, ball: Vector3, wings: Vector3[], p = FLIGHT) {
  ball.set(0, 0, -p.hitBodyAhead).applyQuaternion(quaternion).add(position);
  const lift = Math.tan(p.hitWingDihedral);
  const front = -p.hitWingAhead - p.hitWingChord / 2;
  const back = -p.hitWingAhead + p.hitWingChord / 2;
  for (let w = 0; w < 2; w++) {
    const side = w === 0 ? 1 : -1;
    const inner = WING_UP + p.hitWingFrom * lift;
    const outer = WING_UP + p.hitWingTo * lift;
    wings[w * 4].set(p.hitWingFrom * side, inner, front);
    wings[w * 4 + 1].set(p.hitWingTo * side, outer, front);
    wings[w * 4 + 2].set(p.hitWingTo * side, outer, back);
    wings[w * 4 + 3].set(p.hitWingFrom * side, inner, back);
    for (let i = 0; i < 4; i++) wings[w * 4 + i].applyQuaternion(quaternion).add(position);
  }
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
  boost = 0;
  brake = 0;
  boostCharge = 1;
  private exhausted = false;
  private steeringBank = 0;
  private readonly dodgeAxis = new Vector3();
  private dodgeElapsed = -1;
  private dodgeWait = 0;
  private dodgeDirection = 1;
  private dodgeLength = 5;
  private dodgeDuration = 0.6;

  /** Seconds until the next dodge can start */
  get dodgeCooldown(): number {
    return this.dodgeWait;
  }

  /** Signed animation progress; zero means no dodge. */
  get dodgePhase(): number {
    return this.dodgeElapsed < 0 ? 0 : this.dodgeDirection * Math.max(0.0001, this.dodgeElapsed / this.dodgeDuration);
  }

  /** A sideways dodge; `force` rolls even while one is under way or cooling down (Acrobatic Recovery) */
  dodge(direction: 1 | -1, p = FLIGHT, force = false): boolean {
    if (!force && (this.dodgeElapsed >= 0 || this.dodgeWait > 0)) return false;
    // Remove steering bank so a horizontal dodge doesn't also change altitude.
    turn.setFromAxisAngle(LOCAL_BACK, this.steeringBank);
    this.dodgeAxis.set(1, 0, 0).applyQuaternion(turn).applyQuaternion(this.quaternion).normalize();
    this.dodgeDirection = direction;
    this.dodgeLength = p.dodgeDistance;
    this.dodgeDuration = Math.max(0.1, p.dodgeDuration);
    this.dodgeElapsed = 0;
    this.dodgeWait = Math.max(this.dodgeDuration, p.dodgeCooldown);
    return true;
  }

  releaseControls() { this.boost = 0; this.brake = 0; this.dodgeElapsed = -1; }

  reset(position: Vector3, direction: Vector3, speed: number) {
    this.releaseControls();
    this.boostCharge = 1;
    this.exhausted = false;
    this.steeringBank = 0;
    this.dodgeElapsed = -1;
    this.dodgeWait = 0;
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
    turn.setFromAxisAngle(LOCAL_BACK, this.steeringBank);
    this.quaternion.multiply(turn);
    turn.setFromAxisAngle(LOCAL_RIGHT, pitch);
    this.quaternion.multiply(turn);
    turn.setFromAxisAngle(LOCAL_BACK, -this.steeringBank);
    this.quaternion.multiply(turn).normalize();
    this.updateAxes();
  }

  /**
   * Hover-Stall (run mode), one step: the speed bleeds away, the wings level,
   * and the pilot turns on the spot: roll input yaws, pitch input pitches
   * (short of straight up or down). Gravity, sink and drag are off
   */
  private hangStep(dt: number, input: FlightInput) {
    this.boost = 0;
    this.brake = 0;
    this.speed *= Math.exp(-dt * 7);
    this.steeringBank = 0;
    this.updateAxes();
    let pitch = Math.asin(clamp(this.forward.y, -1, 1));
    let yaw = Math.atan2(-this.forward.x, -this.forward.z);
    yaw -= clamp(input.roll, -1, 1) * HANG_YAW * dt;
    pitch = clamp(pitch + clamp(input.pitch, -1, 1) * HANG_PITCH * dt, -HANG_PITCH_LIMIT, HANG_PITCH_LIMIT);
    this.quaternion.setFromEuler(euler.set(pitch, yaw, 0));
    this.updateAxes();
    this.flightPath.copy(this.forward);
    this.position.addScaledVector(this.forward, this.speed * dt);
    this.velocity.copy(this.forward).multiplyScalar(this.speed);
    this.dodgeWait = Math.max(0, this.dodgeWait - dt);
    this.dodgeElapsed = -1;
  }

  /** Out of a hover-stall: off along the nose at `speed` */
  launch(speed: number) {
    this.updateAxes();
    this.speed = speed;
    this.flightPath.copy(this.forward);
    this.velocity.copy(this.forward).multiplyScalar(speed);
  }

  /**
   * Glancing off a surface (Acrobatic Recovery, run mode): out along `normal`
   * by `push` metres, the nose and the path turned to run along the surface,
   * keeping `keep` of the speed
   */
  deflect(normal: Vector3, push: number, keep: number) {
    this.position.addScaledVector(normal, push);
    const into = this.flightPath.dot(normal);
    if (into < 0) {
      desiredPath.copy(this.flightPath).addScaledVector(normal, -into * 1.15).normalize();
      turn.setFromUnitVectors(this.flightPath, desiredPath);
      this.quaternion.premultiply(turn).normalize();
      this.flightPath.copy(desiredPath);
    }
    this.speed *= keep;
    this.updateAxes();
    this.velocity.copy(this.flightPath).multiplyScalar(this.speed);
  }

  /** Steering bank relative to the pitch frame; continuous through vertical flight. */
  get bank(): number {
    return this.steeringBank;
  }

  step(dt: number, input: FlightInput, proximity: number, p = FLIGHT, mods: FlightMods | null = null) {
    if (mods?.hang) {
      this.hangStep(dt, input);
      return;
    }
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
    // A plunge: the nose is hauled down towards a steep dive (steering still works)
    if (mods && mods.dive > 0) {
      const angle = Math.asin(clamp(this.forward.y, -1, 1));
      locked.pitch = clamp((-mods.diveAngle - angle) * 4, -1, 1) * mods.dive + input.pitch * (1 - mods.dive);
      locked.roll = input.roll;
      locked.boost = input.boost;
      locked.brake = input.brake;
      input = locked;
    }

    // Unbank before pitching: pitch remains continuous through a full loop.
    // A/D choose a bounded bank target, rather than continuously adding roll.
    const stallSpeed = p.stallSpeed * (mods ? mods.stall : 1);
    const liftAuthority = clamp(this.speed / Math.max(stallSpeed, 0.01), 0, 1) ** 2;
    turn.setFromAxisAngle(LOCAL_BACK, this.steeringBank);
    this.quaternion.multiply(turn);
    turn.setFromAxisAngle(LOCAL_RIGHT, clamp(input.pitch, -1, 1) * p.pitchRate * liftAuthority * dt);
    this.quaternion.multiply(turn);
    // Pitch loops can leave the underlying frame upside down even when the
    // steering bank is zero. Recover that frame around the nose when pitch is
    // released, preserving heading and allowing deliberate loops while held.
    // Fade recovery at the poles, where world-up has no unique roll direction.
    this.updateAxes();
    if (Math.abs(input.pitch) < 0.05) {
      const horizontalSq = this.forward.x ** 2 + this.forward.z ** 2;
      const uprightAngle = Math.abs(this.right.y) < 1e-8 && this.up.y < 0
        ? Math.PI : Math.atan2(-this.right.y, this.up.y);
      const recovery = uprightAngle * (1 - Math.exp(-p.autoLevel * horizontalSq * dt));
      turn.setFromAxisAngle(LOCAL_BACK, clamp(recovery, -p.rollRate * dt, p.rollRate * dt));
      this.quaternion.multiply(turn);
    }
    const limit = p.maxBank * Math.PI / 180;
    const bankTarget = clamp(input.roll, -1, 1) * limit;
    const bankChange = (bankTarget - this.steeringBank) * (1 - Math.exp(-Math.max(2, p.autoLevel * 2) * dt));
    this.steeringBank = clamp(this.steeringBank + clamp(bankChange, -p.rollRate * dt, p.rollRate * dt) * liftAuthority, -limit, limit);
    turn.setFromAxisAngle(LOCAL_BACK, -this.steeringBank);
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
      + (mods?.thrust ?? 0)
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
    this.dodgeWait = Math.max(0, this.dodgeWait - dt);
    if (this.dodgeElapsed >= 0) {
      const before = this.dodgeElapsed / this.dodgeDuration;
      this.dodgeElapsed = Math.min(this.dodgeDuration, this.dodgeElapsed + dt);
      const after = this.dodgeElapsed / this.dodgeDuration;
      // Smoothstep displacement integrates to exactly 5 m, with zero end speeds.
      const moved = this.dodgeDirection * this.dodgeLength
        * (after * after * (3 - 2 * after) - before * before * (3 - 2 * before));
      this.position.addScaledVector(this.dodgeAxis, moved);
      if (dt > 0) this.velocity.addScaledVector(this.dodgeAxis, moved / dt);
      if (this.dodgeElapsed >= this.dodgeDuration) this.dodgeElapsed = -1;
    }
  }
}
