import * as THREE from "three";
import { Swarm } from "./abilities/models2";
import { FX } from "./tuning";
import { smoothstep } from "./math";

// Sky's light creatures: a small flock of butterflies of light that flutters
// ahead of the pilot and leads the way to the next gate, scattering as it is
// passed and gathering again. Looks only: one instanced draw call, nothing
// allocated per frame.

const COUNT = 8;
const SIZE = 0.7;
const matrix = new THREE.Matrix4();
const lookAt = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const bankQuat = new THREE.Quaternion();
const scale = new THREE.Vector3();
const zero = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const forward = new THREE.Vector3();
const aim = new THREE.Vector3();
const lead = new THREE.Vector3();
const slot = new THREE.Vector3();
const side = new THREE.Vector3();
const heading = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tint = new THREE.Color("#fff3d6");

export class LightFlock {
  private readonly swarm = new Swarm("butterfly", COUNT, ["#fff8ea", "#ffe3aa", "#fff1cf"]);
  private readonly positions: THREE.Vector3[] = [];
  private readonly seeds: number[] = [];
  private shown = 0;
  private scattered = 0;
  private t = 0;
  private placed = false;

  constructor() {
    for (let i = 0; i < COUNT; i++) {
      this.positions.push(new THREE.Vector3());
      this.seeds.push(i * 1.37 + 0.3);
    }
  }

  get mesh(): THREE.Object3D {
    return this.swarm.mesh;
  }

  /** Flung outward when a gate is passed; they gather again ahead over a second or two */
  scatter() {
    this.scattered = 1;
  }

  /** Puts the flock right ahead of the pilot next frame (a respawn, a new level) */
  reset() {
    this.placed = false;
  }

  /**
   * `target` is where the flock leads to (the next gate), `moving` false hides
   * it (frozen, crashed, in the wormhole). Call once a frame
   */
  update(dt: number, pilot: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3 | null, moving: boolean) {
    const want = moving && FX.flock > 0 ? 1 : 0;
    this.shown += (want - this.shown) * (1 - Math.exp(-dt * 2.5));
    this.scattered *= Math.exp(-dt * 1.2);
    this.t += dt;
    this.swarm.begin();
    if (this.shown < 0.01 && !want) {
      this.swarm.end();
      return;
    }
    const speed = velocity.length();
    if (speed > 1) forward.copy(velocity).divideScalar(speed);
    else forward.set(0, 0, 1);
    // Where they gather: ahead of the pilot, bent towards the gate they lead to
    aim.copy(forward);
    if (target) {
      tmp.subVectors(target, pilot);
      const d = tmp.length();
      if (d > 1) aim.addScaledVector(tmp.divideScalar(d), 0.9).normalize();
    }
    const ahead = 9 + smoothstep(20, 80, speed) * 9;
    lead.copy(pilot).addScaledVector(aim, ahead);
    side.crossVectors(aim, up);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const gather = 1 - Math.exp(-dt * 2.2);
    for (let i = 0; i < COUNT; i++) {
      const s = this.seeds[i];
      const p = this.positions[i];
      // Each has a slot in a loose ring round the lead point and wanders on slow sines
      const angle = s * 4.1 + this.t * (0.25 + 0.05 * (i % 3));
      const radius = 2.2 + 1.4 * Math.sin(this.t * 0.7 + s) + this.scattered * 9;
      slot
        .copy(lead)
        .addScaledVector(side, Math.cos(angle) * radius)
        .addScaledVector(up, Math.sin(angle * 0.9 + s) * radius * 0.6 + 1 + this.scattered * 3)
        .addScaledVector(aim, Math.sin(this.t * 1.1 + s * 2) * 1.5);
      if (!this.placed) p.copy(slot);
      tmp.copy(p);
      p.lerp(slot, gather);
      // Facing where it moves, mostly where the flock goes; a little banking
      heading.subVectors(p, tmp).divideScalar(Math.max(dt, 1e-3));
      if (heading.lengthSq() < 0.25) heading.copy(aim);
      else heading.normalize();
      heading.lerp(aim, 0.4).normalize();
      if (Math.abs(heading.y) > 0.95) heading.set(heading.x + 0.1, heading.y * 0.9, heading.z + 0.1).normalize();
      // The creatures are built flying along -z: lookAt from the origin towards the heading does that
      lookAt.lookAt(zero, heading, up);
      quat.setFromRotationMatrix(lookAt);
      bankQuat.setFromAxisAngle(Z, Math.sin(this.t * 2.3 + s) * 0.5);
      quat.multiply(bankQuat);
      matrix.compose(p, quat, scale.setScalar(SIZE));
      this.swarm.add(matrix, s * 3, 5 + (i % 3) * 0.8, 0.95, this.shown * 0.9, tint);
    }
    this.placed = true;
    this.swarm.end();
  }

  dispose() {
    this.swarm.dispose();
  }
}
