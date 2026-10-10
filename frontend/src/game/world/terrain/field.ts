import { smin } from "../../math";
import { type Course, TUBE_RADIUS } from "../course";
import type { Ground } from "./ground";
import type { Noise } from "./noise";
import { Grain, type Shape } from "./shapes";

// The land of a generator-v2 biome as one signed distance field: the ground
// (if the biome has one) melted together with rock shapes, roughened along each
// part's grain, with the racing tube carved out of everything. The mesher
// samples whole blocks of it at once (`fill`), and collisions ask single points
// (`distance`); both run the same arithmetic in the same order, so the meshes
// and the collisions agree exactly.

/** Distance reported far away from any land */
const EMPTY = 40;
/** Shapes closer than this melt into each other */
const BLEND = 6;
/** Distances are exact up to this far from the land (proximity scoring needs ~12 m) */
const REACH = 16;
const CELL = 40;

export class TerrainField {
  readonly ground: Ground | null;
  readonly shapes: Shape[] = [];
  /** Surface id painted on the ground */
  readonly groundSurface: number;
  private readonly course: Course;
  readonly noise: Noise;
  private readonly cells = new Map<number, Shape[]>();
  private readonly groundRough: number;

  constructor(course: Course, ground: Ground | null, groundSurface: number, noise: Noise) {
    this.course = course;
    this.ground = ground;
    this.groundSurface = groundSurface;
    this.noise = noise;
    this.groundRough = ground?.spec.roughness ?? 0;
  }

  /** Adds a shape, unless it would block the start line (racers spawn there side by side) */
  add(shape: Shape): boolean {
    const s = this.course.start;
    const dx = Math.max(shape.min.x - s.x, 0, s.x - shape.max.x);
    const dy = Math.max(shape.min.y - s.y, 0, s.y - shape.max.y);
    const dz = Math.max(shape.min.z - s.z, 0, s.z - shape.max.z);
    if (Math.hypot(dx, dy, dz) < 40) return false;
    this.shapes.push(shape);
    for (let ix = Math.floor((shape.min.x - REACH) / CELL); ix <= Math.floor((shape.max.x + REACH) / CELL); ix++) {
      for (let iy = Math.floor((shape.min.y - REACH) / CELL); iy <= Math.floor((shape.max.y + REACH) / CELL); iy++) {
        for (let iz = Math.floor((shape.min.z - REACH) / CELL); iz <= Math.floor((shape.max.z + REACH) / CELL); iz++) {
          const key = cellKey(ix, iy, iz);
          const list = this.cells.get(key);
          if (list) list.push(shape);
          else this.cells.set(key, [shape]);
        }
      }
    }
    return true;
  }

  /** Signed distance to the land, positive in the air */
  distance(x: number, y: number, z: number): number {
    let d = EMPTY;
    let nearest = Infinity;
    let rough = 0;
    let grain: Grain = Grain.Lumpy;
    if (this.ground) {
      d = this.ground.distance(x, y, z);
      nearest = d;
      rough = this.groundRough;
    }
    const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL)));
    if (list) {
      for (const shape of list) {
        if (!near(shape, x, y, z)) continue;
        const ds = shape.distance(x, y, z);
        if (ds < nearest) {
          nearest = ds;
          rough = shape.roughness;
          grain = shape.grain;
        }
        d = smin(d, ds, BLEND);
      }
    }
    return this.finish(d, rough, grain, x, y, z);
  }

  /** Roughness along the nearest part's grain, then the racing tube */
  private finish(d: number, rough: number, grain: Grain, x: number, y: number, z: number): number {
    if (d > rough * 1.4 + REACH) return d;
    if (rough > 0) d += rough * grainNoise(this.noise, grain, x, y, z);
    if (d < TUBE_RADIUS) d = Math.max(d, TUBE_RADIUS - this.course.distance(x, y, z));
    return d;
  }

  /** Which surface the land nearest to a point is painted with */
  surfaceAt(x: number, y: number, z: number): number {
    let nearest = this.ground ? this.ground.distance(x, y, z) : Infinity;
    let surface = this.groundSurface;
    const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL)));
    if (list) {
      for (const shape of list) {
        if (!near(shape, x, y, z)) continue;
        const ds = shape.distance(x, y, z);
        if (ds < nearest) {
          nearest = ds;
          surface = shape.surface;
        }
      }
    }
    return surface;
  }

  /**
   * Samples an n×n×n block of the field (origin `o`, spacing `step`) into `out`,
   * x fastest. Returns false, leaving `out` untouched, if the block is plainly
   * all air or all rock. Same results as `distance` for every sample.
   */
  fill(ox: number, oy: number, oz: number, step: number, n: number, out: Float32Array): boolean {
    const span = step * (n - 1);
    const shapes = this.shapes.filter(
      (s) =>
        s.max.x + REACH >= ox && s.min.x - REACH <= ox + span &&
        s.max.y + REACH >= oy && s.min.y - REACH <= oy + span &&
        s.max.z + REACH >= oz && s.min.z - REACH <= oz + span,
    );
    const ground = this.ground;
    const columns = n * n;
    const h = new Float64Array(columns);
    const gx = new Float64Array(columns);
    const gz = new Float64Array(columns);
    if (ground) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < n; k++) {
        const z = oz + k * step;
        const lineX = this.course.x(z);
        const lineY = this.course.y(z);
        for (let i = 0; i < n; i++) {
          const x = ox + i * step;
          const c = i + n * k;
          h[c] = ground.heightAt(x, z, lineX, lineY);
          gx[c] = ground.heightAt(x + 1, z, lineX, lineY) - h[c];
          gz[c] = ground.height(x, z + 1) - h[c];
          if (h[c] < lo) lo = h[c];
          if (h[c] > hi) hi = h[c];
        }
      }
      // Wholly above or below the ground, and no shapes: nothing to mesh
      const margin = ground.spec.overhang * 2 + this.groundRough * 2 + 24;
      if (!shapes.length && (oy > hi + margin || oy + span < lo - margin)) return false;
    } else if (!shapes.length) {
      return false;
    }

    for (let k = 0; k < n; k++) {
      const z = oz + k * step;
      for (let j = 0; j < n; j++) {
        const y = oy + j * step;
        for (let i = 0; i < n; i++) {
          const x = ox + i * step;
          let d = EMPTY;
          let nearest = Infinity;
          let rough = 0;
          let grain: Grain = Grain.Lumpy;
          if (ground) {
            const c = i + n * k;
            d = ground.shape(x, y, z, h[c], gx[c], gz[c]);
            nearest = d;
            rough = this.groundRough;
          }
          for (const shape of shapes) {
            if (!near(shape, x, y, z)) continue;
            const ds = shape.distance(x, y, z);
            if (ds < nearest) {
              nearest = ds;
              rough = shape.roughness;
              grain = shape.grain;
            }
            d = smin(d, ds, BLEND);
          }
          out[i + n * (j + n * k)] = this.finish(d, rough, grain, x, y, z);
        }
      }
    }
    return true;
  }

  /** Lowest and highest land over a rectangle, or null if there is none */
  columnRange(x0: number, z0: number, x1: number, z1: number): [number, number] | null {
    let lo = Infinity;
    let hi = -Infinity;
    if (this.ground) [lo, hi] = this.ground.range(x0, z0, x1, z1);
    for (const s of this.shapes) {
      if (s.max.x < x0 || s.min.x > x1 || s.max.z < z0 || s.min.z > z1) continue;
      if (s.min.y < lo) lo = s.min.y;
      if (s.max.y > hi) hi = s.max.y;
    }
    return lo <= hi ? [lo, hi] : null;
  }
}

function cellKey(ix: number, iy: number, iz: number): number {
  return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
}

/** Is the point within reach of the shape's box? */
function near(s: Shape, x: number, y: number, z: number): boolean {
  return (
    x > s.min.x - REACH && x < s.max.x + REACH &&
    y > s.min.y - REACH && y < s.max.y + REACH &&
    z > s.min.z - REACH && z < s.max.z + REACH
  );
}

/** Surface noise, about -1..1.35, running along the grain */
export function grainNoise(noise: Noise, grain: Grain, x: number, y: number, z: number): number {
  const n = noise.n3;
  switch (grain) {
    case Grain.Fluted:
      return n(x * 0.075, y * 0.012, z * 0.075) + 0.35 * n(x * 0.19, y * 0.03, z * 0.19);
    case Grain.Layered:
      return n(x * 0.02, y * 0.1, z * 0.02) + 0.35 * n(x * 0.05, y * 0.24, z * 0.05);
    case Grain.Sharp:
      return 1 - 2 * Math.abs(n(x * 0.05, y * 0.05, z * 0.05)) + 0.3 * n(x * 0.15, y * 0.15, z * 0.15);
    default:
      return n(x * 0.045, y * 0.045, z * 0.045) + 0.35 * n(x * 0.13, y * 0.13, z * 0.13);
  }
}
