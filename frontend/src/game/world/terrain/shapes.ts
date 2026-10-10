import { Vector3 } from "three";
import { clamp, smin } from "../../math";
import type { Noise } from "./noise";

// The building blocks of the rock: signed distance functions (negative inside,
// positive in the air), each with a box around it for quick lookups, how rough
// its surface is, which way that roughness runs, and which of the biome's
// surfaces paints it.

/** How the surface noise runs: lumps, vertical flutes (karst), horizontal ledges (sandstone), sharp facets (ice) */
export const Grain = { Lumpy: 0, Fluted: 1, Layered: 2, Sharp: 3 } as const;
export type Grain = (typeof Grain)[keyof typeof Grain];

export interface Shape {
  /** A point inside, for keeping the start clear */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** Box around the shape, roughness included */
  readonly min: Vector3;
  readonly max: Vector3;
  readonly roughness: number; // metres of noise on its surface
  readonly grain: Grain;
  readonly surface: number; // index into the biome's surfaces
  distance(x: number, y: number, z: number): number;
}

export interface ShapeLook {
  surface?: number;
  roughness?: number;
  grain?: Grain;
}

/** Approximate distance to an axis-aligned ellipsoid (Inigo Quilez's bound) */
export function ellipsoid(x: number, y: number, z: number, a: number, b: number, c: number): number {
  const k0 = Math.hypot(x / a, y / b, z / c);
  const k1 = Math.hypot(x / (a * a), y / (b * b), z / (c * c));
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b, c);
}

/** Smooth maximum: carves b out of a with a soft edge */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

abstract class BaseShape implements Shape {
  cx = 0;
  cy = 0;
  cz = 0;
  readonly min = new Vector3();
  readonly max = new Vector3();
  readonly roughness: number;
  readonly grain: Grain;
  readonly surface: number;

  constructor(look: ShapeLook, roughness: number) {
    this.roughness = look.roughness ?? roughness;
    this.grain = look.grain ?? Grain.Lumpy;
    this.surface = look.surface ?? 0;
  }

  /** Sets the box from a center and half extents, padded for the roughness */
  protected box(x: number, y: number, z: number, hx: number, hy: number, hz: number) {
    const pad = this.roughness * 1.4;
    this.cx = x;
    this.cy = y;
    this.cz = z;
    this.min.set(x - hx - pad, y - hy - pad, z - hz - pad);
    this.max.set(x + hx + pad, y + hy + pad, z + hz + pad);
  }

  abstract distance(x: number, y: number, z: number): number;
}

export interface IslandStyle {
  flat?: number; // height of the top dome, as a share of the size (0.32)
  stretch?: number; // depth across, as a share of the size (0.85)
  depth?: number; // how far the cone underneath reaches down (1.25)
  taper?: number; // the cone's radius at the top (0.78)
  crater?: number; // a bowl in the top, as a share of the size (volcanoes)
}

/** A floating island: a flattened dome of land on top, tapering to a point below */
export class Island extends BaseShape {
  private readonly x: number;
  private readonly y: number; // the level of its top surface
  private readonly z: number;
  private readonly size: number;
  private readonly cos: number;
  private readonly sin: number;
  private readonly flat: number;
  private readonly stretch: number;
  private readonly depth: number;
  private readonly taper: number;
  private readonly crater: number;

  constructor(x: number, y: number, z: number, size: number, yaw: number, style: IslandStyle = {}, look: ShapeLook = {}) {
    super(look, size * 0.12);
    this.x = x;
    this.y = y;
    this.z = z;
    this.size = size;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.flat = style.flat ?? 0.32;
    this.stretch = style.stretch ?? 0.85;
    this.depth = style.depth ?? 1.25;
    this.taper = style.taper ?? 0.78;
    this.crater = style.crater ?? 0;
    const top = y + size * (this.flat - 0.05);
    const bottom = y - size * this.depth;
    this.box(x, (top + bottom) / 2, z, size, (top - bottom) / 2, size);
    this.cy = y - size * 0.3;
  }

  distance(px: number, py: number, pz: number): number {
    const dx = px - this.x;
    const dy = py - this.y;
    const dz = pz - this.z;
    const lx = dx * this.cos - dz * this.sin;
    const lz = dx * this.sin + dz * this.cos;
    const s = this.size;
    const top = ellipsoid(lx, dy + s * 0.05, lz, s, s * this.flat, s * this.stretch);
    // An upside-down cone under it
    const height = s * this.depth;
    const radius = s * this.taper;
    const t = clamp(-dy / height, 0, 1);
    const side = (Math.hypot(lx, lz) - radius * (1 - t)) * (height / Math.hypot(height, radius));
    const cone = Math.max(side, dy, -dy - height);
    let d = smin(top, cone, s * 0.3);
    if (this.crater > 0) {
      const r = s * this.crater;
      d = smax(d, r - Math.hypot(lx, dy - s * this.flat * 0.75 - r * 0.55, lz), s * 0.08);
    }
    return d;
  }
}

/** A flat-topped block with sheer sides and ledges, standing on the ground or floating on a cone */
export class Mesa extends BaseShape {
  private readonly x: number;
  private readonly z: number;
  private readonly top: number;
  private readonly bottom: number;
  private readonly rx: number;
  private readonly rz: number;
  private readonly cos: number;
  private readonly sin: number;
  private readonly step: number; // metres between ledges (0: none)
  private readonly flare: number; // how much wider each ledge down gets
  private readonly cone: number; // floating: depth of the cone under the block (0: grounded)

  constructor(
    x: number,
    z: number,
    top: number,
    bottom: number,
    rx: number,
    rz: number,
    yaw: number,
    options: { step?: number; flare?: number; cone?: number } = {},
    look: ShapeLook = {},
  ) {
    super(look, Math.min(rx, rz) * 0.1);
    this.x = x;
    this.z = z;
    this.top = top;
    this.bottom = bottom;
    this.rx = rx;
    this.rz = rz;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.step = options.step ?? 0;
    this.flare = options.flare ?? 0.07;
    this.cone = options.cone ?? 0;
    const widest = Math.max(rx, rz) * this.maxFlare();
    const low = bottom - this.cone;
    this.box(x, (top + low) / 2, z, widest, (top - low) / 2, widest);
  }

  private maxFlare(): number {
    return this.step > 0 ? 1 + Math.min(0.45, this.flare * Math.floor((this.top - this.bottom) / this.step)) : 1;
  }

  distance(px: number, py: number, pz: number): number {
    const dx = px - this.x;
    const dz = pz - this.z;
    const lx = dx * this.cos - dz * this.sin;
    const lz = dx * this.sin + dz * this.cos;
    // Ledges: the block widens a notch every `step` metres down
    const below = Math.max(0, this.top - py);
    const widen = this.step > 0 ? 1 + Math.min(0.45, this.flare * Math.floor(below / this.step)) : 1;
    const rx = this.rx * widen;
    const rz = this.rz * widen;
    const radial = (Math.hypot(lx / rx, lz / rz) - 1) * Math.min(rx, rz);
    const block = Math.max(radial, py - this.top, this.bottom - py);
    if (this.cone <= 0) return block;
    // Floating: a cone under the block, down to a point
    const r = Math.min(rx, rz) * 0.9;
    const t = clamp((this.bottom - py) / this.cone, 0, 1);
    const side = (Math.hypot(lx, lz) - r * (1 - t)) * (this.cone / Math.hypot(this.cone, r));
    const cone = Math.max(side, py - this.bottom - 4, this.bottom - this.cone - py);
    return smin(block, cone, r * 0.25);
  }
}

/**
 * The thinnest a column or tube of rock may be (radius, metres). The land is
 * meshed on a 6 m grid, which holds a column for certain only from 6/√2 ≈
 * 4.24 m: anything thinner would be drawn broken or not at all, while the
 * distance field still has it.
 */
export const MIN_RADIUS = 4.5;

/** A tapering column between two points: needles, karst pillars, ice shards, hanging roots */
export class Spire extends BaseShape {
  private readonly ax: number;
  private readonly ay: number;
  private readonly az: number;
  private readonly bx: number;
  private readonly by: number;
  private readonly bz: number;
  private readonly r0: number;
  private readonly r1: number;
  private readonly length2: number;
  private readonly notchY: number;
  private readonly notch: number;

  /**
   * From `base` (radius r0) to `tip` (radius r1). A notch narrows it around
   * `notchY` (sea stacks, cut by the waves). Never thinner than `MIN_RADIUS`:
   * a tapering end stops (rounded) where it would get thinner, a notch stops
   * short of it, and a spire thin all along shrinks to a stub at its base.
   */
  constructor(base: Vector3, tip: Vector3, r0: number, r1: number, look: ShapeLook = {}, notch?: { y: number; depth: number }) {
    super(look, r0 * 0.22);
    if (Math.max(r0, r1) < MIN_RADIUS) {
      tip = r0 >= r1 ? base : tip;
      base = tip;
      r0 = r1 = MIN_RADIUS;
    } else if (r1 < MIN_RADIUS) {
      tip = base.clone().lerp(tip, (r0 - MIN_RADIUS) / (r0 - r1));
      r1 = MIN_RADIUS;
    } else if (r0 < MIN_RADIUS) {
      base = tip.clone().lerp(base, (r1 - MIN_RADIUS) / (r1 - r0));
      r0 = MIN_RADIUS;
    }
    if (notch) notch = { y: notch.y, depth: Math.min(notch.depth, Math.max(0, Math.min(r0, r1) - MIN_RADIUS)) };
    this.ax = base.x;
    this.ay = base.y;
    this.az = base.z;
    this.bx = tip.x - base.x;
    this.by = tip.y - base.y;
    this.bz = tip.z - base.z;
    this.r0 = r0;
    this.r1 = r1;
    this.length2 = Math.max(1e-6, this.bx * this.bx + this.by * this.by + this.bz * this.bz);
    this.notchY = notch?.y ?? 0;
    this.notch = notch?.depth ?? 0;
    const r = Math.max(r0, r1);
    this.box(
      (base.x + tip.x) / 2,
      (base.y + tip.y) / 2,
      (base.z + tip.z) / 2,
      Math.abs(this.bx) / 2 + r,
      Math.abs(this.by) / 2 + r,
      Math.abs(this.bz) / 2 + r,
    );
  }

  distance(px: number, py: number, pz: number): number {
    const qx = px - this.ax;
    const qy = py - this.ay;
    const qz = pz - this.az;
    const t = clamp((qx * this.bx + qy * this.by + qz * this.bz) / this.length2, 0, 1);
    let r = this.r0 + (this.r1 - this.r0) * t;
    if (this.notch > 0) {
      const n = (py - this.notchY) / 5;
      r -= this.notch * Math.exp(-n * n);
    }
    return Math.hypot(qx - this.bx * t, qy - this.by * t, qz - this.bz * t) - r;
  }
}

/** An ellipsoid in its own frame: walls across the line, slabs, natural bridges, icebergs */
export class Slab extends BaseShape {
  private readonly axes: [Vector3, Vector3, Vector3];
  private readonly radii: [number, number, number];
  private readonly cut: number; // keep only above this height along the second axis (-Infinity: all of it)

  constructor(
    center: Vector3,
    axes: [Vector3, Vector3, Vector3],
    radii: [number, number, number],
    look: ShapeLook = {},
    cut = -Infinity,
  ) {
    super(look, 2.5);
    this.axes = [axes[0].clone(), axes[1].clone(), axes[2].clone()];
    this.radii = radii;
    this.cut = cut;
    // A box around the rotated ellipsoid
    const extent = (i: 0 | 1 | 2) => Math.hypot(axes[0].getComponent(i) * radii[0], axes[1].getComponent(i) * radii[1], axes[2].getComponent(i) * radii[2]);
    this.box(center.x, center.y, center.z, extent(0), extent(1), extent(2));
  }

  distance(px: number, py: number, pz: number): number {
    const dx = px - this.cx;
    const dy = py - this.cy;
    const dz = pz - this.cz;
    const [a, b, c] = this.axes;
    const v = dx * b.x + dy * b.y + dz * b.z;
    const d = ellipsoid(dx * a.x + dy * a.y + dz * a.z, v, dx * c.x + dy * c.y + dz * c.z, ...this.radii);
    return this.cut > -Infinity ? Math.max(d, this.cut - v) : d;
  }
}

/** A ring of rock to fly through: an arch, or a sea arch half under water */
export class RockRing extends BaseShape {
  private readonly axis: Vector3;
  private readonly radius: number;
  private readonly tube: number;

  /** The tube is never thinner than `MIN_RADIUS` */
  constructor(center: Vector3, axis: Vector3, radius: number, tube: number, look: ShapeLook = {}) {
    tube = Math.max(tube, MIN_RADIUS);
    super(look, tube * 0.3);
    this.axis = axis.clone();
    this.radius = radius;
    this.tube = tube;
    const r = radius + tube;
    this.box(center.x, center.y, center.z, r, r, r);
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

/** The top of a giant mushroom: a dome with a flat underside */
export class Cap extends BaseShape {
  private readonly radius: number;
  private readonly height: number;

  constructor(x: number, y: number, z: number, radius: number, height: number, look: ShapeLook = {}) {
    super(look, radius * 0.04);
    this.radius = radius;
    this.height = height;
    this.box(x, y + height / 2, z, radius, height / 2 + 1, radius);
    this.cy = y;
  }

  distance(px: number, py: number, pz: number): number {
    const dy = py - this.cy;
    // The rim droops a little, like a real cap
    const r = Math.hypot(px - this.cx, pz - this.cz);
    const droop = (r / this.radius) ** 2 * this.height * 0.35;
    return Math.max(ellipsoid(px - this.cx, dy + droop, pz - this.cz, this.radius, this.height, this.radius), -dy - droop - 1.5);
  }
}

/**
 * A floating island from a 3D density field: the island's dome-and-cone
 * envelope eaten by warped 3D noise, so it gets overhangs, ledges and caves,
 * with tunnels bored right through (natural arches) and terraced tops.
 */
export class NoiseIsland extends BaseShape {
  /** Where the island is: its top's center and its size (waterfalls start from its rim) */
  readonly anchor: { x: number; y: number; z: number; size: number };
  private readonly island: Island;
  private readonly noise: Noise;
  private readonly amp: number;
  private readonly freq: number;
  private readonly terraces: number; // metres between ledges on top (0: none)
  private readonly top: number;
  private readonly holes: { a: Vector3; b: Vector3; r: number }[];

  constructor(
    x: number,
    y: number,
    z: number,
    size: number,
    yaw: number,
    noise: Noise,
    options: { amp?: number; holes?: { a: Vector3; b: Vector3; r: number }[]; terraces?: number; style?: IslandStyle } = {},
    look: ShapeLook = {},
  ) {
    super(look, size * 0.05);
    this.anchor = { x, y, z, size };
    this.island = new Island(x, y, z, size, yaw, options.style);
    this.noise = noise;
    this.amp = (options.amp ?? 0.16) * size;
    this.freq = 2.2 / size;
    this.terraces = options.terraces ?? 0;
    this.top = y;
    this.holes = options.holes ?? [];
    const { min, max } = this.island;
    const pad = this.amp;
    this.box((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2, (max.x - min.x) / 2 + pad, (max.y - min.y) / 2 + pad, (max.z - min.z) / 2 + pad);
    this.cy = this.island.cy;
  }

  distance(px: number, py: number, pz: number): number {
    // Ledges: below the top, step the height so the slopes break into terraces
    let qy = py;
    if (this.terraces > 0 && py < this.top + this.terraces) {
      const k = (this.top - py) / this.terraces;
      const f = k - Math.floor(k);
      qy = py + this.terraces * 0.45 * Math.sin(f * Math.PI * 2) * 0.35;
    }
    let d = this.island.distance(px, qy, pz);
    if (d > this.amp * 1.6) return d;
    const f = this.freq;
    const n = this.noise.n3;
    // Warp the lookup, so the noise curls into overhangs instead of blobs
    const wx = px + n(px * f * 0.5, py * f * 0.5, pz * f * 0.5 + 7.1) * this.amp;
    const wy = py + n(px * f * 0.5 + 3.3, py * f * 0.5, pz * f * 0.5) * this.amp * 0.6;
    const wz = pz + n(px * f * 0.5, py * f * 0.5 - 5.7, pz * f * 0.5) * this.amp;
    d += this.amp * (n(wx * f, wy * f, wz * f) * 0.7 + n(wx * f * 2.3, wy * f * 2.3, wz * f * 2.3) * 0.3);
    for (const hole of this.holes) d = smax(d, hole.r - segmentDistance(px, py, pz, hole.a, hole.b), 3);
    return d;
  }
}

export interface BridgeSpan {
  half: number; // half its length, from the crown to where it meets the ground
  width: number; // of the deck
  crown: number; // top of the deck above the water, in the middle
  foot: number; // …and at its ends
  arch: [number, number]; // the opening underneath: half width and rise above the water
  depth: number; // the abutments reach this far below the water
}

/**
 * A humped stone bridge across a river: the deck rises to a crown over one
 * arch, wide and tall enough to fly through. Chunky on purpose: the land is
 * meshed on a 6 m grid, and anything thinner comes out in tatters.
 */
export class Bridge extends BaseShape {
  private readonly water: number;
  private readonly ax: number;
  private readonly az: number;
  private readonly span: BridgeSpan;

  /** `center` on the water in mid-river, `along` the horizontal unit vector from bank to bank */
  constructor(center: Vector3, along: Vector3, span: BridgeSpan, look: ShapeLook = {}) {
    super(look, 0.25);
    this.water = center.y;
    this.ax = along.x;
    this.az = along.z;
    this.span = span;
    const hx = Math.abs(along.x) * span.half + Math.abs(along.z) * span.width * 0.5;
    const hz = Math.abs(along.z) * span.half + Math.abs(along.x) * span.width * 0.5;
    this.box(center.x, center.y + (span.crown - span.depth) / 2, center.z, hx, (span.crown + span.depth) / 2, hz);
  }

  distance(px: number, py: number, pz: number): number {
    const s = this.span;
    const dx = px - this.cx;
    const dz = pz - this.cz;
    const u = dx * this.ax + dz * this.az;
    const w = dz * this.ax - dx * this.az;
    const v = py - this.water;
    const k = Math.max(0, 1 - (u / s.half) ** 2);
    const top = s.foot + (s.crown - s.foot) * k;
    // (the deck slopes, so its height difference overstates the distance: scaled down to stay a bound)
    const side = Math.abs(w) - s.width / 2;
    const over = (v - top) * 0.75;
    const end = Math.abs(u) - s.half;
    const under = -v - s.depth;
    const body = Math.min(Math.max(side, over, end, under), 0) + Math.hypot(Math.max(side, 0), Math.max(over, 0), Math.max(end, 0), Math.max(under, 0));
    const opening = (1 - Math.hypot(u / s.arch[0], v / s.arch[1])) * Math.min(s.arch[0], s.arch[1]);
    return Math.max(body, opening);
  }
}

/** A volcanic cone standing on the ground, its flanks curving in to a rim around a crater */
export class Volcano extends BaseShape {
  private readonly x: number;
  private readonly z: number;
  private readonly base: number;
  private readonly top: number;
  private readonly radius: number; // at the foot
  private readonly rim: number; // radius at the top
  private readonly slope: number;

  constructor(x: number, z: number, base: number, top: number, radius: number, look: ShapeLook = {}) {
    super(look, radius * 0.03);
    this.x = x;
    this.z = z;
    this.base = base;
    this.top = top;
    this.radius = radius;
    this.rim = radius * 0.28;
    const h = top - base;
    this.slope = h / Math.hypot(h, radius - this.rim);
    this.box(x, (base + top) / 2, z, radius, h / 2 + this.rim * 0.3, radius);
  }

  distance(px: number, py: number, pz: number): number {
    const dx = px - this.x;
    const dz = pz - this.z;
    const t = clamp((py - this.base) / (this.top - this.base), 0, 1);
    // Concave flanks: wide at the foot, steepening towards the rim
    const r = this.rim + (this.radius - this.rim) * (1 - t) ** 1.6;
    const side = (Math.hypot(dx, dz) - r) * this.slope;
    let d = Math.max(side, py - this.top, this.base - py);
    // The crater, a bowl sunk into the top
    const bowl = this.rim * 0.85 - Math.hypot(dx, py - (this.top + this.rim * 0.3), dz);
    d = smax(d, bowl, this.rim * 0.15);
    return d;
  }
}

/** Distance from a point to a line segment */
export function segmentDistance(px: number, py: number, pz: number, a: Vector3, b: Vector3): number {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const bz = b.z - a.z;
  const qx = px - a.x;
  const qy = py - a.y;
  const qz = pz - a.z;
  const t = clamp((qx * bx + qy * by + qz * bz) / Math.max(1e-6, bx * bx + by * by + bz * bz), 0, 1);
  return Math.hypot(qx - bx * t, qy - by * t, qz - bz * t);
}

export const UP = new Vector3(0, 1, 0);

/** A unit vector at an angle from up, towards `azimuth` (radians) */
export function tilted(angle: number, azimuth: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(angle) * Math.cos(azimuth), Math.cos(angle), Math.sin(angle) * Math.sin(azimuth));
}
