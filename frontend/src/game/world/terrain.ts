import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { makeRng } from "../rng";

// The terrain is a heightmap: a meandering canyon that keeps dropping, so a
// wingsuit can glide down it for kilometres. The meshes sample it on a grid,
// and collisions use the same grid, so what you see is what you hit.
export const CELL = 8; // metres between terrain vertices
export const CHUNK_CELLS = 32;
export const CHUNK_SIZE = CELL * CHUNK_CELLS;
export const DESCENT = 0.22; // the canyon floor drops this many metres per metre of forward

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export class Terrain {
  private readonly path: NoiseFunction2D;
  private readonly width: NoiseFunction2D;
  private readonly floor: NoiseFunction2D;
  private readonly detail: NoiseFunction2D;
  private readonly ridges: NoiseFunction2D;
  private readonly massif: NoiseFunction2D;

  constructor(seed: number) {
    this.path = createNoise2D(makeRng(seed, "path"));
    this.width = createNoise2D(makeRng(seed, "width"));
    this.floor = createNoise2D(makeRng(seed, "floor"));
    this.detail = createNoise2D(makeRng(seed, "detail"));
    this.ridges = createNoise2D(makeRng(seed, "ridges"));
    this.massif = createNoise2D(makeRng(seed, "massif"));
  }

  /** x of the canyon's middle at depth z */
  centerX(z: number): number {
    return 240 * this.path(z * 0.0008, 0.5) + 70 * this.path(z * 0.003, 7.5);
  }

  /** Half the width of the flat canyon floor */
  halfWidth(z: number): number {
    return 75 + 35 * this.width(z * 0.002, 1.5);
  }

  /** Height of the canyon floor, without the small bumps */
  floorY(z: number): number {
    return -DESCENT * z + 12 * this.floor(z * 0.004, 3.5);
  }

  /** The exact terrain function, before it is sampled on the grid */
  rawHeight(x: number, z: number): number {
    const adx = Math.abs(x - this.centerX(z));
    const w = this.halfWidth(z);
    let h = this.floorY(z);

    // Bumps on the canyon floor
    h += 5 * this.detail(x * 0.017, z * 0.017) + 2 * this.detail(x * 0.05 + 31, z * 0.05);

    // Steep walls up to a ridged rim
    const wall = smoothstep(w, w + 85, adx);
    const ridge = 1 - Math.abs(this.ridges(x * 0.011, z * 0.011));
    const rim = 150 + 60 * this.massif(z * 0.0025, 5.5) + 25 * this.massif(x * 0.004, z * 0.004);
    h += wall * (rim + ridge * ridge * 40);

    // Mountains beyond the rim keep rising, so the canyon is the fast way down
    const beyond = Math.max(0, adx - w - 140);
    h += beyond * (0.45 + 0.25 * this.massif(x * 0.002 + 9, z * 0.002));
    return h;
  }

  /** Height of the rendered surface: the grid samples, interpolated per triangle */
  height(x: number, z: number): number {
    return this.sample(x, z, false);
  }

  /** Signed distance to the rendered surface, positive above it (exact near flat ground) */
  distance(x: number, y: number, z: number): number {
    return this.sample(x, z, true, y);
  }

  private sample(x: number, z: number, distance: boolean, y = 0): number {
    const gx = x / CELL;
    const gz = z / CELL;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const x0 = ix * CELL;
    const z0 = iz * CELL;
    const h00 = this.rawHeight(x0, z0);
    const h11 = this.rawHeight(x0 + CELL, z0 + CELL);

    // Each cell is split along its 00-11 diagonal, like the chunk meshes
    let a: number;
    let b: number;
    if (fz > fx) {
      const h01 = this.rawHeight(x0, z0 + CELL);
      a = h11 - h01;
      b = h01 - h00;
    } else {
      const h10 = this.rawHeight(x0 + CELL, z0);
      a = h10 - h00;
      b = h11 - h10;
    }
    const h = h00 + a * fx + b * fz;
    if (!distance) return h;
    const sx = a / CELL;
    const sz = b / CELL;
    return (y - h) / Math.sqrt(1 + sx * sx + sz * sz);
  }
}
