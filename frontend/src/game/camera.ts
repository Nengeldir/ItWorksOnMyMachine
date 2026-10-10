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

/** Third-person chase camera: trails behind, banks with you, widens with speed */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  private readonly offset = new Vector3(0, 3, 10);
  private readonly up = new Vector3(0, 1, 0);
  private fov = CAMERA.fov;
  private punch = 0; // extra degrees of FOV that decay: a kick when passing a gate
  private time = 0;
  private clearFraction = 1;
  private readonly sight = new Vector3(0, 0, -1);

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
    this.fov = CAMERA.fov + clamp((speed - 30) * CAMERA.fovPerSpeed, 0, CAMERA.fovMax);
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
    const shake = proximity * clamp(speed / 70, 0, 1.5) * CAMERA.shake;
    if (shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }
    // A slow drift when gliding slowly, so the view breathes like in Sky
    const calm = clamp((45 - speed) / 25, 0, 1);
    this.camera.position.y += Math.sin(this.time * 0.9) * 0.15 * calm;

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
    this.punch = Math.max(this.punch, degrees);
  }

  private setFov(fov: number, dt: number) {
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