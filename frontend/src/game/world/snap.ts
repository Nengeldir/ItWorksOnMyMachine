// Surface nets put each vertex at the average of where the grid's edges cross
// the surface, interpolated linearly between samples metres apart: on curved
// or noisy rock that's up to metres off the real surface, so you could fly
// into rock you can see or hit rock you can't. Snapping moves each vertex onto
// the distance field's zero surface, the surface collisions use, and
// `SurfaceCutter` cuts the faces that still stray from it (across ridges, lips
// and creases) into smaller ones. Looks only: the field itself never changes.

type Field = (x: number, y: number, z: number) => number;

/** Half the spacing of the samples for the gradient (metres) */
const E = 0.25;
/** Close enough to the surface (metres) */
const TOLERANCE = 0.02;
const ITERATIONS = 3;

const snapped = { x: 0, y: 0, z: 0 };
/** How far an edge's midpoint may move off the edge, as a share of its length */
const SPLIT_REACH = 0.3;

/**
 * Moves a point onto the surface of `field` with Newton steps along the
 * gradient, into `snapped`. Returns false (and leaves the point) if it would
 * move further than `limit` or doesn't get closer: a feature thinner than the
 * grid, which the mesh can't hold anyway.
 */
function snapPoint(field: Field, x0: number, y0: number, z0: number, limit: number): boolean {
  snapped.x = x0;
  snapped.y = y0;
  snapped.z = z0;
  const d0 = field(x0, y0, z0);
  if (Math.abs(d0) < TOLERANCE) return true;
  // The gradient once, from four samples on a tetrahedron (the ground's field isn't exactly unit length)
  const a = field(x0 + E, y0 - E, z0 - E);
  const b = field(x0 - E, y0 - E, z0 + E);
  const c = field(x0 - E, y0 + E, z0 - E);
  const d = field(x0 + E, y0 + E, z0 + E);
  const gx = (a - b - c + d) / (4 * E);
  const gy = (-a - b + c + d) / (4 * E);
  const gz = (-a + b - c + d) / (4 * E);
  const g2 = gx * gx + gy * gy + gz * gz;
  if (g2 < 1e-6) return false;
  let x = x0;
  let y = y0;
  let z = z0;
  let distance = d0;
  for (let i = 0; i < ITERATIONS && Math.abs(distance) > TOLERANCE; i++) {
    const step = distance / g2;
    x -= gx * step;
    y -= gy * step;
    z -= gz * step;
    distance = field(x, y, z);
  }
  if (Math.hypot(x - x0, y - y0, z - z0) > limit || Math.abs(distance) >= Math.abs(d0)) return false;
  snapped.x = x;
  snapped.y = y;
  snapped.z = z;
  return true;
}

/** The surface-nets grid the vertices belong to: vertex offset v is cell v / 3 = i + cells·(j + cells·k) */
export interface NetGrid {
  ox: number; // the first cell's corner
  oy: number;
  oz: number;
  size: number; // of a cell (metres)
  cells: number; // a side
}

/**
 * Moves the vertices at `indices` (offsets of x in `vertices`) onto the
 * surface of `field`, each kept inside its own cell: a vertex wandering into
 * its neighbours' cells folds faces over (back to front), which would draw
 * nothing there and leave stray faces to collide with. Deterministic per
 * vertex, so neighbouring chunks agree on the vertices they share.
 */
export function snapToSurface(vertices: Float32Array, indices: ArrayLike<number>, field: Field, grid: NetGrid) {
  const { size, cells } = grid;
  for (let n = 0; n < indices.length; n++) {
    const v = indices[n];
    const x0 = vertices[v];
    const y0 = vertices[v + 1];
    const z0 = vertices[v + 2];
    if (!snapPoint(field, x0, y0, z0, size)) continue;
    const cell = v / 3;
    const i = cell % cells;
    const j = Math.floor(cell / cells) % cells;
    const k = Math.floor(cell / (cells * cells));
    const x = clamp(snapped.x, grid.ox + i * size, grid.ox + (i + 1) * size);
    const y = clamp(snapped.y, grid.oy + j * size, grid.oy + (j + 1) * size);
    const z = clamp(snapped.z, grid.oz + k * size, grid.oz + (k + 1) * size);
    // Held in its cell short of the surface: only if that's still closer than where it was
    if ((x !== snapped.x || y !== snapped.y || z !== snapped.z) && Math.abs(field(x, y, z)) >= Math.abs(field(x0, y0, z0))) continue;
    vertices[v] = x;
    vertices[v + 1] = y;
    vertices[v + 2] = z;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Cuts triangles whose edges stray from the surface: an edge whose midpoint is
 * more than `tolerance` off is split at that midpoint, snapped onto the
 * surface, up to `depth` times. Whether an edge is split depends only on its
 * two ends, so the two triangles sharing it always agree and no cracks open.
 * Faces that already lie on the surface stay whole (the low-poly look).
 */
export class SurfaceCutter {
  /** Called for every triangle out, corners in order */
  emit: (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => void = () => {};
  private readonly field: Field;
  private readonly tolerance: number;
  private readonly depth: number;
  private readonly minEdge: number;

  constructor(field: Field, tolerance = 0.5, depth = 2, minEdge = 1.2) {
    this.field = field;
    this.tolerance = tolerance;
    this.depth = depth;
    this.minEdge = minEdge;
  }

  /**
   * A face of the mesh (corners already snapped), and the normal of the grid's
   * own face it came from. Pieces that end up facing the other way (folded
   * over by the snapping, into the rock) are dropped: seen from outside they
   * show only their backs, which are never drawn, so they must not be there
   * to hit either
   */
  triangle(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, nx: number, ny: number, nz: number) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.cut(ax, ay, az, bx, by, bz, cx, cy, cz, this.depth);
  }

  /** Pieces dropped for facing into the rock, since this cutter was made */
  dropped = 0;
  private nx = 0;
  private ny = 0;
  private nz = 0;

  private out(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (nx * this.nx + ny * this.ny + nz * this.nz <= 0) {
      this.dropped++;
      return;
    }
    this.emit(ax, ay, az, bx, by, bz, cx, cy, cz);
  }

  /**
   * Splits the edge (a, b) if its midpoint strays: the snapped midpoint goes
   * to `snapped`. It only moves across the edge, at most `SPLIT_REACH` of the
   * edge's length, so the halves can't fold over the triangles' third corners
   */
  private split(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const length = Math.hypot(bx - ax, by - ay, bz - az);
    if (length < this.minEdge) return false;
    // (a + b) / 2 is the same whichever way round the edge is walked
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const mz = (az + bz) / 2;
    if (Math.abs(this.field(mx, my, mz)) <= this.tolerance) return false;
    if (!snapPoint(this.field, mx, my, mz, length)) return false;
    const ux = (bx - ax) / length;
    const uy = (by - ay) / length;
    const uz = (bz - az) / length;
    let vx = snapped.x - mx;
    let vy = snapped.y - my;
    let vz = snapped.z - mz;
    const along = vx * ux + vy * uy + vz * uz;
    vx -= ux * along;
    vy -= uy * along;
    vz -= uz * along;
    const moved = Math.hypot(vx, vy, vz);
    const cap = length * SPLIT_REACH;
    const k = moved > cap ? cap / moved : 1;
    snapped.x = mx + vx * k;
    snapped.y = my + vy * k;
    snapped.z = mz + vz * k;
    return true;
  }

  private cut(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, depth: number) {
    if (depth <= 0) {
      this.out(ax, ay, az, bx, by, bz, cx, cy, cz);
      return;
    }
    const d = depth - 1;
    const ab = this.split(ax, ay, az, bx, by, bz);
    const abx = snapped.x;
    const aby = snapped.y;
    const abz = snapped.z;
    const bc = this.split(bx, by, bz, cx, cy, cz);
    const bcx = snapped.x;
    const bcy = snapped.y;
    const bcz = snapped.z;
    const ca = this.split(cx, cy, cz, ax, ay, az);
    const cax = snapped.x;
    const cay = snapped.y;
    const caz = snapped.z;

    if (ab && bc && ca) {
      this.cut(ax, ay, az, abx, aby, abz, cax, cay, caz, d);
      this.cut(abx, aby, abz, bx, by, bz, bcx, bcy, bcz, d);
      this.cut(cax, cay, caz, bcx, bcy, bcz, cx, cy, cz, d);
      this.cut(abx, aby, abz, bcx, bcy, bcz, cax, cay, caz, d);
    } else if (ab && bc) {
      this.cut(abx, aby, abz, bx, by, bz, bcx, bcy, bcz, d);
      this.cut(ax, ay, az, abx, aby, abz, bcx, bcy, bcz, d);
      this.cut(ax, ay, az, bcx, bcy, bcz, cx, cy, cz, d);
    } else if (bc && ca) {
      this.cut(bcx, bcy, bcz, cx, cy, cz, cax, cay, caz, d);
      this.cut(ax, ay, az, bx, by, bz, bcx, bcy, bcz, d);
      this.cut(ax, ay, az, bcx, bcy, bcz, cax, cay, caz, d);
    } else if (ca && ab) {
      this.cut(ax, ay, az, abx, aby, abz, cax, cay, caz, d);
      this.cut(abx, aby, abz, bx, by, bz, cx, cy, cz, d);
      this.cut(abx, aby, abz, cx, cy, cz, cax, cay, caz, d);
    } else if (ab) {
      this.cut(ax, ay, az, abx, aby, abz, cx, cy, cz, d);
      this.cut(abx, aby, abz, bx, by, bz, cx, cy, cz, d);
    } else if (bc) {
      this.cut(ax, ay, az, bx, by, bz, bcx, bcy, bcz, d);
      this.cut(ax, ay, az, bcx, bcy, bcz, cx, cy, cz, d);
    } else if (ca) {
      this.cut(ax, ay, az, bx, by, bz, cax, cay, caz, d);
      this.cut(cax, cay, caz, bx, by, bz, cx, cy, cz, d);
    } else {
      // Edges all on the surface, but the face may still miss a bump or a hollow inside it:
      // a fan around its snapped middle leaves the edges (and the neighbours) as they are
      const gx = (ax + bx + cx) / 3;
      const gy = (ay + by + cy) / 3;
      const gz = (az + bz + cz) / 3;
      const edge = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - bx, cy - by, cz - bz), Math.hypot(ax - cx, ay - cy, az - cz));
      if (edge < this.minEdge || Math.abs(this.field(gx, gy, gz)) <= this.tolerance || !snapPoint(this.field, gx, gy, gz, edge * 0.6)) {
        this.out(ax, ay, az, bx, by, bz, cx, cy, cz);
        return;
      }
      // Only along the face's normal: the fan then always covers the face the right way round
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const n = Math.hypot(nx, ny, nz);
      if (n < 1e-9) {
        this.out(ax, ay, az, bx, by, bz, cx, cy, cz);
        return;
      }
      nx /= n;
      ny /= n;
      nz /= n;
      const lift = (snapped.x - gx) * nx + (snapped.y - gy) * ny + (snapped.z - gz) * nz;
      const mx = gx + nx * lift;
      const my = gy + ny * lift;
      const mz = gz + nz * lift;
      this.cut(ax, ay, az, bx, by, bz, mx, my, mz, d);
      this.cut(bx, by, bz, cx, cy, cz, mx, my, mz, d);
      this.cut(cx, cy, cz, ax, ay, az, mx, my, mz, d);
    }
  }
}
