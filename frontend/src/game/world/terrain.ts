import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { makeRng } from "../rng";

// The terrain is a heightmap: a river valley that keeps dropping, so a wingsuit
// can glide down it for kilometres, between forested foothills and ridged,
// snow-capped peaks. The meshes sample it on a grid, and collisions use the
// same grid, so what you see is what you hit.
export const CELL = 10; // metres between terrain vertices: big, low-poly facets
export const CHUNK_CELLS = 32;
export const CHUNK_SIZE = CELL * CHUNK_CELLS;
export const DESCENT = 0.18; // the valley floor drops this many metres per metre of forward
/** Snow starts this high above the valley floor */
export const SNOW_LINE = 190;

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
  private readonly hills: NoiseFunction2D;
  private readonly peaks: NoiseFunction2D;

  constructor(seed: number) {
    this.path = createNoise2D(makeRng(seed, "path"));
    this.width = createNoise2D(makeRng(seed, "width"));
    this.floor = createNoise2D(makeRng(seed, "floor"));
    this.detail = createNoise2D(makeRng(seed, "detail"));
    this.hills = createNoise2D(makeRng(seed, "hills"));
    this.peaks = createNoise2D(makeRng(seed, "peaks"));
  }

  /** x of the river (the valley's middle) at depth z */
  centerX(z: number): number {
    return 260 * this.path(z * 0.0007, 0.5) + 60 * this.path(z * 0.0025, 7.5);
  }

  /** Half the width of the valley floor, from the river to the foot of the slopes */
  halfWidth(z: number): number {
    return 110 + 45 * this.width(z * 0.0017, 1.5);
  }

  /** Half the river's width */
  riverWidth(z: number): number {
    return 12 + 5 * this.width(z * 0.004, 9.5);
  }

  /** Height of the valley floor, without the small bumps */
  floorY(z: number): number {
    return -DESCENT * z + 10 * this.floor(z * 0.003, 3.5);
  }

  /** Height of the river's surface */
  waterLevel(z: number): number {
    return this.floorY(z) - 1.5;
  }

  /** Ridged noise, 0..1: sharp crests like the edges of a low-poly mountain */
  private ridged(x: number, z: number): number {
    let sum = 0;
    let norm = 0;
    let amplitude = 1;
    let frequency = 0.0021;
    let weight = 1;
    for (let octave = 0; octave < 4; octave++) {
      let n = 1 - Math.abs(this.peaks(x * frequency + octave * 17.3, z * frequency - octave * 9.1));
      n *= n * weight;
      weight = clamp(n * 2, 0, 1);
      sum += n * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2.2;
    }
    return sum / norm;
  }

  /** The exact terrain function, before it is sampled on the grid */
  rawHeight(x: number, z: number): number {
    const adx = Math.abs(x - this.centerX(z));
    const w = this.halfWidth(z);
    const river = this.riverWidth(z);
    let h = this.floorY(z);

    // Meadow bumps, smoothed out towards the river, and the river's channel
    const bank = smoothstep(river, river * 2.2, adx);
    h += bank * (3 * this.detail(x * 0.02, z * 0.02) + 1.5 * this.detail(x * 0.06 + 31, z * 0.06));
    h -= (1 - bank) * 4.5;

    // Foothills rising out of the valley
    const rise = smoothstep(w * 0.7, w + 120, adx);
    h += rise * (40 + 30 * this.hills(x * 0.004, z * 0.004));

    // The mountains, starting a varying distance from the river
    const foot = w + 40 + 60 * this.hills(z * 0.002, 4.5);
    const mountain = smoothstep(foot, foot + 320, adx);
    h += mountain * (140 + 580 * Math.pow(this.ridged(x, z), 1.3));
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

  /** Distance down to the river's surface, or Infinity away from the river */
  waterDistance(x: number, y: number, z: number): number {
    if (Math.abs(x - this.centerX(z)) > this.riverWidth(z) * 1.9) return Infinity;
    return y - this.waterLevel(z);
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
