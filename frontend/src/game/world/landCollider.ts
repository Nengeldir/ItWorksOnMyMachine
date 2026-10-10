import type { Vector3 } from "three";

// Collisions against the land exactly as it is drawn: the triangles of every
// land mesh on screen (Sky Isles' chunks, generator-v2 nodes) in a grid per
// mesh, built the first time something comes near. What you see is what you
// hit, and nothing else: a sliver of the distance field too thin for the
// meshing grid, which is never drawn, is never hit either.

/** One land mesh's triangles, and a grid over them built on first use */
interface Piece {
  positions: Float32Array; // flat triangles, world coordinates
  count: number; // triangles
  cell: number;
  min: [number, number, number];
  max: [number, number, number];
  // The grid, built lazily: cell → triangle ids (CSR)
  nx: number;
  ny: number;
  nz: number;
  start: Uint32Array | null;
  items: Uint32Array | null;
  stamp: Uint32Array | null; // per triangle: the last query that saw it, to visit each once
}

/** Where a test touched: the point on the land, its outward normal and how far in (metres) */
export interface LandHit {
  point: Vector3;
  normal: Vector3;
}

const EPSILON = 1e-9;

export class LandCollider {
  private readonly pieces = new Map<number, Piece>();
  private query = 0;
  // Triangles gathered for the current query: piece and triangle index
  private readonly foundPiece: Piece[] = [];
  private readonly foundTri: number[] = [];
  private found = 0;
  // Scratch for the closest point
  private readonly closest = [0, 0, 0];

  get size(): number {
    return this.pieces.size;
  }

  /** A land mesh went on screen; `cell` about its voxel size */
  add(key: number, positions: Float32Array, cell: number) {
    if (positions.length < 9) {
      this.pieces.delete(key);
      return;
    }
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = positions[i + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    this.pieces.set(key, { positions, count: positions.length / 9, cell, min, max, nx: 0, ny: 0, nz: 0, start: null, items: null, stamp: null });
  }

  /** A land mesh left the screen */
  remove(key: number) {
    this.pieces.delete(key);
  }

  clear() {
    this.pieces.clear();
  }

  private build(p: Piece) {
    const c = p.cell;
    p.nx = Math.max(1, Math.ceil((p.max[0] - p.min[0]) / c) + 1);
    p.ny = Math.max(1, Math.ceil((p.max[1] - p.min[1]) / c) + 1);
    p.nz = Math.max(1, Math.ceil((p.max[2] - p.min[2]) / c) + 1);
    const cells = p.nx * p.ny * p.nz;
    const counts = new Uint32Array(cells + 1);
    const pos = p.positions;
    const range = (t: number, out: Int32Array) => {
      const o = t * 9;
      for (let a = 0; a < 3; a++) {
        const lo = Math.min(pos[o + a], pos[o + 3 + a], pos[o + 6 + a]);
        const hi = Math.max(pos[o + a], pos[o + 3 + a], pos[o + 6 + a]);
        out[a] = Math.floor((lo - p.min[a]) / c);
        out[a + 3] = Math.floor((hi - p.min[a]) / c);
      }
    };
    const r = new Int32Array(6);
    for (let t = 0; t < p.count; t++) {
      range(t, r);
      for (let k = r[2]; k <= r[5]; k++) for (let j = r[1]; j <= r[4]; j++) for (let i = r[0]; i <= r[3]; i++) counts[i + p.nx * (j + p.ny * k) + 1]++;
    }
    for (let i = 1; i <= cells; i++) counts[i] += counts[i - 1];
    const items = new Uint32Array(counts[cells]);
    const fill = counts.slice(0, cells);
    for (let t = 0; t < p.count; t++) {
      range(t, r);
      for (let k = r[2]; k <= r[5]; k++) for (let j = r[1]; j <= r[4]; j++) for (let i = r[0]; i <= r[3]; i++) items[fill[i + p.nx * (j + p.ny * k)]++] = t;
    }
    p.start = counts;
    p.items = items;
    p.stamp = new Uint32Array(p.count);
  }

  /** Collects every triangle that may overlap a box; returns how many */
  gather(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
    this.query = (this.query + 1) >>> 0;
    if (this.query === 0) {
      // Wrapped: forget every stamp
      for (const p of this.pieces.values()) p.stamp?.fill(0);
      this.query = 1;
    }
    const q = this.query;
    this.found = 0;
    for (const p of this.pieces.values()) {
      if (x1 < p.min[0] || x0 > p.max[0] || y1 < p.min[1] || y0 > p.max[1] || z1 < p.min[2] || z0 > p.max[2]) continue;
      if (!p.start) this.build(p);
      const c = p.cell;
      const i0 = Math.max(0, Math.floor((x0 - p.min[0]) / c));
      const j0 = Math.max(0, Math.floor((y0 - p.min[1]) / c));
      const k0 = Math.max(0, Math.floor((z0 - p.min[2]) / c));
      const i1 = Math.min(p.nx - 1, Math.floor((x1 - p.min[0]) / c));
      const j1 = Math.min(p.ny - 1, Math.floor((y1 - p.min[1]) / c));
      const k1 = Math.min(p.nz - 1, Math.floor((z1 - p.min[2]) / c));
      const start = p.start!;
      const items = p.items!;
      const stamp = p.stamp!;
      for (let k = k0; k <= k1; k++) {
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const cellIndex = i + p.nx * (j + p.ny * k);
            for (let n = start[cellIndex]; n < start[cellIndex + 1]; n++) {
              const t = items[n];
              if (stamp[t] === q) continue;
              stamp[t] = q;
              this.foundPiece[this.found] = p;
              this.foundTri[this.found] = t;
              this.found++;
            }
          }
        }
      }
    }
    return this.found;
  }

  /** Writes triangle `n` of the last gather's outward normal (unit) */
  private normalOf(n: number, out: Vector3): Vector3 {
    const pos = this.foundPiece[n].positions;
    const o = this.foundTri[n] * 9;
    const e1x = pos[o + 3] - pos[o];
    const e1y = pos[o + 4] - pos[o + 1];
    const e1z = pos[o + 5] - pos[o + 2];
    const e2x = pos[o + 6] - pos[o];
    const e2y = pos[o + 7] - pos[o + 1];
    const e2z = pos[o + 8] - pos[o + 2];
    out.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
    const length = out.length();
    return length > EPSILON ? out.divideScalar(length) : out.set(0, 1, 0);
  }

  /** The closest point of triangle `n` (last gather) to (px, py, pz), into `this.closest`; returns the squared distance */
  private closestOn(n: number, px: number, py: number, pz: number): number {
    const pos = this.foundPiece[n].positions;
    const o = this.foundTri[n] * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
    const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
    const out = this.closest;
    // Ericson, Real-Time Collision Detection 5.1.5
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let rx: number, ry: number, rz: number;
    if (d1 <= 0 && d2 <= 0) {
      rx = ax; ry = ay; rz = az;
    } else {
      const bpx = px - bx, bpy = py - by, bpz = pz - bz;
      const d3 = abx * bpx + aby * bpy + abz * bpz;
      const d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) {
        rx = bx; ry = by; rz = bz;
      } else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
          const v = d1 / (d1 - d3);
          rx = ax + abx * v; ry = ay + aby * v; rz = az + abz * v;
        } else {
          const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
          const d5 = abx * cpx + aby * cpy + abz * cpz;
          const d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) {
            rx = cx; ry = cy; rz = cz;
          } else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) {
              const w = d2 / (d2 - d6);
              rx = ax + acx * w; ry = ay + acy * w; rz = az + acz * w;
            } else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
                rx = bx + (cx - bx) * w; ry = by + (cy - by) * w; rz = bz + (cz - bz) * w;
              } else {
                const denom = 1 / (va + vb + vc);
                const v = vb * denom;
                const w = vc * denom;
                rx = ax + abx * v + acx * w; ry = ay + aby * v + acy * w; rz = az + abz * v + acz * w;
              }
            }
          }
        }
      }
    }
    out[0] = rx;
    out[1] = ry;
    out[2] = rz;
    return (px - rx) ** 2 + (py - ry) ** 2 + (pz - rz) ** 2;
  }

  /**
   * Signed distance from a point to the land drawn near it, looking no further
   * than `reach` (Infinity if nothing that close): negative behind the nearest
   * face. `hit` gets the nearest point and the direction out of the land there.
   */
  nearest(p: Vector3, reach: number, hit: LandHit): number {
    if (!this.gather(p.x - reach, p.y - reach, p.z - reach, p.x + reach, p.y + reach, p.z + reach)) return Infinity;
    let best = reach * reach;
    let index = -1;
    let bx = 0, by = 0, bz = 0;
    for (let n = 0; n < this.found; n++) {
      const d2 = this.closestOn(n, p.x, p.y, p.z);
      if (d2 < best) {
        best = d2;
        index = n;
        bx = this.closest[0]; by = this.closest[1]; bz = this.closest[2];
      }
    }
    if (index < 0) return Infinity;
    hit.point.set(bx, by, bz);
    this.normalOf(index, hit.normal);
    const distance = Math.sqrt(best);
    const side = (p.x - bx) * hit.normal.x + (p.y - by) * hit.normal.y + (p.z - bz) * hit.normal.z;
    // Off a face's middle the direction out is the face's normal; off an edge or corner, away from it
    if (distance > 1e-4 && Math.abs(side) < distance * 0.999) {
      const s = side < 0 ? -1 : 1;
      hit.normal.set(((p.x - bx) / distance) * s, ((p.y - by) / distance) * s, ((p.z - bz) / distance) * s);
    }
    return side < 0 ? -distance : distance;
  }

  /** Does a ball touch the land drawn? The deepest touch goes to `hit` */
  sphere(center: Vector3, radius: number, hit: LandHit): boolean {
    return this.nearest(center, radius, hit) < radius;
  }

  /** Does the segment from `a` to `b` cross a face? The first crossing goes to `hit` */
  segment(a: Vector3, b: Vector3, hit: LandHit): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    if (!this.gather(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z))) return false;
    let first = Infinity;
    let index = -1;
    for (let n = 0; n < this.found; n++) {
      // Möller–Trumbore
      const pos = this.foundPiece[n].positions;
      const o = this.foundTri[n] * 9;
      const e1x = pos[o + 3] - pos[o], e1y = pos[o + 4] - pos[o + 1], e1z = pos[o + 5] - pos[o + 2];
      const e2x = pos[o + 6] - pos[o], e2y = pos[o + 7] - pos[o + 1], e2z = pos[o + 8] - pos[o + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < EPSILON) continue;
      const inv = 1 / det;
      const tx = a.x - pos[o], ty = a.y - pos[o + 1], tz = a.z - pos[o + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t < 0 || t > 1 || t >= first) continue;
      first = t;
      index = n;
    }
    if (index < 0) return false;
    hit.point.set(a.x + dx * first, a.y + dy * first, a.z + dz * first);
    this.normalOf(index, hit.normal);
    return true;
  }

  /**
   * Does a flat convex quad (corners in order) touch a face? Exact, by
   * separating axes: the two planes' normals and every pair of edges. The
   * face touched nearest the quad's middle goes to `hit`
   */
  quad(corners: readonly Vector3[], hit: LandHit): boolean {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const c of corners) {
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); z0 = Math.min(z0, c.z);
      x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); z1 = Math.max(z1, c.z);
    }
    if (!this.gather(x0, y0, z0, x1, y1, z1)) return false;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2;
    let best = Infinity;
    let index = -1;
    for (let n = 0; n < this.found; n++) {
      if (!this.quadTouches(corners, n)) continue;
      const d2 = this.closestOn(n, mx, my, mz);
      if (d2 < best) {
        best = d2;
        index = n;
        hit.point.set(this.closest[0], this.closest[1], this.closest[2]);
      }
    }
    if (index < 0) return false;
    this.normalOf(index, hit.normal);
    return true;
  }

  private readonly tri = new Float64Array(9);
  private readonly quadEdges = new Float64Array(12);
  private readonly triEdges = new Float64Array(9);

  /** Is there a gap between the quad and the triangle in `this.tri` along this axis? */
  private separated(q: readonly Vector3[], ax: number, ay: number, az: number): boolean {
    if (ax * ax + ay * ay + az * az < 1e-12) return false;
    let q0 = Infinity;
    let q1 = -Infinity;
    for (let i = 0; i < q.length; i++) {
      const d = q[i].x * ax + q[i].y * ay + q[i].z * az;
      if (d < q0) q0 = d;
      if (d > q1) q1 = d;
    }
    const t = this.tri;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (let i = 0; i < 9; i += 3) {
      const d = t[i] * ax + t[i + 1] * ay + t[i + 2] * az;
      if (d < t0) t0 = d;
      if (d > t1) t1 = d;
    }
    return q1 < t0 || t1 < q0;
  }

  private quadTouches(q: readonly Vector3[], n: number): boolean {
    const pos = this.foundPiece[n].positions;
    const o = this.foundTri[n] * 9;
    const t = this.tri;
    for (let i = 0; i < 9; i++) t[i] = pos[o + i];
    const qe = this.quadEdges;
    for (let i = 0; i < 4; i++) {
      const a = q[i];
      const b = q[(i + 1) % 4];
      qe[i * 3] = b.x - a.x;
      qe[i * 3 + 1] = b.y - a.y;
      qe[i * 3 + 2] = b.z - a.z;
    }
    const te = this.triEdges;
    for (let i = 0; i < 3; i++) {
      const j = ((i + 1) % 3) * 3;
      te[i * 3] = t[j] - t[i * 3];
      te[i * 3 + 1] = t[j + 1] - t[i * 3 + 1];
      te[i * 3 + 2] = t[j + 2] - t[i * 3 + 2];
    }
    // The quad's normal and the triangle's
    if (this.separated(q, qe[1] * qe[5] - qe[2] * qe[4], qe[2] * qe[3] - qe[0] * qe[5], qe[0] * qe[4] - qe[1] * qe[3])) return false;
    if (this.separated(q, te[1] * te[5] - te[2] * te[4], te[2] * te[3] - te[0] * te[5], te[0] * te[4] - te[1] * te[3])) return false;
    // Every pair of edges
    for (let i = 0; i < 12; i += 3) {
      for (let j = 0; j < 9; j += 3) {
        const ax = qe[i + 1] * te[j + 2] - qe[i + 2] * te[j + 1];
        const ay = qe[i + 2] * te[j] - qe[i] * te[j + 2];
        const az = qe[i] * te[j + 1] - qe[i + 1] * te[j];
        if (this.separated(q, ax, ay, az)) return false;
      }
    }
    return true;
  }
}
