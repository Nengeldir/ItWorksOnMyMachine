import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import { Vector3 } from "three";
import { clamp, smin } from "../math";
import { makeRng, pick, range } from "../rng";
import { type Course, TUBE_RADIUS } from "./course";

// The rock is one signed distance field (negative inside, positive in the air):
// simple shapes melted together, roughened with noise, with a tube carved along
// the racing line so the course is always flyable. Meshes are cut from this field,
// and collisions read it directly.

/** Distance reported far away from any rock */
const EMPTY = 40;
/** Shapes closer than this melt into each other */
const BLEND = 6;
/** Distances are exact up to this far from the rock (proximity scoring needs ~12 m) */
const REACH = 16;
const CELL = 40;

export interface Shape {
  readonly cx: number; // bounding sphere
  readonly cy: number;
  readonly cz: number;
  readonly bound: number;
  readonly roughness: number; // metres of noise on its surface
  distance(x: number, y: number, z: number): number;
}

/** Approximate distance to an axis-aligned ellipsoid (Inigo Quilez's bound) */
function ellipsoid(x: number, y: number, z: number, a: number, b: number, c: number): number {
  const k0 = Math.hypot(x / a, y / b, z / c);
  const k1 = Math.hypot(x / (a * a), y / (b * b), z / (c * c));
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b, c);
}

/** A floating island: a flattened dome of land on top, tapering to a point below */
class Island implements Shape {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly bound: number;
  readonly roughness: number;
  private readonly x: number;
  private readonly y: number; // the level of its top surface
  private readonly z: number;
  private readonly size: number;
  private readonly cos: number;
  private readonly sin: number;

  constructor(x: number, y: number, z: number, size: number, yaw: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.size = size;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.roughness = size * 0.12;
    this.cx = x;
    this.cy = y - size * 0.45;
    this.cz = z;
    this.bound = size * 1.32 + this.roughness * 1.4;
  }

  distance(px: number, py: number, pz: number): number {
    const dx = px - this.x;
    const dy = py - this.y;
    const dz = pz - this.z;
    const lx = dx * this.cos - dz * this.sin;
    const lz = dx * this.sin + dz * this.cos;
    const s = this.size;
    const top = ellipsoid(lx, dy + s * 0.05, lz, s, s * 0.32, s * 0.85);
    // An upside-down cone under it
    const height = s * 1.25;
    const radius = s * 0.78;
    const t = clamp(-dy / height, 0, 1);
    const side = (Math.hypot(lx, lz) - radius * (1 - t)) * (height / Math.hypot(height, radius));
    const cone = Math.max(side, dy, -dy - height);
    return smin(top, cone, s * 0.3);
  }
}

/** A flattened ellipsoid in its own frame: walls across the line, slabs */
class Slab implements Shape {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly bound: number;
  readonly roughness: number;
  private readonly axes: [Vector3, Vector3, Vector3];
  private readonly radii: [number, number, number];

  constructor(center: Vector3, axes: [Vector3, Vector3, Vector3], radii: [number, number, number], roughness: number) {
    this.cx = center.x;
    this.cy = center.y;
    this.cz = center.z;
    this.axes = [axes[0].clone(), axes[1].clone(), axes[2].clone()];
    this.radii = radii;
    this.roughness = roughness;
    this.bound = Math.max(...radii) + roughness * 1.4;
  }

  distance(px: number, py: number, pz: number): number {
    const dx = px - this.cx;
    const dy = py - this.cy;
    const dz = pz - this.cz;
    const [a, b, c] = this.axes;
    return ellipsoid(
      dx * a.x + dy * a.y + dz * a.z,
      dx * b.x + dy * b.y + dz * b.z,
      dx * c.x + dy * c.y + dz * c.z,
      ...this.radii,
    );
  }
}

/** A tapering rock needle, upright */
class Spire implements Shape {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly bound: number;
  readonly roughness: number;
  private readonly bottom: number;
  private readonly top: number;
  private readonly r0: number;
  private readonly r1: number;

  constructor(x: number, z: number, bottom: number, top: number, r0: number, r1: number) {
    this.cx = x;
    this.cz = z;
    this.cy = (bottom + top) / 2;
    this.bottom = bottom;
    this.top = top;
    this.r0 = r0;
    this.r1 = r1;
    this.roughness = r0 * 0.25;
    this.bound = Math.hypot((top - bottom) / 2, r0) + this.roughness * 1.4;
  }

  distance(px: number, py: number, pz: number): number {
    const t = clamp((py - this.bottom) / (this.top - this.bottom), 0, 1);
    const side = Math.hypot(px - this.cx, pz - this.cz) - (this.r0 + (this.r1 - this.r0) * t);
    const cap = py > this.top ? py - this.top : py < this.bottom ? this.bottom - py : 0;
    return cap > 0 ? Math.hypot(Math.max(side, 0), cap) : side;
  }
}

/** A ring of rock to fly through */
class RockRing implements Shape {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly bound: number;
  readonly roughness: number;
  private readonly axis: Vector3;
  private readonly radius: number;
  private readonly tube: number;

  constructor(center: Vector3, axis: Vector3, radius: number, tube: number) {
    this.cx = center.x;
    this.cy = center.y;
    this.cz = center.z;
    this.axis = axis.clone();
    this.radius = radius;
    this.tube = tube;
    this.roughness = tube * 0.3;
    this.bound = radius + tube + this.roughness * 1.4;
  }

  distance(px: number, py: number, pz: number): number {
    const dx = px - this.cx;
    const dy = py - this.cy;
    const dz = pz - this.cz;
    const along = dx * this.axis.x + dy * this.axis.y + dz * this.axis.z;
    const radial = Math.hypot(dx - this.axis.x * along, dy - this.axis.y * along, dz - this.axis.z * along);
    return Math.hypot(radial - this.radius, along) - this.tube;
  }
}

const UP = new Vector3(0, 1, 0);
const GATES = ["tunnel", "wall", "slot", "squeeze", "needles", "ring"] as const;

/** All the rock of a course, from its seed */
export class RockField {
  readonly shapes: Shape[] = [];
  private readonly course: Course;
  private readonly noise: NoiseFunction3D;
  private readonly cells = new Map<number, Shape[]>();

  constructor(seed: number, course: Course) {
    this.course = course;
    this.noise = createNoise3D(makeRng(seed, "rock"));
    const rng = makeRng(seed, "islands");
    const p = new Vector3();
    const t = new Vector3();
    const side = new Vector3();
    const up = new Vector3();
    const at = (z: number) => {
      course.pointAt(z, p);
      course.tangentAt(z, t);
      side.crossVectors(t, UP).normalize();
      up.crossVectors(side, t).normalize();
    };
    const offset = (s: number, u: number, f = 0) =>
      p.clone().addScaledVector(side, s).addScaledVector(up, u).addScaledVector(t, f);
    const island = (center: Vector3, size: number) =>
      new Island(center.x, center.y, center.z, size, range(rng, 0, Math.PI * 2));

    // A gate at every ring: something the line has to thread
    for (const z of course.gates) {
      at(z);
      const kind = pick(rng, GATES);
      if (kind === "tunnel") {
        // An island right on the line: the tube bores a tunnel through it
        const size = range(rng, 28, 50);
        this.add(island(offset(range(rng, -0.25, 0.25) * size, range(rng, -0.1, 0.35) * size), size));
      } else if (kind === "wall") {
        // A wall of rock across the line: the tube leaves a hole in it
        const radii: [number, number, number] = [range(rng, 45, 75), range(rng, 35, 55), range(rng, 7, 12)];
        this.add(new Slab(offset(range(rng, -10, 10), range(rng, -8, 8)), [side, up, t], radii, 2.5));
      } else if (kind === "slot") {
        // Two islands, one on each side, nearly touching
        for (const s of [-1, 1]) {
          const size = range(rng, 22, 40);
          this.add(island(offset(s * (size * 0.65 + TUBE_RADIUS * 0.5), range(rng, -0.2, 0.3) * size), size));
        }
      } else if (kind === "squeeze") {
        // One island overhead, one below: fly through the gap
        const over = range(rng, 30, 50);
        const under = range(rng, 28, 45);
        this.add(island(offset(range(rng, -8, 8), over * 0.75), over));
        this.add(island(offset(range(rng, -8, 8), -under * 0.25 - 6, 10), under));
      } else if (kind === "needles") {
        // A slalom of rock needles on both sides
        const count = 4 + Math.floor(rng() * 3);
        for (let i = 0; i < count; i++) {
          const r0 = range(rng, 3, 6);
          const s = (i % 2 ? 1 : -1) * (TUBE_RADIUS + r0 + range(rng, 1, 9));
          const base = offset(s, 0, (i - count / 2) * 12 + range(rng, -4, 4));
          this.add(
            new Spire(base.x, base.z, base.y - range(rng, 30, 60), base.y + range(rng, 15, 45), r0, r0 * range(rng, 0.3, 0.6)),
          );
        }
      } else {
        // A ring of rock around the line
        this.add(new RockRing(p, t, TUBE_RADIUS + range(rng, 3, 8), range(rng, 3.5, 6)));
      }
    }

    // Islands all around the line: scenery, shortcuts, and more things to skim
    for (let i = 0; i < 110; i++) {
      at(range(rng, -40, course.endZ + 300));
      const size = 12 + 50 * rng() ** 2;
      const lateral = (rng() < 0.5 ? -1 : 1) * range(rng, 25, 260);
      this.add(island(offset(lateral, range(rng, -90, 120)), size));
    }

    // A few big ones further out, for the view
    for (let i = 0; i < 10; i++) {
      at(range(rng, 0, course.endZ + 400));
      const lateral = (rng() < 0.5 ? -1 : 1) * range(rng, 300, 520);
      this.add(island(offset(lateral, range(rng, -120, 160)), range(rng, 70, 110)));
    }
  }

  private add(shape: Shape) {
    // Keep the start clear: racers spawn there side by side
    const start = this.course.start;
    if (Math.hypot(shape.cx - start.x, shape.cy - start.y, shape.cz - start.z) < shape.bound + 45) return;
    this.shapes.push(shape);
    const r = shape.bound + REACH;
    for (let ix = Math.floor((shape.cx - r) / CELL); ix <= Math.floor((shape.cx + r) / CELL); ix++) {
      for (let iy = Math.floor((shape.cy - r) / CELL); iy <= Math.floor((shape.cy + r) / CELL); iy++) {
        for (let iz = Math.floor((shape.cz - r) / CELL); iz <= Math.floor((shape.cz + r) / CELL); iz++) {
          const key = this.key(ix, iy, iz);
          const list = this.cells.get(key);
          if (list) list.push(shape);
          else this.cells.set(key, [shape]);
        }
      }
    }
  }

  private key(ix: number, iy: number, iz: number): number {
    return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
  }

  /** Signed distance to the rock, positive in the air (a close estimate near surfaces) */
  distance(x: number, y: number, z: number): number {
    const list = this.cells.get(this.key(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL)));
    if (!list) return EMPTY;
    let d = EMPTY;
    let nearest = Infinity;
    let roughness = 0;
    for (const shape of list) {
      // Cheap test first: is the point anywhere near this shape?
      const bx = x - shape.cx;
      const by = y - shape.cy;
      const bz = z - shape.cz;
      const r = shape.bound + REACH;
      if (bx * bx + by * by + bz * bz > r * r) continue;
      const ds = shape.distance(x, y, z);
      if (ds < nearest) {
        nearest = ds;
        roughness = shape.roughness;
      }
      d = smin(d, ds, BLEND);
    }
    if (d > roughness * 1.4 + REACH) return d;
    // Lumpy rock: noise on the surface, scaled to the nearest shape
    d += roughness * (this.noise(x * 0.045, y * 0.045, z * 0.045) + 0.35 * this.noise(x * 0.13, y * 0.13, z * 0.13));
    // The racing tube, carved out of everything
    if (d < TUBE_RADIUS) d = Math.max(d, TUBE_RADIUS - this.course.distance(x, y, z));
    return d;
  }
}
