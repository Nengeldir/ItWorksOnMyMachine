import { clamp } from "../math";
import type { ColliderShape } from "./flora/species";

/** Anything that grows and can be hit: x, z and a radius that bounds it sideways */
export interface Collider {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  distance(x: number, y: number, z: number): number;
}

/** A low-poly pine on the race map: a cone from the ground up, for collisions */
export class Tree implements Collider {
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

/** A generator-v2 plant: a tapered trunk (leaning, for palms) and an optional canopy */
export class Plant implements Collider {
  readonly x: number;
  readonly z: number;
  readonly radius: number; // bounds the whole plant sideways
  private readonly ground: number;
  private readonly topX: number;
  private readonly topY: number;
  private readonly topZ: number;
  private readonly r0: number;
  private readonly r1: number;
  private readonly cy: number;
  private readonly cx: number;
  private readonly cz: number;
  private readonly cr: number;
  private readonly ch: number;

  constructor(x: number, ground: number, z: number, height: number, radius: number, yaw: number, shape: ColliderShape) {
    this.x = x;
    this.z = z;
    this.ground = ground;
    const lean = shape.lean * height;
    const lx = Math.cos(yaw) * lean;
    const lz = -Math.sin(yaw) * lean;
    this.topX = x + lx * shape.top;
    this.topZ = z + lz * shape.top;
    this.topY = ground + height * shape.top;
    this.r0 = radius * shape.trunk;
    this.r1 = this.r0 * shape.taper;
    if (shape.canopy) {
      this.cx = x + lx * shape.canopy.y;
      this.cz = z + lz * shape.canopy.y;
      this.cy = ground + height * shape.canopy.y;
      this.cr = radius * shape.canopy.r;
      this.ch = height * shape.canopy.h;
    } else {
      this.cx = this.cy = this.cz = this.cr = this.ch = 0;
    }
    this.radius = Math.max(radius, Math.abs(lean) + radius * 0.9);
  }

  distance(px: number, py: number, pz: number): number {
    let d = Infinity;
    if (this.r0 > 0) {
      // Tapered segment from the ground to the top of the trunk
      const bx = this.topX - this.x;
      const by = this.topY - this.ground;
      const bz = this.topZ - this.z;
      const qx = px - this.x;
      const qy = py - this.ground;
      const qz = pz - this.z;
      const t = clamp((qx * bx + qy * by + qz * bz) / Math.max(1e-6, bx * bx + by * by + bz * bz), 0, 1);
      d = Math.hypot(qx - bx * t, qy - by * t, qz - bz * t) - (this.r0 + (this.r1 - this.r0) * t);
    }
    if (this.cr > 0) {
      // Canopy: an ellipsoid (a close bound: the true distance is a little larger)
      const ex = (px - this.cx) / this.cr;
      const ey = (py - this.cy) / this.ch;
      const ez = (pz - this.cz) / this.cr;
      const k = Math.hypot(ex, ey, ez);
      d = Math.min(d, (k - 1) * Math.min(this.cr, this.ch));
    }
    return d;
  }
}

const BUCKET = 32;

/** Trees by area, for collisions. Chunks add theirs as their meshes arrive. */
export class TreeIndex {
  private readonly buckets = new Map<number, Collider[]>();
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
  add(chunk: number, trees: Collider[]) {
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
