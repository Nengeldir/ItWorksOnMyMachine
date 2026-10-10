import { smoothstep } from "../../math";
import { type Rng, range } from "../../rng";
import type { Course } from "../course";
import { fbm, type Noise } from "./noise";

// A valley floor that steps down along the racing line, and the water that
// fills it: flat pools (sometimes widening into lakes) that spill over a cliff
// into the next pool. The racing line descends smoothly, so it always flies
// over the edge of every fall. The same steps make icefalls on a glacier and
// lava cascades in the Ember Wastes.

export type WaterKind = "water" | "lava" | "ice" | "glow";

export interface StepSpec {
  length: [number, number]; // metres of z between falls
  clearance: number; // the floor (and water) sits this far below the line at the end of a step
}

export interface RiverSpec {
  kind: WaterKind;
  width: [number, number]; // metres, per pool
  lakes: number; // share of pools that widen into a lake
  meander: number; // metres the river swings around the line
  bank: number; // the valley floor sits this far above the water
  bed: number; // depth of the channel at its middle
}

export interface Pool {
  z0: number;
  z1: number;
  level: number; // floor (or water) height along the step
  width: number; // river width (0 without a river)
  lake: number; // 0..1, widening in the middle
}

export interface Fall {
  z: number;
  top: number;
  bottom: number;
  width: number;
}

const EDGE = 4; // metres over which a step drops

/** The stepped floor, and optionally a river in it */
export class Steps {
  readonly pools: Pool[] = [];
  readonly falls: Fall[] = [];
  readonly river: RiverSpec | null;
  private readonly course: Course;
  private readonly noise: Noise;

  constructor(course: Course, spec: StepSpec, river: RiverSpec | null, rng: Rng, noise: Noise) {
    this.course = course;
    this.river = river;
    this.noise = noise;
    const from = course.start.z - 700;
    const to = course.endZ + 1000;
    for (let z = from; z < to; ) {
      const z1 = Math.min(to, z + range(rng, spec.length[0], spec.length[1]));
      const width = river ? range(rng, river.width[0], river.width[1]) : 0;
      const lake = river && rng() < river.lakes ? range(rng, 0.8, 1.6) : 0;
      this.pools.push({ z0: z, z1, level: course.y(z1) - spec.clearance, width, lake });
      z = z1;
    }
    for (let i = 0; i + 1 < this.pools.length; i++) {
      const a = this.pools[i];
      const b = this.pools[i + 1];
      this.falls.push({ z: a.z1, top: a.level, bottom: b.level, width: Math.min(a.width, b.width) * 0.8 });
    }
  }

  private index(z: number): number {
    // Pools are sorted and contiguous: binary search
    let lo = 0;
    let hi = this.pools.length - 1;
    if (z <= this.pools[0].z0) return 0;
    if (z >= this.pools[hi].z1) return hi;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pools[mid].z1 <= z) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  pool(z: number): Pool {
    return this.pools[this.index(z)];
  }

  /** Floor height along the line: flat steps, dropping over a few metres at each fall */
  level(z: number): number {
    const i = this.index(z);
    const pool = this.pools[i];
    const next = this.pools[i + 1];
    if (next && z > pool.z1 - EDGE) {
      return pool.level + (next.level - pool.level) * smoothstep(pool.z1 - EDGE, pool.z1 + EDGE, z);
    }
    const prev = this.pools[i - 1];
    if (prev && z < pool.z0 + EDGE) {
      return prev.level + (pool.level - prev.level) * smoothstep(pool.z0 - EDGE, pool.z0 + EDGE, z);
    }
    return pool.level;
  }

  /** x of the river's middle */
  center(z: number): number {
    const meander = this.river?.meander ?? 0;
    return this.course.x(z) + meander * fbm(this.noise.n2, z * 0.0035, 4.2, 2);
  }

  /** River width at z: wider in lakes, narrower at the falls */
  width(z: number): number {
    if (!this.river) return 0;
    const pool = this.pool(z);
    const t = (z - pool.z0) / Math.max(1, pool.z1 - pool.z0);
    const lake = pool.lake * Math.sin(Math.PI * t) ** 2;
    const lip = 0.75 + 0.25 * smoothstep(0, 0.08, t) * smoothstep(1, 0.92, t);
    const wobble = 1 + 0.18 * this.noise.n2(z * 0.02, 9.4);
    return pool.width * (1 + lake * 2) * lip * wobble;
  }

  /** Distance to the water's surface; large away from the river. Falls aren't solid: you can fly through them */
  waterDistance(x: number, y: number, z: number): number {
    if (!this.river) return Infinity;
    const lateral = Math.abs(x - this.center(z)) - this.width(z) / 2;
    const above = y - this.pool(z).level;
    if (lateral <= 0) return above;
    return Math.hypot(lateral, above);
  }
}
