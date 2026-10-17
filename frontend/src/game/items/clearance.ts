import * as THREE from "three";

// Carried items keep the pilot's own cloth and wings out of them (looks only, CLAUDE.md rule 6). A carried
// item's shape becomes a solid grid of little cells in its own frame, built once per kind of item: its
// triangles are traced into the grid, everything the outside can't reach is filled in (a rocket is solid,
// an umbrella's canopy stays open underneath), and the result grows by a cell so nothing grazes it.
// The avatar turns its wings out of these and drapes its cape in front of what is worn on the back.

const tri = new THREE.Triangle();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const p = new THREE.Vector3();
const toItem = new THREE.Matrix4();

/** An item's solid shape, as cells of `cell` metres in the item's own frame */
export class Clearance {
  readonly cell: number;
  readonly origin: THREE.Vector3;
  readonly size: [number, number, number];
  readonly solid: Uint8Array;

  private constructor(cell: number, origin: THREE.Vector3, size: [number, number, number], solid: Uint8Array) {
    this.cell = cell;
    this.origin = origin;
    this.size = size;
    this.solid = solid;
  }

  /** Whether a point in the item's frame is in (or within a cell of) the item */
  inside(point: THREE.Vector3): boolean {
    const [nx, ny, nz] = this.size;
    const x = Math.floor((point.x - this.origin.x) / this.cell);
    const y = Math.floor((point.y - this.origin.y) / this.cell);
    const z = Math.floor((point.z - this.origin.z) / this.cell);
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return false;
    return this.solid[(z * ny + y) * nx + x] === 1;
  }

  /** Whether a sphere in the item's frame comes anywhere near it (its box, so: cheaply) */
  near(center: THREE.Vector3, radius: number): boolean {
    const [nx, ny, nz] = this.size;
    const o = this.origin, c = this.cell;
    const dx = Math.max(o.x - center.x, center.x - (o.x + nx * c), 0);
    const dy = Math.max(o.y - center.y, center.y - (o.y + ny * c), 0);
    const dz = Math.max(o.z - center.z, center.z - (o.z + nz * c), 0);
    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }

  /** The centre of every solid cell, in the item's frame (for maps made from it) */
  forEachSolid(visit: (point: THREE.Vector3) => void) {
    const [nx, ny, nz] = this.size;
    const at = new THREE.Vector3();
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (this.solid[(z * ny + y) * nx + x] !== 1) continue;
      visit(at.set(x + 0.5, y + 0.5, z + 0.5).multiplyScalar(this.cell).add(this.origin));
    }
  }

  /**
   * The solid shape of everything visible in `root`, in `root`'s own frame (its own transform is left out).
   * Ink outlines and invisible parts (a firework's unlit flame) don't count
   */
  static of(root: THREE.Object3D, cell = 0.025, margin = 1): Clearance {
    root.updateWorldMatrix(true, true);
    toItem.copy(root.matrixWorld).invert();
    const meshes: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] = [];
    const bounds = new THREE.Box3();
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh.parent as THREE.Mesh | null)?.isMesh || !mesh.geometry.getAttribute("position")) return;
      // Light (a flame, a glow) is not in the way
      if ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.blending === THREE.AdditiveBlending) return;
      for (let o: THREE.Object3D | null = mesh; o && o !== root; o = o.parent) if (!o.visible) return;
      const matrix = new THREE.Matrix4().multiplyMatrices(toItem, mesh.matrixWorld);
      const position = mesh.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i++) bounds.expandByPoint(p.fromBufferAttribute(position, i).applyMatrix4(matrix));
      meshes.push({ mesh, matrix });
    });
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(), new THREE.Vector3());
    // Room round the shape for the flood fill and the margin
    const pad = (margin + 2) * cell;
    const origin = bounds.min.clone().subScalar(pad);
    const span = bounds.max.clone().addScalar(pad).sub(origin);
    const nx = Math.ceil(span.x / cell), ny = Math.ceil(span.y / cell), nz = Math.ceil(span.z / cell);
    const index = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
    const wall = new Uint8Array(nx * ny * nz);
    const mark = (v: THREE.Vector3) => {
      const x = Math.floor((v.x - origin.x) / cell), y = Math.floor((v.y - origin.y) / cell), z = Math.floor((v.z - origin.z) / cell);
      if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) wall[index(x, y, z)] = 1;
    };
    // Trace every triangle: points no more than half a cell apart
    for (const { mesh, matrix } of meshes) {
      const position = mesh.geometry.getAttribute("position");
      const order = mesh.geometry.index;
      const count = order ? order.count : position.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const i0 = order ? order.getX(i) : i, i1 = order ? order.getX(i + 1) : i + 1, i2 = order ? order.getX(i + 2) : i + 2;
        a.fromBufferAttribute(position, i0).applyMatrix4(matrix);
        b.fromBufferAttribute(position, i1).applyMatrix4(matrix);
        c.fromBufferAttribute(position, i2).applyMatrix4(matrix);
        tri.set(a, b, c);
        const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
        const steps = Math.max(1, Math.ceil(longest / (cell * 0.5)));
        for (let u = 0; u <= steps; u++) {
          for (let v = 0; u + v <= steps; v++) {
            const w = steps - u - v;
            p.set(0, 0, 0).addScaledVector(a, u / steps).addScaledVector(b, v / steps).addScaledVector(c, w / steps);
            mark(p);
          }
        }
      }
    }
    // What the outside reaches, from the border in: everything else is solid
    const outside = new Uint8Array(nx * ny * nz);
    const queue = new Int32Array(nx * ny * nz);
    let head = 0, tail = 0;
    const visit = (x: number, y: number, z: number) => {
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
      const i = index(x, y, z);
      if (outside[i] || wall[i]) return;
      outside[i] = 1;
      queue[tail++] = i;
    };
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) { visit(0, y, z); visit(nx - 1, y, z); }
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { visit(x, 0, z); visit(x, ny - 1, z); }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { visit(x, y, 0); visit(x, y, nz - 1); }
    while (head < tail) {
      const i = queue[head++];
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
      visit(x + 1, y, z); visit(x - 1, y, z); visit(x, y + 1, z); visit(x, y - 1, z); visit(x, y, z + 1); visit(x, y, z - 1);
    }
    let solid = new Uint8Array(nx * ny * nz);
    for (let i = 0; i < solid.length; i++) solid[i] = outside[i] ? 0 : 1;
    // Grow by the margin, a cell at a time
    for (let m = 0; m < margin; m++) {
      const grown = solid.slice();
      for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
        const i = index(x, y, z);
        if (solid[i]) continue;
        if (solid[i + 1] || solid[i - 1] || solid[i + nx] || solid[i - nx] || solid[i + nx * ny] || solid[i - nx * ny]) grown[i] = 1;
      }
      solid = grown;
    }
    return new Clearance(cell, origin, [nx, ny, nz], solid);
  }
}

const cache = new Map<string, Clearance>();

/** An item's solid shape (built once per id: every item of a kind has the same model) */
export function clearanceOf(id: string, group: THREE.Object3D): Clearance {
  let found = cache.get(id);
  if (!found) {
    // Measured without the group's own placement, scale or animation
    const saved = { position: group.position.clone(), quaternion: group.quaternion.clone(), scale: group.scale.clone(), parent: group.parent };
    saved.parent?.remove(group);
    group.position.set(0, 0, 0);
    group.quaternion.identity();
    group.scale.setScalar(1);
    found = Clearance.of(group);
    group.position.copy(saved.position);
    group.quaternion.copy(saved.quaternion);
    group.scale.copy(saved.scale);
    saved.parent?.add(group);
    cache.set(id, found);
  }
  return found;
}

/**
 * How far forward (towards the body, −z) cloth must stay under an item worn on the back: for each cell of
 * the (x, y) plane in the body's frame, the item's front, sloping away smoothly round its outline so the
 * cape drapes over its edges instead of stepping
 */
export class FrontMap {
  private readonly cell: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly front: Float32Array;

  /** `toBody`: the item's frame to the body's; `reach`/`slope`: how far round the outline cloth eases, and how steeply */
  constructor(shape: Clearance, toBody: THREE.Matrix4, reach = 0.12, slope = 1.1) {
    const cell = (this.cell = shape.cell);
    const box = new THREE.Box3();
    const points: number[] = [];
    shape.forEachSolid((point) => {
      point.applyMatrix4(toBody);
      box.expandByPoint(point);
      points.push(point.x, point.y, point.z);
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());
    const r = Math.ceil(reach / cell);
    this.x0 = box.min.x - (r + 1) * cell;
    this.y0 = box.min.y - (r + 1) * cell;
    this.nx = Math.ceil((box.max.x - box.min.x) / cell) + 2 * r + 3;
    this.ny = Math.ceil((box.max.y - box.min.y) / cell) + 2 * r + 3;
    const raw = new Float32Array(this.nx * this.ny).fill(Infinity);
    for (let i = 0; i < points.length; i += 3) {
      const x = Math.floor((points[i] - this.x0) / cell), y = Math.floor((points[i + 1] - this.y0) / cell);
      const k = y * this.nx + x;
      raw[k] = Math.min(raw[k], points[i + 2] - cell * 0.5);
    }
    // Soften: each cell is no further back than a neighbour's front plus the slope over the distance
    this.front = new Float32Array(raw.length).fill(Infinity);
    for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      let best = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= this.nx || yy >= this.ny) continue;
        const f = raw[yy * this.nx + xx];
        if (f < Infinity) best = Math.min(best, f + slope * Math.hypot(dx, dy) * cell);
      }
      this.front[y * this.nx + x] = best;
    }
  }

  /** The furthest back (+z) cloth may be at (x, y) in the body's frame; Infinity away from the item */
  limit(x: number, y: number): number {
    const fx = (x - this.x0) / this.cell - 0.5, fy = (y - this.y0) / this.cell - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= this.nx - 1 || iy >= this.ny - 1) return Infinity;
    // Bilinear between the four cells round the point, so the drape is smooth
    const tx = fx - ix, ty = fy - iy;
    const f = this.front, n = this.nx, k = iy * n + ix;
    const f00 = f[k], f10 = f[k + 1], f01 = f[k + n], f11 = f[k + n + 1];
    if (!(f00 < Infinity && f10 < Infinity && f01 < Infinity && f11 < Infinity)) return Math.min(f00, f10, f01, f11);
    return (f00 * (1 - tx) + f10 * tx) * (1 - ty) + (f01 * (1 - tx) + f11 * tx) * ty;
  }
}
