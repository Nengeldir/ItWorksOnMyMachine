import { PerspectiveCamera, Vector3 } from "three";
import { clamp } from "./math";
import { CAMERA } from "./tuning";

const WORLD_UP = new Vector3(0, 1, 0);
const desired = new Vector3();
const blendedUp = new Vector3();
const target = new Vector3();
const pulled = new Vector3();

/** Third-person chase camera: trails behind, banks with you, widens with speed */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  private readonly offset = new Vector3(0, 3, 10);
  private readonly up = new Vector3(0, 1, 0);
  private fov = CAMERA.fov;
  private punch = 0; // extra degrees of FOV that decay: a kick when passing a gate
  private time = 0;

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
    this.offset.copy(this.desiredOffset(forward, up, speed));
    this.up.copy(WORLD_UP);
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
  ) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * CAMERA.stiffness);
    this.offset.lerp(this.desiredOffset(forward, up, speed), k);
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

    // Behind rock? Pull in towards the pilot until the view is clear
    if (clearance && clearance(this.camera.position.x, this.camera.position.y, this.camera.position.z) < 1.5) {
      let clear = 0;
      let blocked = 1;
      for (let i = 0; i < 6; i++) {
        const mid = (clear + blocked) / 2;
        pulled.lerpVectors(position, this.camera.position, mid);
        if (clearance(pulled.x, pulled.y, pulled.z) >= 1.5) clear = mid;
        else blocked = mid;
      }
      this.camera.position.lerpVectors(position, this.camera.position, clear);
    }

    // Roll the horizon with the pilot, but only partly
    blendedUp.copy(WORLD_UP).lerp(up, CAMERA.rollFollow).normalize();
    this.up.lerp(blendedUp, 1 - Math.exp(-dt * 5)).normalize();
    this.camera.up.copy(this.up);
    this.camera.lookAt(target.copy(position).addScaledVector(forward, CAMERA.lookAhead).addScaledVector(up, 1.2));

    this.setFov(CAMERA.fov + clamp((speed - 30) * CAMERA.fovPerSpeed, 0, CAMERA.fovMax), dt);
  }

  /**
   * After a crash: keep the tumbling pilot in view from 7 to 15 m away, out of
   * the rock, without the chase camera's roll
   */
  follow(point: Vector3, dt: number, clearance: (x: number, y: number, z: number) => number) {
    pulled.subVectors(this.camera.position, point);
    const length = pulled.length();
    if (length > 1e-3) {
      target.copy(point).addScaledVector(pulled, clamp(length, 7, 15) / length);
      this.camera.position.lerp(target, 1 - Math.exp(-dt * 3));
    }
    const gap = clearance(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    if (gap < 1.5) this.camera.position.y += Math.min(1.5 - gap, 20 * dt + 0.1);
    this.watch(point, dt);
  }

  /** After a crash: stay put and look at the wreck */
  watch(point: Vector3, dt: number) {
    this.up.lerp(WORLD_UP, 1 - Math.exp(-dt * 3)).normalize();
    this.camera.up.copy(this.up);
    this.camera.lookAt(point);
    this.setFov(CAMERA.fov, dt);
  }

  /** A quick widening of the view, e.g. when flying through a gate */
  kick(degrees = CAMERA.ringPunch) {
    this.punch = Math.max(this.punch, degrees);
  }

  private setFov(fov: number, dt: number) {
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 3));
    this.punch *= Math.exp(-dt * 4);
    const total = this.fov + this.punch;
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
