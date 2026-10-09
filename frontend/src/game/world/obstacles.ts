// Obstacles are simple shapes with exact (or slightly conservative) signed
// distance functions, so crash checks and proximity scoring are a few lines of
// math instead of mesh raycasts.

export interface Obstacle {
  readonly kind: "pillar" | "rock" | "arch";
  readonly x: number;
  readonly z: number;
  /** Horizontal radius that contains the whole shape */
  readonly bound: number;
  distance(x: number, y: number, z: number): number;
}

/** A tapered rock tower standing on the ground */
export class Pillar implements Obstacle {
  readonly kind = "pillar";
  readonly x: number;
  readonly z: number;
  readonly bottom: number;
  readonly top: number;
  readonly radius: number; // at the bottom
  readonly topRadius: number;
  readonly bound: number;

  constructor(x: number, z: number, bottom: number, top: number, radius: number, topRadius: number) {
    this.x = x;
    this.z = z;
    this.bottom = bottom;
    this.top = top;
    this.radius = radius;
    this.topRadius = topRadius;
    this.bound = radius;
  }

  distance(x: number, y: number, z: number): number {
    const t = Math.min(1, Math.max(0, (y - this.bottom) / (this.top - this.bottom)));
    // The mesh is a roughened 7-sided prism: its flat faces sit at ~0.9 of the radius
    const r = (this.radius + (this.topRadius - this.radius) * t) * 0.9;
    const side = Math.hypot(x - this.x, z - this.z) - r;
    if (y <= this.top) return side;
    return Math.hypot(Math.max(side, 0), y - this.top);
  }
}

/** A floating boulder */
export class Rock implements Obstacle {
  readonly kind = "rock";
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly bound: number;

  constructor(x: number, y: number, z: number, radius: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.radius = radius;
    this.bound = radius;
  }

  distance(x: number, y: number, z: number): number {
    // The mesh is a bumpy icosahedron: collide with a slightly smaller sphere
    return Math.hypot(x - this.x, y - this.y, z - this.z) - this.radius * 0.92;
  }
}

/** A half torus standing across the canyon, to fly under */
export class Arch implements Obstacle {
  readonly kind = "arch";
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number; // to the middle of the tube
  readonly tube: number;
  readonly angle: number; // rotation about the vertical axis
  readonly bound: number;
  private readonly cos: number;
  private readonly sin: number;

  constructor(x: number, y: number, z: number, radius: number, tube: number, angle: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.radius = radius;
    this.tube = tube;
    this.angle = angle;
    this.bound = radius + tube;
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
  }

  distance(x: number, y: number, z: number): number {
    const dx = x - this.x;
    const dz = z - this.z;
    // Into the torus' own frame: its ring lies in the local xy plane
    const lx = dx * this.cos - dz * this.sin;
    const lz = dx * this.sin + dz * this.cos;
    const ly = y - this.y;
    return Math.hypot(Math.hypot(lx, ly) - this.radius, lz) - this.tube;
  }
}

/** Buckets obstacles by area, so a distance query only looks at nearby ones */
export class ObstacleGrid {
  private readonly cell = 64;
  private readonly cells = new Map<number, Obstacle[]>();

  /** Distances are exact up to `reach` metres away from an obstacle */
  constructor(obstacles: readonly Obstacle[], reach: number) {
    for (const o of obstacles) {
      const r = o.bound + reach;
      const x0 = Math.floor((o.x - r) / this.cell);
      const x1 = Math.floor((o.x + r) / this.cell);
      const z0 = Math.floor((o.z - r) / this.cell);
      const z1 = Math.floor((o.z + r) / this.cell);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const key = this.key(ix, iz);
          const list = this.cells.get(key);
          if (list) list.push(o);
          else this.cells.set(key, [o]);
        }
      }
    }
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  /** Distance to the nearest obstacle, or Infinity when none is in this cell */
  distance(x: number, y: number, z: number): number {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    let best = Infinity;
    if (list) {
      for (const o of list) {
        const d = o.distance(x, y, z);
        if (d < best) best = d;
      }
    }
    return best;
  }
}
