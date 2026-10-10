import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { clamp } from "./math";
import { CAMERA } from "./tuning";

const WORLD_UP = new Vector3(0, 1, 0);
const desired = new Vector3();
const blendedUp = new Vector3();
const target = new Vector3();
const pulled = new Vector3();
const chase = new Vector3();
const sight = new Vector3();
const horizon = new Vector3();
const cross = new Vector3();
const transport = new Quaternion();
const DEGREES = Math.PI / 180;
/** Elevations (degrees) the fall camera tries, highest first, until one has a clear view */
const FALL_ANGLES = [90, 50, 30, 12];
const arc = new Vector3();

/** Third-person chase camera: trails behind, banks with you, widens with speed */
export class CameraRig {
  reducedMotion = false;
  readonly camera: PerspectiveCamera;
  private readonly offset = new Vector3(0, 3, 10);
  private readonly up = new Vector3(0, 1, 0);
  private fov = CAMERA.fov;
  private punch = 0; // extra degrees of FOV that decay: a kick when passing a gate
  private time = 0;
  private clearFraction = 1;
  private readonly sight = new Vector3(0, 0, -1);
  // After a crash: the point watched, and the arc the camera flies over it
  private readonly focus = new Vector3();
  private readonly heading = new Vector3(0, 0, 1); // horizontal, from the pilot out to the camera
  private elevation = 0;
  private range = 10;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(70, aspect, 0.5, 6000);
  }

  private desiredOffset(forward: Vector3, up: Vector3, speed: number): Vector3 {
    blendedUp.copy(WORLD_UP).lerp(up, 0.3).normalize();
    return desired
        .copy(forward)
        .multiplyScalar(-(CAMERA.distance + speed * CAMERA.distancePerSpeed))
        .addScaledVector(blendedUp, CAMERA.height);
  }

  /** Jumps straight behind the pilot (after a respawn) */
  snap(position: Vector3, forward: Vector3, up: Vector3, speed: number) {
    this.clearFraction = 1;
    this.punch = 0;
    this.fov = this.reducedMotion ? CAMERA.fov : CAMERA.fov + clamp((speed - 30) * CAMERA.fovPerSpeed, 0, CAMERA.fovMax);
    this.offset.copy(this.desiredOffset(forward, up, speed));
    this.up.copy(WORLD_UP);
    this.sight.set(0, 0, -1);
    this.update(0, position, forward, up, speed, 0, null);
  }

  update(
      dt: number,
      position: Vector3,
      forward: Vector3,
      up: Vector3,
      speed: number,
      proximity: number,
      clearance: ((x: number, y: number, z: number) => number) | null,
      velocity?: Vector3,
      boost = 0,
  ) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * CAMERA.stiffness);
    chase.copy(forward);
    if (velocity && velocity.lengthSq() > 1) {
      target.copy(velocity).normalize();
      chase.lerp(target, CAMERA.pathFollow).normalize();
    }
    this.offset.lerp(this.desiredOffset(chase, up, speed).addScaledVector(chase, -boost * CAMERA.boostDistance), k);
    this.camera.position.copy(position).add(this.offset);

    // Shake when skimming the ground at speed
    const shake = (this.reducedMotion ? 0 : 1) * proximity * clamp(speed / 70, 0, 1.5) * CAMERA.shake;
    if (shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }
    // A slow drift when gliding slowly, so the view breathes like in Sky
    const calm = clamp((45 - speed) / 25, 0, 1);
    if (!this.reducedMotion) this.camera.position.y += Math.sin(this.time * 0.9) * 0.15 * calm;

    // Walk the whole segment: a wall may sit between two clear endpoints.
    let fraction = 1;
    if (clearance) {
      const length = this.camera.position.distanceTo(position);
      const samples = Math.max(1, Math.ceil(length / 0.4));
      for (let i = 1; i <= samples; i++) {
        pulled.lerpVectors(position, this.camera.position, i / samples);
        if (clearance(pulled.x, pulled.y, pulled.z) < 0.6) {
          fraction = Math.max(0, (i - 1) / samples);
          break;
        }
      }
    }
    this.clearFraction = fraction < this.clearFraction ? fraction
      : this.clearFraction + (fraction - this.clearFraction) * (1 - Math.exp(-dt * 4));
    this.camera.position.lerpVectors(position, this.camera.position, this.clearFraction);

    target.copy(position).addScaledVector(chase, CAMERA.lookAhead).addScaledVector(up, 1.2);
    blendedUp.copy(WORLD_UP).lerp(up, CAMERA.rollFollow);
    this.aim(target, blendedUp, dt);

    this.setFov(CAMERA.fov + clamp((speed - 30) * CAMERA.fovPerSpeed + boost * CAMERA.boostFov, 0, CAMERA.fovMax), dt);
  }

  /** A crash at `point`: from where the chase view is now, the camera will arc up over the pilot (`fall`) */
  startFall(point: Vector3) {
    this.focus.copy(point);
    pulled.subVectors(this.camera.position, point);
    this.range = Math.max(pulled.length(), 1);
    this.elevation = Math.asin(clamp(pulled.y / this.range, -1, 1));
    this.heading.set(pulled.x, 0, pulled.z);
    if (this.heading.lengthSq() < 1e-6) this.heading.set(0, 0, 1);
    this.heading.normalize();
  }

  /**
   * After a crash: the camera rises in a smooth arc on the same side as the
   * chase view, up over the tumbling pilot, and looks down on the fall,
   * trailing the body a little so you see it drop. Out of the rock.
   */
  fall(point: Vector3, dt: number, clearance: (x: number, y: number, z: number) => number) {
    this.focus.lerp(point, 1 - Math.exp(-dt * CAMERA.fallTrack));
    const k = 1 - Math.exp(-dt * CAMERA.fallSwing);
    // From above if the sky over the pilot is open; under an overhang, lower, so the
    // camera doesn't end up pressed against the pilot
    let target = CAMERA.fallAngle * DEGREES;
    for (const angle of FALL_ANGLES) {
      target = Math.min(CAMERA.fallAngle, angle) * DEGREES;
      if (this.clearShare(target, CAMERA.fallDistance, clearance) >= 0.7) break;
    }
    this.elevation += (target - this.elevation) * k;
    this.range += (CAMERA.fallDistance - this.range) * k;
    const position = this.camera.position;
    this.arcPoint(this.elevation, this.range, position);

    // Rock in the way (an overhang, a wall): come in towards the pilot until the view is clear
    const clear = this.clearShare(this.elevation, this.range, clearance);
    if (clear < 1) position.lerpVectors(this.focus, position, clear);
    this.watch(this.focus, dt);
  }

  /** The point on the fall camera's arc at this elevation and distance */
  private arcPoint(elevation: number, range: number, out: Vector3): Vector3 {
    out.copy(this.focus).addScaledVector(this.heading, Math.cos(elevation) * range);
    out.y += Math.sin(elevation) * range;
    return out;
  }

  /** How much of the way out to that point on the arc the view stays clear of rock (1: all of it) */
  private clearShare(elevation: number, range: number, clearance: (x: number, y: number, z: number) => number): number {
    const far = this.arcPoint(elevation, range, arc);
    if (clearance(far.x, far.y, far.z) >= 1.5) return 1;
    let clear = 0;
    let blocked = 1;
    for (let i = 0; i < 6; i++) {
      const mid = (clear + blocked) / 2;
      pulled.lerpVectors(this.focus, far, mid);
      if (clearance(pulled.x, pulled.y, pulled.z) >= 1.5) clear = mid;
      else blocked = mid;
    }
    return clear;
  }

  /** After a crash: stay put and look at the wreck */
  watch(point: Vector3, dt: number) {
    this.aim(point, WORLD_UP, dt);
    this.setFov(CAMERA.fov, dt);
  }

  /** Transport the previous camera frame, then gently recover the horizon.
   * Unlike a world-up lookAt, this remains defined at both vertical poles. */
  private aim(point: Vector3, preferredUp: Vector3, dt: number) {
    sight.subVectors(point, this.camera.position);
    if (sight.lengthSq() < 1e-10) return;
    sight.normalize();
    transport.setFromUnitVectors(this.sight, sight);
    this.up.applyQuaternion(transport);
    this.up.addScaledVector(sight, -this.up.dot(sight)).normalize();
    horizon.copy(preferredUp).addScaledVector(sight, -preferredUp.dot(sight));
    const horizontal = Math.hypot(sight.x, sight.z);
    // Near vertical, the projected horizon changes sides: don't chase it.
    const recovery = clamp((horizontal - 0.15) / 0.45, 0, 1);
    if (horizon.lengthSq() > 1e-8 && recovery > 0) {
      horizon.normalize();
      const angle = Math.atan2(sight.dot(cross.crossVectors(this.up, horizon)), clamp(this.up.dot(horizon), -1, 1));
      const maxCorrection = CAMERA.horizonRecovery * dt * recovery;
      this.up.applyAxisAngle(sight, clamp(angle * (1 - Math.exp(-dt * 3)), -maxCorrection, maxCorrection));
    }
    this.sight.copy(sight);
    this.camera.up.copy(this.up);
    this.camera.lookAt(point);
  }

  /** A quick widening of the view, e.g. when flying through a gate */
  kick(degrees = CAMERA.ringPunch) {
    if (!this.reducedMotion) this.punch = Math.max(this.punch, degrees);
  }

  private setFov(fov: number, dt: number) {
    if (this.reducedMotion) { fov = CAMERA.fov; this.punch = 0; }
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 3));
    this.punch *= Math.exp(-dt * 4);
    const total = Math.min(CAMERA.fov + CAMERA.fovMax, this.fov + this.punch);
    if (Math.abs(this.camera.fov - total) > 0.01) {
      this.camera.fov = total;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}