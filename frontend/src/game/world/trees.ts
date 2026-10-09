import { clamp } from "../math";

/** A low-poly pine: a cone from the ground up, for collisions */
export class Tree {
  readonly x: number;
  readonly z: number;
  readonly ground: number;
  readonly height: number;
  readonly radius: number; // of the lowest branches

  constructor(x: number, z: number, ground: number, height: number, radius: number) {
    this.x = x;
    this.z = z;
    this.ground = ground;
    this.height = height;
    this.radius = radius;
  }

  distance(x: number, y: number, z: number): number {
    const top = this.ground + this.height;
    const t = clamp((y - this.ground) / this.height, 0, 1);
    // 6-sided cones: the flat faces sit at ~0.9 of the radius
    const side = Math.hypot(x - this.x, z - this.z) - this.radius * 0.9 * (1 - t);
    if (y > top) return Math.hypot(Math.max(side, 0), y - top);
    if (y < this.ground) return Math.hypot(Math.max(side, 0), this.ground - y);
    return side;
  }
}

const BUCKET = 32;

/** Trees by area, for collisions. Chunks add theirs as their meshes arrive. */
export class TreeIndex {
  private readonly buckets = new Map<number, Tree[]>();
  private readonly chunks = new Set<number>();
  private readonly reach: number;

  /** Distances are exact up to `reach` metres from a tree */
  constructor(reach: number) {
    this.reach = reach;
  }

  private key(bx: number, bz: number): number {
    return (bx + 32768) * 65536 + (bz + 32768);
  }

  /** Adds a chunk's trees, once */
  add(chunk: number, trees: Tree[]) {
    if (this.chunks.has(chunk)) return;
    this.chunks.add(chunk);
    for (const tree of trees) {
      const r = tree.radius + this.reach;
      for (let bx = Math.floor((tree.x - r) / BUCKET); bx <= Math.floor((tree.x + r) / BUCKET); bx++) {
        for (let bz = Math.floor((tree.z - r) / BUCKET); bz <= Math.floor((tree.z + r) / BUCKET); bz++) {
          const key = this.key(bx, bz);
          const list = this.buckets.get(key);
          if (list) list.push(tree);
          else this.buckets.set(key, [tree]);
        }
      }
    }
  }

  distance(x: number, y: number, z: number): number {
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
