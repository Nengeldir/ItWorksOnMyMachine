import { PerspectiveCamera, Vector3 } from "three";
import { clamp } from "./math";

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
  private fov = 70;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(70, aspect, 0.5, 6000);
  }

  private desiredOffset(forward: Vector3, up: Vector3, speed: number): Vector3 {
    blendedUp.copy(WORLD_UP).lerp(up, 0.3).normalize();
    return desired
      .copy(forward)
      .multiplyScalar(-(8.5 + speed * 0.035))
      .addScaledVector(blendedUp, 2.6);
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
    const k = 1 - Math.exp(-dt * 7);
    this.offset.lerp(this.desiredOffset(forward, up, speed), k);
    this.camera.position.copy(position).add(this.offset);

    // Shake when skimming the ground at speed
    const shake = proximity * clamp(speed / 70, 0, 1.5) * 0.12;
    if (shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }

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
    blendedUp.copy(WORLD_UP).lerp(up, 0.55).normalize();
    this.up.lerp(blendedUp, 1 - Math.exp(-dt * 5)).normalize();
    this.camera.up.copy(this.up);
    this.camera.lookAt(target.copy(position).addScaledVector(forward, 14).addScaledVector(up, 1.2));

    this.setFov(70 + clamp((speed - 30) * 0.42, 0, 30), dt);
  }

  /** After a crash: stay put and look at the wreck */
  watch(point: Vector3, dt: number) {
    this.up.lerp(WORLD_UP, 1 - Math.exp(-dt * 3)).normalize();
    this.camera.up.copy(this.up);
    this.camera.lookAt(point);
    this.setFov(70, dt);
  }

  private setFov(fov: number, dt: number) {
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
