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
  private readonly dx: number;
  private readonly dy: number;
  private readonly dz: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly dr: number;
  private readonly dt: number;
  private readonly gx: number;
  private readonly gr: number;
  private readonly gy: number;
  private readonly gb: number;
  private readonly hx: number;
  private readonly hy: number;
  private readonly hz: number;

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
    // The model's z axis, turned by the yaw
    this.nx = Math.sin(yaw);
    this.nz = Math.cos(yaw);
    const disc = shape.disc;
    this.dx = x + this.nx * (disc?.out ?? 0) * height;
    this.dz = z + this.nz * (disc?.out ?? 0) * height;
    this.dy = ground + (disc?.y ?? 0) * height;
    this.dr = (disc?.r ?? 0) * height;
    this.dt = (disc?.t ?? 0) * height;
    this.gx = (shape.gate?.x ?? 0) * height;
    this.gr = (shape.gate?.r ?? 0) * height;
    this.gy = (shape.gate?.y ?? 0) * height;
    this.gb = (shape.gate?.bar ?? 0) * height;
    this.hx = (shape.hall?.x ?? 0) * height;
    this.hy = (shape.hall?.y ?? 0) * height;
    this.hz = (shape.hall?.z ?? 0) * height;
    this.radius = Math.max(radius, Math.abs(lean) + radius * 0.9, Math.hypot(this.hx, this.hz));
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
    if (this.dr > 0) {
      // Sails: the disc they sweep
      const qx = px - this.dx;
      const qy = py - this.dy;
      const qz = pz - this.dz;
      const along = qx * this.nx + qz * this.nz;
      const rim = Math.hypot(qx - along * this.nx, qy, qz - along * this.nz) - this.dr;
      const face = Math.abs(along) - this.dt;
      d = Math.min(d, Math.min(Math.max(rim, face), 0) + Math.hypot(Math.max(rim, 0), Math.max(face, 0)));
    }
    if (this.gx > 0) {
      // A gate, in its own frame: u along the bar (the model's x axis), w through the opening
      const qx = px - this.x;
      const qz = pz - this.z;
      const u = qx * this.nz - qz * this.nx;
      const w = qx * this.nx + qz * this.nz;
      const v = py - this.ground;
      const post = Math.hypot(Math.abs(u) - this.gx, w, v - clamp(v, 0, this.gy)) - this.gr;
      const bar = Math.hypot(u - clamp(u, -this.gx, this.gx), w, v - this.gy) - this.gb;
      d = Math.min(d, post, bar);
    }
    if (this.hx > 0) {
      // A hall: a box in the building's own frame, standing on the ground
      const qx = px - this.x;
      const qz = pz - this.z;
      const u = Math.abs(qx * this.nz - qz * this.nx) - this.hx;
      const w = Math.abs(qx * this.nx + qz * this.nz) - this.hz;
      const v = py - this.ground - this.hy;
      d = Math.min(d, Math.min(Math.max(u, v, w), 0) + Math.hypot(Math.max(u, 0), Math.max(v, 0), Math.max(w, 0)));
    }
    return d;
  }
}

const BUCKET = 32;

/** Trees by area, for collisions. Chunks add theirs as their meshes arrive. */
export class TreeIndex {
  private readonly buckets = new Map<number, Collider[]>();
  private readonly chunks = new Map<number, Collider[]>();
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
    this.chunks.set(chunk, trees);
    for (const tree of trees) {
      this.bucketsOf(tree, (key) => {
        const list = this.buckets.get(key);
        if (list) list.push(tree);
        else this.buckets.set(key, [tree]);
      });
    }
  }

  /** Takes a chunk's trees out again (land left far behind on an endless line) */
  remove(chunk: number) {
    const trees = this.chunks.get(chunk);
    if (!trees) return;
    this.chunks.delete(chunk);
    for (const tree of trees) {
      this.bucketsOf(tree, (key) => {
        const list = this.buckets.get(key);
        if (!list) return;
        const i = list.indexOf(tree);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) this.buckets.delete(key);
      });
    }
  }

  /** Every bucket a tree reaches into */
  private bucketsOf(tree: Collider, each: (key: number) => void) {
    const r = tree.radius + this.reach;
    for (let bx = Math.floor((tree.x - r) / BUCKET); bx <= Math.floor((tree.x + r) / BUCKET); bx++) {
      for (let bz = Math.floor((tree.z - r) / BUCKET); bz <= Math.floor((tree.z + r) / BUCKET); bz++) each(this.key(bx, bz));
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
