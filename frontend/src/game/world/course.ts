import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { Vector3 } from "three";
import { makeRng, range } from "../rng";

/** The racing line is always this clear of rock: a tube carved through everything */
export const TUBE_RADIUS = 11;
export const RING_RADIUS = 8;
export const FINISH_RADIUS = 12;
const LENGTH = 2200; // metres of z from the start to the last gate
const START_Z = -80;
// The line drops 0.22 m per metre forward on average, and always drops at least
// 0.12: a wingsuit can't climb for long, so the line never asks it to
const SLOPE = 0.22;
const SLOPE_SWING = 0.1;
const STEP = 2; // metres of z between line samples

export interface Ring {
  index: number;
  position: Vector3;
  normal: Vector3; // the direction you fly through it
  radius: number;
  finish: boolean;
}

/**
 * The racing line: a descending 3D curve, a function of z, so it never turns back.
 * Gates (obstacles the line threads) sit along it, each with a ring.
 *
 * An open world (Zen) has no line: its course is level at y = 0 along z, with no
 * gates, no rings, no end and no tube carved through the land, so the land
 * around it is the same in every direction. y = 0 is the height the open world's
 * land is measured from, where a line's land is measured from the line.
 */
export class Course {
  readonly rings: Ring[] = [];
  /** z of each gate */
  readonly gates: number[] = [];
  readonly start: Vector3;
  readonly startDirection: Vector3;
  readonly endZ: number;
  readonly open: boolean;
  private readonly noise: NoiseFunction2D;
  private readonly z0: number;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;

  constructor(seed: number, open = false) {
    this.open = open;
    this.noise = createNoise2D(makeRng(seed, "line"));
    if (open) {
      this.endZ = Infinity;
      this.z0 = START_Z;
      this.xs = this.ys = new Float64Array(0);
      this.start = this.pointAt(START_Z);
      this.startDirection = new Vector3(0, 0, 1);
      return;
    }
    const rng = makeRng(seed, "gates");
    for (let z = 90; z < LENGTH; z += range(rng, 95, 130)) this.gates.push(z);
    this.endZ = LENGTH + 80;

    // Sampled densely: heights come from adding up the slope, and distance queries are fast
    this.z0 = START_Z - 60;
    const count = Math.ceil((this.endZ + 1000 - this.z0) / STEP);
    this.xs = new Float64Array(count);
    this.ys = new Float64Array(count);
    let y = 0;
    for (let i = 0; i < count; i++) {
      const z = this.z0 + i * STEP;
      this.xs[i] = this.x(z);
      this.ys[i] = y;
      y -= (SLOPE + SLOPE_SWING * this.noise(z * 0.003, 3.1)) * STEP;
    }

    this.gates.forEach((z, index) => {
      this.rings.push({
        index,
        position: this.pointAt(z),
        normal: this.tangentAt(z),
        radius: RING_RADIUS,
        finish: false,
      });
    });
    this.rings.push({
      index: this.gates.length,
      position: this.pointAt(this.endZ),
      normal: this.tangentAt(this.endZ),
      radius: FINISH_RADIUS,
      finish: true,
    });

    this.start = this.pointAt(START_Z);
    this.startDirection = this.pointAt(START_Z + 120).sub(this.start).normalize();
  }

  x(z: number): number {
    if (this.open) return 0;
    return 170 * this.noise(z * 0.0011, 1.3) + 45 * this.noise(z * 0.004, 7.7);
  }

  y(z: number): number {
    if (this.open) return 0;
    const f = Math.min(Math.max((z - this.z0) / STEP, 0), this.ys.length - 1.001);
    const i = Math.floor(f);
    return this.ys[i] + (this.ys[i + 1] - this.ys[i]) * (f - i);
  }

  pointAt(z: number, out = new Vector3()): Vector3 {
    return out.set(this.x(z), this.y(z), z);
  }

  tangentAt(z: number, out = new Vector3()): Vector3 {
    return out.set(this.x(z + 2) - this.x(z - 2), this.y(z + 2) - this.y(z - 2), 4).normalize();
  }

  /** Distance from a point to the racing line (exact within a few tube radii, else at least that) */
  distance(px: number, py: number, pz: number): number {
    if (this.open) return Infinity;
    const reach = TUBE_RADIUS + 10;
    const first = Math.max(0, Math.floor((pz - reach - this.z0) / STEP));
    const last = Math.min(this.xs.length - 2, Math.ceil((pz + reach - this.z0) / STEP));
    let best = Infinity;
    for (let i = first; i <= last; i++) {
      // Point to segment, in 3D
      const ax = this.xs[i];
      const ay = this.ys[i];
      const az = this.z0 + i * STEP;
      const dx = this.xs[i + 1] - ax;
      const dy = this.ys[i + 1] - ay;
      const dz = STEP;
      const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / (dx * dx + dy * dy + dz * dz)));
      const d = Math.hypot(px - ax - dx * t, py - ay - dy * t, pz - az - dz * t);
      if (d < best) best = d;
    }
    return best;
  }
}
