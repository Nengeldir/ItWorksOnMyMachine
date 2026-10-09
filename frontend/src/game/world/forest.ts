import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { makeRng } from "../rng";
import type { Course } from "./course";
import type { Obstacle } from "./obstacles";
import { CHUNK_SIZE, SNOW_LINE, type Terrain, clamp, smoothstep } from "./terrain";

const SPACING = 15; // metres between tree candidates
const PER_SIDE = Math.floor(CHUNK_SIZE / SPACING);
const TREE_LINE = 0.8 * SNOW_LINE; // no trees this high above the valley floor
const LINE_CLEARANCE = 16; // keep the racing line clear
const BUCKET = 32;

/** A low-poly pine: a cone from the ground up, for collisions */
export class Tree implements Obstacle {
  readonly kind = "tree";
  readonly x: number;
  readonly z: number;
  readonly ground: number;
  readonly height: number;
  readonly radius: number; // of the lowest branches
  readonly bound: number;

  constructor(x: number, z: number, ground: number, height: number, radius: number) {
    this.x = x;
    this.z = z;
    this.ground = ground;
    this.height = height;
    this.radius = radius;
    this.bound = radius;
  }

  distance(x: number, y: number, z: number): number {
    const top = this.ground + this.height;
    const t = clamp((y - this.ground) / this.height, 0, 1);
    // 6-sided cones: the flat faces sit at ~0.9 of the radius
    const side = Math.hypot(x - this.x, z - this.z) - this.radius * 0.9 * (1 - t);
    if (y <= top) return side;
    return Math.hypot(Math.max(side, 0), y - top);
  }
}

/**
 * Forests, generated chunk by chunk from the seed, the same on every client.
 * The trees in a chunk only depend on the seed and the chunk's position, so they
 * can be made in any order, for drawing or for collisions.
 */
export class Forest {
  private readonly seed: number;
  private readonly terrain: Terrain;
  private readonly course: Course;
  private readonly lineZ: number[];
  private readonly noise: NoiseFunction2D;
  private readonly chunks = new Map<number, Tree[]>();
  private readonly buckets = new Map<number, Tree[]>();
  private readonly reach: number;
  private lastCenter = NaN;

  /** `reach`: distances to trees are exact up to this far */
  constructor(seed: number, terrain: Terrain, course: Course, reach: number) {
    this.seed = seed;
    this.terrain = terrain;
    this.course = course;
    this.lineZ = course.line.map((p) => p.z);
    this.noise = createNoise2D(makeRng(seed, "forest"));
    this.reach = reach;
  }

  /** 0..1: how dense the forest is here (it also darkens the ground) */
  density(x: number, z: number): number {
    return smoothstep(-0.2, 0.4, this.noise(x * 0.0035, z * 0.0035) + 0.25 * this.noise(x * 0.02, z * 0.02));
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  /** The trees of one terrain chunk */
  trees(ix: number, iz: number): Tree[] {
    const key = this.key(ix, iz);
    let trees = this.chunks.get(key);
    if (!trees) {
      trees = this.generate(ix, iz);
      this.chunks.set(key, trees);
      for (const tree of trees) this.addToBuckets(tree);
    }
    return trees;
  }

  private generate(ix: number, iz: number): Tree[] {
    const { terrain } = this;
    const rng = makeRng(this.seed, `trees:${ix},${iz}`);
    const trees: Tree[] = [];
    for (let gz = 0; gz < PER_SIDE; gz++) {
      for (let gx = 0; gx < PER_SIDE; gx++) {
        // Always draw the same numbers per spot, so one spot never shifts another
        const x = ix * CHUNK_SIZE + (gx + rng()) * SPACING;
        const z = iz * CHUNK_SIZE + (gz + rng()) * SPACING;
        const keep = rng();
        const size = rng();
        const shape = rng();
        if (keep > this.density(x, z) * 0.85) continue;
        if (Math.abs(x - terrain.centerX(z)) < terrain.riverWidth(z) * 2.1 + 3) continue;

        const ground = terrain.height(x, z);
        const above = ground - terrain.floorY(z);
        if (above > TREE_LINE * (0.8 + 0.4 * size)) continue; // a ragged tree line
        const slopeX = (terrain.rawHeight(x + 5, z) - terrain.rawHeight(x - 5, z)) / 10;
        const slopeZ = (terrain.rawHeight(x, z + 5) - terrain.rawHeight(x, z - 5)) / 10;
        if (slopeX * slopeX + slopeZ * slopeZ > 0.8) continue; // too steep

        // Smaller near the tree line
        const height = (11 + 17 * size) * (1 - 0.4 * smoothstep(TREE_LINE * 0.5, TREE_LINE, above));
        const tree = new Tree(x, z, ground - 0.5, height, height * (0.2 + 0.08 * shape));
        if (this.clearOfCourse(tree)) trees.push(tree);
      }
    }
    return trees;
  }

  private clearOfCourse(tree: Tree): boolean {
    // The line runs along z, so only look at the stretch beside the tree
    const { line, rings } = this.course;
    let lo = 0;
    let hi = this.lineZ.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.lineZ[mid] < tree.z - 40) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < line.length && this.lineZ[i] < tree.z + 40; i++) {
      const p = line[i];
      if (tree.distance(p.x, p.y, p.z) < LINE_CLEARANCE) return false;
    }
    for (const ring of rings) {
      const p = ring.position;
      if (Math.abs(p.z - tree.z) < 40 && tree.distance(p.x, p.y, p.z) < ring.radius + 6) return false;
    }
    return true;
  }

  private addToBuckets(tree: Tree) {
    const r = tree.bound + this.reach;
    for (let bx = Math.floor((tree.x - r) / BUCKET); bx <= Math.floor((tree.x + r) / BUCKET); bx++) {
      for (let bz = Math.floor((tree.z - r) / BUCKET); bz <= Math.floor((tree.z + r) / BUCKET); bz++) {
        const key = this.key(bx, bz);
        const list = this.buckets.get(key);
        if (list) list.push(tree);
        else this.buckets.set(key, [tree]);
      }
    }
  }

  /** Distance to the nearest tree, or Infinity when none is within reach */
  distance(x: number, y: number, z: number): number {
    // Trees near a chunk edge can belong to the neighbour, so make sure all 9 exist
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const center = this.key(cx, cz);
    if (center !== this.lastCenter) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.trees(cx + dx, cz + dz);
      this.lastCenter = center;
    }
    const list = this.buckets.get(this.key(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
    let best = Infinity;
    if (list) {
      for (const tree of list) {
        const d = tree.distance(x, y, z);
        if (d < best) best = d;
      }
    }
    return best;
  }
}
