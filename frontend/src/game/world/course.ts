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
/** Metres of z per block of an endless line: its gates, land and scenery are made a block at a time */
export const BLOCK = 1024;
/** Gates keep this far apart where two blocks meet (inside a block they are 95 to 130 m apart) */
const BLOCK_GATE_MARGIN = 45;
/** An endless line refuses to be sampled further than this many samples out (a bug, not a flight) */
const MAX_SAMPLES = 5_000_000;

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
 * An endless line (Zen) has no end and no rings: it is sampled further as it is
 * asked for, forwards and backwards, and its gates come a block at a time
 * (`gatesIn`). Its samples are always added up in the same order from the
 * start, so every worker gets the same heights whatever it asks first.
 */
export class Course {
  readonly rings: Ring[] = [];
  /** z of each gate (an endless line: none, see `gatesIn`) */
  readonly gates: number[] = [];
  readonly start: Vector3;
  readonly startDirection: Vector3;
  /** z of the finish (an endless line: Infinity) */
  readonly endZ: number;
  readonly endless: boolean;
  private readonly seed: number;
  private readonly noise: NoiseFunction2D;
  private readonly z0: number;
  // Samples at z0 + i·STEP for i >= 0; an endless line also has bxs/bys at z0 - (k + 1)·STEP
  private xs: Float64Array;
  private ys: Float64Array;
  private bxs = new Float64Array(0);
  private bys = new Float64Array(0);
  private ahead = 0; // endless: samples made forwards (i < ahead)…
  private behind = 0; // …and backwards (k < behind)
  private readonly blockGates = new Map<number, number[]>();

  constructor(seed: number, endless = false) {
    this.seed = seed;
    this.endless = endless;
    this.noise = createNoise2D(makeRng(seed, "line"));
    // Sampled densely: heights come from adding up the slope, and distance queries are fast
    this.z0 = START_Z - 60;
    if (endless) {
      this.endZ = Infinity;
      this.xs = new Float64Array(1024);
      this.ys = new Float64Array(1024);
      this.xs[0] = this.x(this.z0);
      this.ahead = 1;
    } else {
      const rng = makeRng(seed, "gates");
      for (let z = 90; z < LENGTH; z += range(rng, 95, 130)) this.gates.push(z);
      this.endZ = LENGTH + 80;

      const count = Math.ceil((this.endZ + 1000 - this.z0) / STEP);
      this.xs = new Float64Array(count);
      this.ys = new Float64Array(count);
      let y = 0;
      for (let i = 0; i < count; i++) {
        const z = this.z0 + i * STEP;
        this.xs[i] = this.x(z);
        this.ys[i] = y;
        y -= this.slope(z) * STEP;
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
    }

    this.start = this.pointAt(START_Z);
    this.startDirection = this.pointAt(START_Z + 120).sub(this.start).normalize();
  }

  /** Metres the line drops per metre forward at z */
  private slope(z: number): number {
    return SLOPE + SLOPE_SWING * this.noise(z * 0.003, 3.1);
  }

  x(z: number): number {
    return 170 * this.noise(z * 0.0011, 1.3) + 45 * this.noise(z * 0.004, 7.7);
  }

  y(z: number): number {
    if (this.endless) {
      const f = (z - this.z0) / STEP;
      const i = Math.floor(f);
      if (i + 1 >= this.ahead || -i - 1 >= this.behind) this.extend(i, i + 1);
      const a = this.sy(i);
      return a + (this.sy(i + 1) - a) * (f - i);
    }
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

  /**
   * An endless line's gates in block `b` (z from b·BLOCK to (b + 1)·BLOCK), from the block's own
   * stream: the same whenever and wherever they are asked for. None just around the start.
   */
  gatesIn(b: number): number[] {
    let list = this.blockGates.get(b);
    if (!list) {
      list = [];
      const rng = makeRng(this.seed, `gates/${b}`);
      const end = (b + 1) * BLOCK - BLOCK_GATE_MARGIN;
      for (let z = b * BLOCK + range(rng, 50, 110); z < end; z += range(rng, 95, 130)) {
        if (z < START_Z - 40 || z >= 90) list.push(z);
      }
      this.blockGates.set(b, list);
    }
    return list;
  }

  /** Distance from a point to the racing line (exact within a few tube radii, else at least that) */
  distance(px: number, py: number, pz: number): number {
    const reach = TUBE_RADIUS + 10;
    let first = Math.floor((pz - reach - this.z0) / STEP);
    let last = Math.ceil((pz + reach - this.z0) / STEP);
    if (this.endless) {
      if (last + 1 >= this.ahead || -first - 1 >= this.behind) this.extend(first, last + 1);
    } else {
      first = Math.max(0, first);
      last = Math.min(this.xs.length - 2, last);
    }
    let best = Infinity;
    for (let i = first; i <= last; i++) {
      // Point to segment, in 3D
      const ax = this.sx(i);
      const ay = this.sy(i);
      const az = this.z0 + i * STEP;
      const dx = this.sx(i + 1) - ax;
      const dy = this.sy(i + 1) - ay;
      const dz = STEP;
      const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / (dx * dx + dy * dy + dz * dz)));
      const d = Math.hypot(px - ax - dx * t, py - ay - dy * t, pz - az - dz * t);
      if (d < best) best = d;
    }
    return best;
  }

  private sx(i: number): number {
    return i >= 0 ? this.xs[i] : this.bxs[-i - 1];
  }

  private sy(i: number): number {
    return i >= 0 ? this.ys[i] : this.bys[-i - 1];
  }

  /** An endless line: makes the samples from i0 to i1 (either may be negative), adding up from the start */
  private extend(i0: number, i1: number) {
    if (!(Math.abs(i0) < MAX_SAMPLES && Math.abs(i1) < MAX_SAMPLES)) throw new Error(`The endless line was asked for z ${this.z0 + i1 * STEP}`);
    while (i1 >= this.ahead) {
      if (this.ahead === this.xs.length) {
        this.xs = grow(this.xs);
        this.ys = grow(this.ys);
      }
      const i = this.ahead++;
      const z = this.z0 + i * STEP;
      this.xs[i] = this.x(z);
      this.ys[i] = this.ys[i - 1] - this.slope(z - STEP) * STEP;
    }
    while (-i0 - 1 >= this.behind) {
      if (this.behind === this.bxs.length) {
        this.bxs = grow(this.bxs);
        this.bys = grow(this.bys);
      }
      const k = this.behind++;
      const z = this.z0 - (k + 1) * STEP;
      this.bxs[k] = this.x(z);
      // The step down from here to the sample after it, the same sum as going forwards
      this.bys[k] = (k === 0 ? this.ys[0] : this.bys[k - 1]) + this.slope(z) * STEP;
    }
  }
}

function grow(array: Float64Array): Float64Array<ArrayBuffer> {
  const bigger = new Float64Array(Math.max(1024, array.length * 2));
  bigger.set(array);
  return bigger;
}
