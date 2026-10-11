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
 * How much harder an adventure level's line is than the time trial on the same seed, from 0 (the
 * time trial itself, and the first level of a run) to 1 (the last level): the turns swing wider and
 * sharper, the line rises and falls more (with short climbs), gates come closer together and their
 * rings shrink. The land is carved around the line, so it reshapes with it
 */
export interface Difficulty {
  /** Lateral swing of the line, × */
  swing: number;
  /** Frequency of the sharper bends, × */
  bends: number;
  /** Extra short-wavelength wiggles (m) */
  wiggle: number;
  /** How much the slope varies, × (above 2 the line briefly climbs) */
  slopeSwing: number;
  /** Rolling dips and rises added to the slope */
  rolls: number;
  /** Gate spacing, × */
  spacing: number;
  /** Ring radius, metres less */
  shrink: number;
}

export function difficulty(level: number): Difficulty {
  const d = Math.max(0, Math.min(1, level));
  return { swing: 1 + 0.4 * d, bends: 1 + 0.25 * d, wiggle: 18 * d, slopeSwing: 1 + 1.3 * d, rolls: 0.07 * d, spacing: 1 - 0.15 * d, shrink: 1.6 * d };
}

/**
 * The racing line: a descending 3D curve, a function of z, so it never turns back.
 * Gates (obstacles the line threads) sit along it, each with a ring.
 */
export class Course {
  readonly rings: Ring[] = [];
  /** z of each gate */
  readonly gates: number[] = [];
  readonly start: Vector3;
  readonly startDirection: Vector3;
  readonly endZ: number;
  private readonly noise: NoiseFunction2D;
  private readonly z0: number;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  /** 0 for races, time trials and a run's first level; up to 1 for its last (see `Difficulty`) */
  readonly level: number;
  private readonly hard: Difficulty;

  constructor(seed: number, level = 0) {
    this.noise = createNoise2D(makeRng(seed, "line"));
    this.level = level;
    this.hard = difficulty(level);
    const rng = makeRng(seed, "gates");
    // The same draws at every difficulty (level 0 is exactly the frozen map), only spaced closer
    for (let z = 90; z < LENGTH; z += range(rng, 95, 130) * this.hard.spacing) this.gates.push(z);
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
      y -= (SLOPE + SLOPE_SWING * this.hard.slopeSwing * this.noise(z * 0.003, 3.1) + (this.level > 0 ? this.hard.rolls * this.noise(z * 0.011, 5.3) * 3 : 0)) * STEP;
    }

    this.gates.forEach((z, index) => {
      this.rings.push({
        index,
        position: this.pointAt(z),
        normal: this.tangentAt(z),
        radius: RING_RADIUS - this.hard.shrink,
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
    const base = 170 * this.noise(z * 0.0011, 1.3) + 45 * this.noise(z * 0.004, 7.7);
    if (this.level <= 0) return base;
    const h = this.hard;
    return 170 * h.swing * this.noise(z * 0.0011, 1.3) + 45 * h.swing * this.noise(z * 0.004 * h.bends, 7.7) + h.wiggle * this.noise(z * 0.0062, 11.9);
  }

  y(z: number): number {
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
