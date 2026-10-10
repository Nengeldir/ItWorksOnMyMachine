import { smoothstep } from "../../math";
import type { Rng } from "../../rng";
import type { Course } from "../course";
import { fbm, type Noise, terrace, warpedRidged } from "./noise";
import { type RiverSpec, type StepSpec, Steps } from "./river";

// The ground: a heightfield that follows the racing line. A valley floor runs
// under the line (stepped into pools and falls if the biome has them), its
// sides rise into hills, and further out domain-warped ridged mountains take
// over. Terraces, crevasses and a carved river channel shape it further, and
// 3D noise on steep slopes adds overhangs. As a distance field it is
// (y - h) / sqrt(1 + |∇h|²), which stays close to the true distance on slopes,
// so proximity scoring works on hillsides as well as on the flat.

export interface GroundSpec {
  depth: number; // valley floor below the racing line (when there are no steps)
  steps: StepSpec | null; // a floor that steps down in flat pools and falls
  river: RiverSpec | null; // water (or lava, ice…) in the steps
  valley: number; // half-width of the valley floor
  wall: number; // the valley sides rise this many metres per metre sideways…
  wallCurve: number; // …plus this per square metre, so they steepen
  floorHills: number; // bumps on the floor, metres
  hills: { amp: number; scale: number } | null; // rolling hills from the valley's edge
  mountains: { amp: number; scale: number; warp: number; sharpness: number; from: number; ramp: number } | null;
  terraces: { step: number; sharpness: number; cover: number } | null; // stepped hillsides (cover: share of the land)
  crevasses: { spacing: number; width: number; depth: number } | null; // cracks across the valley floor
  overhang: number; // metres of 3D noise on cliffs
  roughness: number; // metres of lumps everywhere
  falloff: { from: number; drop: number } | null; // beyond `from` metres sideways the land sinks away (into the clouds)
  level: number | null; // a flat floor this far above the lowest point of the line (sea floors), instead of following it
  extent: number; // the land reaches this far either side of the line
}

/** Metres either side of the river where its banks rise to the valley floor */
const BANK_WIDTH = 12;

export class Ground {
  readonly spec: GroundSpec;
  readonly steps: Steps | null;
  private readonly course: Course;
  private readonly noise: Noise;
  private readonly flatLevel: number;
  private readonly mountainReach: number;

  constructor(course: Course, spec: GroundSpec, rng: Rng, noise: Noise) {
    this.course = course;
    this.spec = spec;
    this.noise = noise;
    this.steps = spec.steps ? new Steps(course, spec.steps, spec.river, rng, noise) : null;
    this.flatLevel = spec.level === null ? 0 : course.y(course.endZ) + spec.level;
    this.mountainReach = spec.mountains ? spec.mountains.from - 120 : Infinity;
  }

  /** The ground's height at (x, z) */
  height(x: number, z: number): number {
    return this.heightAt(x, z, this.course.x(z), this.course.y(z));
  }

  /** The height, given the racing line's x and y at this z (callers that sample columns reuse them) */
  heightAt(x: number, z: number, lineX: number, lineY: number): number {
    const s = this.spec;
    const n = this.noise.n2;
    const a = Math.abs(x - lineX);
    const smooth = s.level !== null ? this.flatLevel : lineY - s.depth;
    let ref = smooth;
    const steps = this.steps;
    if (steps) {
      // The stepped floor near the valley, fading into the smooth slope further out
      const floor = steps.level(z) + (s.river ? s.river.bank : 0);
      ref = floor + (smooth - floor) * smoothstep(s.valley + 40, s.valley + 260, a);
    }
    const edge = a - s.valley + 25 * n(x * 0.004, z * 0.004);
    const side = Math.max(0, edge);
    let h = ref + s.wall * side + s.wallCurve * side * side;
    if (s.falloff) h -= s.falloff.drop * smoothstep(s.falloff.from, s.falloff.from + 320, a);
    if (s.floorHills) h += s.floorHills * fbm(n, x / 45, z / 45, 2);
    if (s.hills) {
      const grow = smoothstep(s.valley * 0.4, s.valley + 70, a);
      if (grow > 0) h += s.hills.amp * grow * (0.55 + 0.45 * fbm(n, x / s.hills.scale, z / s.hills.scale, 4));
    }
    if (s.mountains && a > this.mountainReach) {
      const m = s.mountains;
      const mask = smoothstep(m.from, m.from + m.ramp, a + 90 * n(x * 0.0021 + 3.1, z * 0.0021));
      if (mask > 0) h += m.amp * mask * warpedRidged(n, x / m.scale, z / m.scale, m.warp, 5, m.sharpness);
    }
    if (s.terraces) {
      const t = s.terraces;
      const cover = 0.5 + 0.5 * fbm(n, x / 320 + 11.1, z / 320, 2);
      const mask = smoothstep(1 - t.cover - 0.08, 1 - t.cover + 0.08, cover) * smoothstep(s.valley, s.valley + 60, a);
      if (mask > 0) h += (terrace(h - ref, t.step, t.sharpness) + ref - h) * mask;
    }
    if (s.crevasses && a < s.valley + 30) {
      const c = s.crevasses;
      const crack = Math.abs(Math.sin((Math.PI * z) / c.spacing + 2.2 * n(x / 90, z / 90)));
      const open = 1 - smoothstep(0, c.width / c.spacing, crack);
      if (open > 0) h -= c.depth * open * smoothstep(s.valley + 30, s.valley - 10, a) * (0.6 + 0.4 * n(x / 30, z / 50));
    }
    if (steps && s.river) {
      const r = s.river;
      const w = steps.width(z) / 2;
      const rd = Math.abs(x - steps.center(z));
      if (rd < w + BANK_WIDTH) {
        const level = steps.level(z);
        const channel =
          rd < w ? level - 0.4 - r.bed * (1 - (rd / w) ** 2) : level - 0.4 + (r.bank + 0.4) * smoothstep(w, w + BANK_WIDTH, rd);
        if (channel < h) h = channel;
      }
    }
    return h;
  }

  /** Signed distance to the ground, with overhangs carved into steep slopes */
  distance(x: number, y: number, z: number): number {
    const lineX = this.course.x(z);
    const lineY = this.course.y(z);
    const h = this.heightAt(x, z, lineX, lineY);
    const gx = this.heightAt(x + 1, z, lineX, lineY) - h;
    const gz = this.height(x, z + 1) - h;
    return this.shape(x, y, z, h, gx, gz);
  }

  /** Distance from height and slope, shared with the mesher's column cache */
  shape(x: number, y: number, z: number, h: number, gx: number, gz: number): number {
    const slope2 = gx * gx + gz * gz;
    let d = (y - h) / Math.sqrt(1 + slope2);
    const o = this.spec.overhang;
    if (o > 0 && d < o * 2 && d > -o * 2) {
      const steep = smoothstep(0.6, 2.2, Math.sqrt(slope2));
      if (steep > 0) {
        const n = this.noise.n3;
        d += o * steep * (n(x / 22, y / 14, z / 22) * 0.75 + n(x / 9, y / 9, z / 9) * 0.25);
      }
    }
    return d;
  }

  /** Lowest and highest ground over a rectangle (padded), for deciding which chunks to mesh */
  range(x0: number, z0: number, x1: number, z1: number): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      for (let k = 0; k <= steps; k++) {
        const h = this.height(x0 + ((x1 - x0) * i) / steps, z0 + ((z1 - z0) * k) / steps);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    // Ridges and cracks can sit between samples
    const pad = 12 + this.spec.overhang * 2 + this.spec.roughness * 2 + (this.spec.mountains ? this.spec.mountains.amp * 0.18 : 0);
    return [lo - pad - (this.spec.crevasses?.depth ?? 0) - (this.spec.river?.bed ?? 0), hi + pad];
  }
}
