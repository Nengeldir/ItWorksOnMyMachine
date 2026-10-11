import { TERRAIN_DETAIL } from "../../tuning";
import { clamp, smoothstep } from "../../math";
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
//
// An open world (Zen) has no line, so its ground is made the way open-world
// games blend terrain (Minecraft's continentalness and erosion, a wide warped
// mask): a slow region noise says lowland or mountains, with kilometres
// between; the land rises from plains through foothills onto the shoulder a
// range stands on, and only its core gets the ridged peaks. A network of
// valleys meanders every way, a river (or lava, ice...) along each at one
// level (`waterLevel`); the valleys are carved through it all, their sides as
// wide as the land is high, so slopes stay bounded and nothing rises sheer off
// a flat floor. No steps, no falls.

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
/** Open world: metres per unit of the region noise (lowlands and ranges several kilometres across) */
const REGION_SCALE = 5200;
/** Open world: the region noise goes from lowland (0) to mountains (1) between these values */
const REGION_LOW = 0.33;
const REGION_HIGH = 0.64;
/** Open world: metres per unit of the valley noise (valleys come about 2 to 5 km apart) */
const VALLEY_SCALE = 4200;
/** Open world: metres the valleys are pushed about by, so they meander */
const VALLEY_WARP = 260;
/**
 * Open world: distance from a valley is the valley noise over its slope (per unit of `VALLEY_SCALE`).
 * Near a valley, the slope there, kept between these (so a valley is as wide where the warp packs
 * the noise tight); further out, the usual slope `VALLEY_GRADIENT_FAR`. The slope there alone jumps
 * where the noise flattens, and far out even a small change moves the distance a lot: a cliff
 */
const VALLEY_GRADIENT: [number, number] = [2, 5];
const VALLEY_GRADIENT_FAR = 3.5;

export class Ground {
  readonly spec: GroundSpec;
  readonly steps: Steps | null;
  private readonly course: Course;
  private readonly noise: Noise;
  private readonly flatLevel: number;
  private readonly mountainReach: number;
  /** An open world (no line: valleys every way, see `openHeight`) */
  readonly open: boolean;
  /** An open world's water: the level its rivers and lakes stand at, if it has any */
  readonly waterLevel: number | null;

  constructor(course: Course, spec: GroundSpec, rng: Rng, noise: Noise) {
    this.course = course;
    this.spec = spec;
    this.noise = noise;
    this.open = course.open;
    this.steps = spec.steps && !this.open ? new Steps(course, spec.steps, spec.river, rng, noise) : null;
    this.flatLevel = spec.level === null ? 0 : this.open ? spec.level : course.y(course.endZ) + spec.level;
    this.waterLevel = this.open && spec.river ? (spec.level ?? -spec.depth) - spec.river.bank : null;
    this.mountainReach = spec.mountains ? spec.mountains.from - 120 : Infinity;
  }

  /** The ground's height at (x, z) */
  height(x: number, z: number): number {
    return this.heightAt(x, z, this.course.x(z), this.course.y(z));
  }

  /** The height, given the racing line's x and y at this z (callers that sample columns reuse them) */
  heightAt(x: number, z: number, lineX: number, lineY: number): number {
    if (this.open) return this.openHeight(x, z);
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
      if (mask > 0) {
        h += m.amp * mask * warpedRidged(n, x / m.scale, z / m.scale, m.warp, 5, m.sharpness);
        // Medium-scale relief lives in the heightfield, so it stays attached
        // instead of creating disconnected 3D-noise sheets above steep slopes.
        // All LODs sample this same bounded field; finer cells reveal its facets.
        h += s.roughness * TERRAIN_DETAIL.mountainRelief * mask *
          (0.7 * n(x * 0.045, z * 0.045) + 0.3 * n(x * 0.11, z * 0.11));
      }
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

  /** Open world: the ground's height (see the top of this file) */
  private openHeight(x: number, z: number): number {
    const s = this.spec;
    const n = this.noise.n2;
    const floor = s.level ?? -s.depth;
    // Lowland (0) to mountains (1): a slow noise, warped so its edges aren't round
    const wx = x + 900 * n(x / 4000 + 2.2, z / 4000 - 6.1);
    const wz = z + 900 * n(x / 4000 - 3.4, z / 4000 + 9.7);
    const region = smoothstep(REGION_LOW, REGION_HIGH, 0.5 + 0.5 * fbm(n, wx / REGION_SCALE + 7.7, wz / REGION_SCALE - 1.9, 3));
    // Metres the land stands above the valley floor, before the valleys are carved
    let relief = 0;
    // Rolling hills everywhere, growing into foothills towards the mountains
    if (s.hills) relief += s.hills.amp * (0.35 + 1.1 * smoothstep(0, 0.7, region)) * (0.55 + 0.45 * fbm(n, x / s.hills.scale, z / s.hills.scale, 4));
    if (s.mountains) {
      const m = s.mountains;
      const core = smoothstep(0.3, 1, region);
      if (core > 0) {
        // The shoulder a range stands on, then its ridged peaks, sharper towards its heart (a level's
        // backdrop mountains are sharper: these are flown over and through)
        relief += m.amp * 0.3 * core;
        relief += m.amp * core * core * warpedRidged(n, x / m.scale, z / m.scale, m.warp, 4, 1 + (m.sharpness - 1) * core * 0.6);
        relief += s.roughness * TERRAIN_DETAIL.mountainRelief * core * (0.7 * n(x * 0.045, z * 0.045) + 0.3 * n(x * 0.11, z * 0.11));
      }
    }
    // The valleys, carved through it all: the land eases down to the floor over a width that grows
    // with its height, so the steepest a valley side gets is about the biome's wall slope
    const a = this.valleyDistance(x, z);
    const slope = clamp(s.wall * 1.4, 0.38, 0.7);
    const width = s.valley + Math.max(relief, 0) / slope;
    let h = floor + relief * smoothstep(s.valley * 0.25, width, a);
    if (s.floorHills) h += s.floorHills * fbm(n, x / 45, z / 45, 2);
    if (s.terraces) {
      const t = s.terraces;
      const cover = 0.5 + 0.5 * fbm(n, x / 320 + 11.1, z / 320, 2);
      const mask = smoothstep(1 - t.cover - 0.08, 1 - t.cover + 0.08, cover) * smoothstep(s.valley, s.valley + 60, a);
      if (mask > 0) h += (terrace(h - floor, t.step, t.sharpness) + floor - h) * mask;
    }
    if (s.crevasses && a < s.valley + 30) {
      const c = s.crevasses;
      const crack = Math.abs(Math.sin((Math.PI * z) / c.spacing + 2.2 * n(x / 90, z / 90)));
      const open = 1 - smoothstep(0, c.width / c.spacing, crack);
      if (open > 0) h -= c.depth * open * smoothstep(s.valley + 30, s.valley - 10, a) * (0.6 + 0.4 * n(x / 30, z / 50));
    }
    if (this.waterLevel !== null && s.river) {
      // The river along the valley's middle, widening with a slow noise and now and then into a lake
      const r = s.river;
      const lake = r.lakes > 0 ? smoothstep(1 - r.lakes * 1.2, 1, 0.5 + 0.5 * n(x / 900 - 4.2, z / 900 + 8.6)) : 0;
      const w = (r.width[0] + (r.width[1] - r.width[0]) * (0.5 + 0.5 * n(x / 400 + 1.7, z / 400 - 3.3))) * (0.5 + lake * 1.6);
      if (a < w + BANK_WIDTH) {
        const level = this.waterLevel;
        const channel = a < w ? level - 0.4 - r.bed * (1 - (a / w) ** 2) : level - 0.4 + (r.bank + 0.4) * smoothstep(w, w + BANK_WIDTH, a);
        if (channel < h) h = channel;
      }
    }
    return h;
  }

  /** Open world: about the metres to the middle of the nearest valley, where the warped valley noise crosses zero */
  valleyDistance(x: number, z: number): number {
    const v = this.valleyNoise(x, z);
    const slope = (Math.hypot(this.valleyNoise(x + 6, z) - v, this.valleyNoise(x, z + 6) - v) / 6) * VALLEY_SCALE;
    const near = clamp(slope, VALLEY_GRADIENT[0], VALLEY_GRADIENT[1]);
    return (Math.abs(v) * VALLEY_SCALE) / (near + (VALLEY_GRADIENT_FAR - near) * smoothstep(0.02, 0.12, Math.abs(v)));
  }

  /** Open world: the noise whose zeros are the valleys' middles */
  valleyNoise(x: number, z: number): number {
    const n = this.noise.n2;
    const wx = x + VALLEY_WARP * n(x / 1500 + 5.3, z / 1500 - 2.1);
    const wz = z + VALLEY_WARP * n(x / 1500 - 7.7, z / 1500 + 4.4);
    return n(wx / VALLEY_SCALE + 31.7, wz / VALLEY_SCALE - 12.9);
  }

  /** Signed distance to the ground, with overhangs carved into steep slopes */
  distance(x: number, y: number, z: number): number {
    return this.sample(x, y, z).distance;
  }

  /** Reuse the slope correction for detail as well as the base distance. */
  sample(x: number, y: number, z: number): { distance: number; detailScale: number } {
    const lineX = this.course.x(z);
    const lineY = this.course.y(z);
    const h = this.heightAt(x, z, lineX, lineY);
    const gx = this.heightAt(x + 1, z, lineX, lineY) - h;
    const gz = this.height(x, z + 1) - h;
    return { distance: this.shape(x, y, z, h, gx, gz), detailScale: 1 / Math.sqrt(1 + gx * gx + gz * gz) };
  }

  /** Distance from height and slope, shared with the mesher's column cache */
  shape(x: number, y: number, z: number, h: number, gx: number, gz: number): number {
    const slope2 = gx * gx + gz * gz;
    const detailScale = 1 / Math.sqrt(1 + slope2);
    let d = (y - h) * detailScale;
    const o = this.spec.overhang;
    if (o > 0 && d < o * 2 && d > -o * 2) {
      const steep = smoothstep(0.6, 2.2, Math.sqrt(slope2));
      if (steep > 0) {
        const n = this.noise.n3;
        // Adding unscaled noise to a slope-normalized distance amplified it
        // vertically by the gradient, creating sheets far above sharp peaks.
        d += o * steep * detailScale * (n(x / 22, y / 14, z / 22) * 0.75 + n(x / 9, y / 9, z / 9) * 0.25);
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
