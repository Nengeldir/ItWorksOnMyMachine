import { Vector3 } from "three";
import { clamp } from "../../math";
import { type Rng, range } from "../../rng";
import type { Feature, GateKind, LandRecipe } from "../biomes/types";
import { type Course, TUBE_RADIUS } from "../course";
import { type Area, perCell } from "../open";
import type { TerrainField } from "./field";
import type { Ground } from "./ground";
import type { Noise } from "./noise";
import { Bridge, Cap, Grain, Mesa, NoiseIsland, RockRing, type ShapeLook, Slab, Spire, UP, Volcano, tilted } from "./shapes";

// Places a biome's rock shapes: something to thread at every gate, and scenery
// around the line. Everything comes from the level's seeded streams, in a fixed
// order, so every client builds the same land.

export interface LandContext {
  course: Course;
  field: TerrainField;
  ground: Ground | null;
  rng: Rng;
  noise: Noise;
  /** Height of the sea at z, if the biome has one (stacks get a wave-cut notch there) */
  seaAt: ((z: number) => number | null) | null;
  /** An open world's cell: its share of every feature goes anywhere in it (null: along a level's line) */
  area?: Area | null;
}

const p = new Vector3();
const t = new Vector3();
const side = new Vector3();
const up = new Vector3();

/** The racing line's frame at z: point, tangent, sideways and up */
function frame(course: Course, z: number) {
  course.pointAt(z, p);
  course.tangentAt(z, t);
  side.crossVectors(t, UP).normalize();
  up.crossVectors(side, t).normalize();
}

/** A point in the line's frame */
function offset(s: number, u: number, f = 0): Vector3 {
  return p.clone().addScaledVector(side, s).addScaledVector(up, u).addScaledVector(t, f);
}

/** Ground height, or a floor well below the line where there is no ground */
function groundAt(ctx: LandContext, x: number, z: number, fallback: number): number {
  return ctx.ground ? ctx.ground.height(x, z) : fallback;
}

/** Picks a key by weight */
function weighted<K extends string>(rng: Rng, weights: Partial<Record<K, number>>): K {
  const entries = Object.entries(weights) as [K, number][];
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function buildLand(ctx: LandContext, recipe: LandRecipe) {
  const { course, rng } = ctx;
  for (const z of course.gates) {
    frame(course, z);
    buildGate(ctx, weighted(rng, recipe.gates), z, { surface: recipe.gateSurface }, recipe);
  }
  for (const feature of recipe.features) buildFeature(ctx, feature);
}

/**
 * An open world's cell: its share of every feature, from `ctx.rng`, the cell's own stream. No
 * gates: there is no line to thread.
 */
export function buildLandCell(ctx: LandContext, recipe: LandRecipe, area: Area) {
  const cellCtx = { ...ctx, area };
  for (const feature of recipe.features) buildFeature(cellCtx, feature);
}

/** How many of a feature to place: a level's count, or an open world's cell's share of it */
function countOf(ctx: LandContext, count: number, lateral: [number, number]): number {
  return ctx.area ? perCell(ctx.rng, count, lateral[1]) : count;
}

/** A level's one-off features (a volcano, a summit) stand in about one open world cell in this many */
const ONE_OFF_CELLS = 8;

/** A spire, notched by the waves where it stands in the sea */
function column(ctx: LandContext, base: Vector3, tip: Vector3, r0: number, r1: number, look: ShapeLook): Spire {
  const sea = ctx.seaAt ? ctx.seaAt(base.z) : null;
  const notch = sea !== null && base.y < sea && tip.y > sea + 4 ? { y: sea + 1.5, depth: r0 * 0.22 } : undefined;
  return new Spire(base, tip, r0, r1, look, notch);
}

function buildGate(ctx: LandContext, kind: GateKind, z: number, look: ShapeLook, recipe: LandRecipe) {
  const { field, rng } = ctx;
  const floor = groundAt(ctx, p.x, z, p.y - 120);
  const below = p.y - floor; // metres from the line down to the ground
  if (kind === "arch") {
    // A ring of rock standing over the line, its foot sunk into the ground
    const radius = clamp(below + range(rng, 3, 8), TUBE_RADIUS + 5, 46);
    const center = offset(range(rng, -4, 4), radius - below > 30 ? range(rng, -6, 6) : 0);
    field.add(new RockRing(center, t, radius, range(rng, 4.5, 7), { ...look, grain: Grain.Layered }));
  } else if (kind === "pillars") {
    // Two pillars either side of the line, close enough to make you think
    for (const s of [-1, 1]) {
      const r0 = range(rng, 6, 10);
      const base = offset(s * (TUBE_RADIUS + r0 + range(rng, 1, 6)), 0, range(rng, -6, 6));
      const bottom = groundAt(ctx, base.x, base.z, base.y - 140) - 8;
      field.add(column(ctx, new Vector3(base.x, bottom, base.z), new Vector3(base.x, p.y + range(rng, 20, 50), base.z), r0, r0 * range(rng, 0.55, 0.8), { ...look, grain: Grain.Fluted }));
    }
  } else if (kind === "needles") {
    // A slalom of rock needles on both sides
    const count = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const r0 = range(rng, 3, 6);
      const s = (i % 2 ? 1 : -1) * (TUBE_RADIUS + r0 + range(rng, 1, 9));
      const base = offset(s, 0, (i - count / 2) * 12 + range(rng, -4, 4));
      const bottom = groundAt(ctx, base.x, base.z, base.y - range(rng, 30, 60)) - 6;
      field.add(new Spire(new Vector3(base.x, bottom, base.z), new Vector3(base.x, base.y + range(rng, 15, 45), base.z), r0, r0 * range(rng, 0.3, 0.6), { ...look, grain: Grain.Fluted }));
    }
  } else if (kind === "shards") {
    // Leaning spikes on both sides, sharp as broken glass
    const count = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const r0 = range(rng, 3.5, 6.5);
      const s = (i % 2 ? 1 : -1) * (TUBE_RADIUS + r0 + range(rng, 2, 10));
      const base = offset(s, 0, (i - count / 2) * 13 + range(rng, -4, 4));
      const bottom = groundAt(ctx, base.x, base.z, base.y - range(rng, 30, 60)) - 6;
      const height = base.y + range(rng, 12, 40) - bottom;
      // Lean away from the line, so the tips frame it instead of closing it
      const lean = tilted(range(rng, 0.15, 0.45), Math.atan2(side.z * Math.sign(s), side.x * Math.sign(s)));
      const tip = new Vector3(base.x, bottom, base.z).addScaledVector(lean, height);
      field.add(new Spire(new Vector3(base.x, bottom, base.z), tip, r0, r0 * 0.08, { ...look, grain: Grain.Sharp, roughness: r0 * 0.12 }));
    }
  } else if (kind === "mushroom") {
    // Two giant mushrooms either side; their caps meet over the line
    for (const s of [-1, 1]) {
      const foot = offset(s * (TUBE_RADIUS + range(rng, 6, 12)), 0, range(rng, -8, 8));
      const bottom = groundAt(ctx, foot.x, foot.z, foot.y - 120) - 4;
      const capY = p.y + range(rng, 12.5, 16);
      const r0 = range(rng, 3, 5);
      const top = new Vector3(foot.x - side.x * s * 3, capY, foot.z - side.z * s * 3);
      field.add(new Spire(new Vector3(foot.x, bottom, foot.z), top, r0, r0 * 0.75, { surface: recipe.named?.stem ?? look.surface, grain: Grain.Fluted }));
      field.add(new Cap(top.x, capY, top.z, range(rng, 15, 22), range(rng, 5, 7), { surface: recipe.named?.cap ?? look.surface }));
    }
  } else if (kind === "roots") {
    // Two thick roots arching over the line, crossing
    for (let i = 0; i < 2; i++) {
      const radius = clamp(below + range(rng, 2, 6), TUBE_RADIUS + 4, 34);
      const axis = t.clone().applyAxisAngle(UP, (i ? 1 : -1) * range(rng, 0.25, 0.45)).normalize();
      const center = offset(range(rng, -3, 3), 0, i * range(rng, 6, 12));
      field.add(new RockRing(center, axis, radius, range(rng, 2.2, 3.4), { ...look, grain: Grain.Fluted }));
    }
  } else if (kind === "spur") {
    // A ridge across the valley: the racing line bores a tunnel through it
    const radii: [number, number, number] = [range(rng, 110, 180), range(rng, 34, 50) + below * 0.5, range(rng, 14, 24)];
    field.add(new Slab(offset(range(rng, -20, 20), range(rng, -14, -2) - below * 0.25), [side, up, t], radii, { ...look, grain: Grain.Layered, roughness: 3.5 }));
  } else if (kind === "overhang") {
    // A shelf of rock reaching over the line from one side
    const s = rng() < 0.5 ? -1 : 1;
    const center = offset(s * range(rng, 14, 22), range(rng, 12, 17));
    const radii: [number, number, number] = [range(rng, 26, 36), range(rng, 5, 8), range(rng, 12, 18)];
    field.add(new Slab(center, [side, up, t], radii, { ...look, grain: Grain.Layered, roughness: 2 }));
    // Its root in the valley side
    const root = offset(s * range(rng, 38, 48), 0);
    const bottom = groundAt(ctx, root.x, root.z, root.y - 100) - 10;
    field.add(new Spire(new Vector3(root.x, bottom, root.z), new Vector3(root.x, center.y + 4, root.z), range(rng, 12, 18), range(rng, 8, 12), { ...look, grain: Grain.Layered }));
  } else if (kind === "tunnel") {
    // A floating island right on the line, with the tube bored through
    const size = range(rng, 30, 50);
    field.add(new NoiseIsland(p.x, p.y + size * range(rng, 0.05, 0.3), p.z, size, range(rng, 0, Math.PI * 2), ctx.noise, {}, look));
  } else if (kind === "squeeze") {
    // One island overhead, one below: fly through the gap
    const over = range(rng, 30, 46);
    const under = range(rng, 26, 40);
    const a = offset(range(rng, -8, 8), over * 0.75);
    const b = offset(range(rng, -8, 8), -under * 0.25 - 6, 10);
    field.add(new NoiseIsland(a.x, a.y, a.z, over, range(rng, 0, 6.28), ctx.noise, {}, look));
    field.add(new NoiseIsland(b.x, b.y, b.z, under, range(rng, 0, 6.28), ctx.noise, {}, look));
  }
}

/** A spot near the line: z along the course, then sideways by a lateral range either side */
function scatter(ctx: LandContext, lateral: [number, number], spread = 300): { x: number; z: number; s: number } {
  const { course, rng, area } = ctx;
  if (area) {
    // Anywhere in the cell; the frame's point gives the height things are measured from (y = 0)
    const x = range(rng, area.x0, area.x1);
    const z = range(rng, area.z0, area.z1);
    frame(course, z);
    return { x, z, s: x };
  }
  const z = range(rng, course.start.z - spread, course.endZ + spread);
  frame(course, z);
  const s = (rng() < 0.5 ? -1 : 1) * range(rng, lateral[0], lateral[1]);
  return { x: p.x + side.x * s, z: p.z + side.z * s, s };
}

function buildFeature(ctx: LandContext, f: Feature) {
  const { field, rng } = ctx;
  const look = { surface: f.surface };
  if (f.kind === "pillars") {
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const g = groundAt(ctx, x, z, p.y - 200);
      const r0 = range(rng, f.radius[0], f.radius[1]);
      field.add(column(ctx, new Vector3(x, g - 10, z), new Vector3(x + range(rng, -3, 3), g + range(rng, f.rise[0], f.rise[1]), z + range(rng, -3, 3)), r0, r0 * range(rng, 0.5, 0.85), { ...look, grain: Grain.Fluted }));
    }
  } else if (f.kind === "shards") {
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const g = groundAt(ctx, x, z, p.y - 160);
      const r0 = range(rng, f.radius[0], f.radius[1]);
      const tip = new Vector3(x, g - 6, z).addScaledVector(tilted(range(rng, 0, f.tilt), range(rng, 0, Math.PI * 2)), range(rng, f.rise[0], f.rise[1]));
      field.add(new Spire(new Vector3(x, g - 6, z), tip, r0, r0 * 0.07, { ...look, grain: Grain.Sharp, roughness: r0 * 0.12 }));
    }
  } else if (f.kind === "trunks") {
    // Giant trees: a fluted trunk with a crown of leafy blobs at the top
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const g = groundAt(ctx, x, z, p.y - 160);
      const r = range(rng, f.radius[0], f.radius[1]);
      const top = new Vector3(x + range(rng, -4, 4), g + range(rng, f.rise[0], f.rise[1]), z + range(rng, -4, 4));
      field.add(new Spire(new Vector3(x, g - 8, z), top, r, r * 0.55, { ...look, grain: Grain.Fluted, roughness: r * 0.15 }));
      for (let k = 0; k < 3; k++) {
        const a = range(rng, 0, Math.PI * 2);
        const c = top.clone().add(new Vector3(Math.cos(a) * r * 1.6, -range(rng, 0, r * 2.5), Math.sin(a) * r * 1.6));
        const yaw = new Vector3(Math.cos(a), 0, Math.sin(a));
        field.add(new Slab(c, [yaw, UP.clone(), new Vector3(-yaw.z, 0, yaw.x)], [r * range(rng, 2.6, 3.4), r * range(rng, 1.3, 1.8), r * range(rng, 2.4, 3.2)], { surface: f.canopy, roughness: r * 0.35 }));
      }
    }
  } else if (f.kind === "mushrooms") {
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const g = groundAt(ctx, x, z, p.y - 160);
      const cap = range(rng, f.cap[0], f.cap[1]);
      const r0 = cap * range(rng, 0.14, 0.2);
      const top = new Vector3(x + range(rng, -4, 4), g + range(rng, f.rise[0], f.rise[1]), z + range(rng, -4, 4));
      field.add(new Spire(new Vector3(x, g - 4, z), top, r0, r0 * 0.75, { surface: f.stem, grain: Grain.Fluted }));
      field.add(new Cap(top.x, top.y, top.z, cap, cap * range(rng, 0.28, 0.4), { surface: f.surface }));
    }
  } else if (f.kind === "islets") {
    // Low sandy islands just breaking the sea's surface
    if (!ctx.seaAt) return;
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const sea = ctx.seaAt(z)!;
      const r = range(rng, f.radius[0], f.radius[1]);
      const h = range(rng, 6, 10);
      const yaw = range(rng, 0, Math.PI);
      const a = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      field.add(new Slab(new Vector3(x, sea - h * 0.6, z), [a, UP.clone(), new Vector3(-a.z, 0, a.x)], [r, h, r * range(rng, 0.55, 1)], { ...look, roughness: r * 0.04 }));
    }
  } else if (f.kind === "rings") {
    // Floating rings of crystal or stone, tilted every way
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const radius = range(rng, f.radius[0], f.radius[1]);
      const axis = tilted(range(rng, 1.1, 1.57), range(rng, 0, Math.PI * 2));
      field.add(new RockRing(new Vector3(x, ctx.course.y(z) + range(rng, f.rise[0], f.rise[1]), z), axis, radius, radius * range(rng, 0.09, 0.14), { ...look, grain: Grain.Sharp }));
    }
  } else if (f.kind === "volcano") {
    const { course } = ctx;
    if (ctx.area && rng() * ONE_OFF_CELLS >= 1) return;
    const z = ctx.area ? range(rng, ctx.area.z0, ctx.area.z1) : range(rng, course.start.z + 500, course.endZ - 300);
    frame(course, z);
    const s = (rng() < 0.5 ? -1 : 1) * f.lateral;
    const x = ctx.area ? range(rng, ctx.area.x0, ctx.area.x1) : p.x + side.x * s;
    const vz = ctx.area ? z : p.z + side.z * s;
    const g = groundAt(ctx, x, vz, p.y - 300);
    field.add(new Volcano(x, vz, g - 30, g + f.rise, f.radius, { ...look, grain: Grain.Layered }));
  } else if (f.kind === "bridges") {
    const { course } = ctx;
    const steps = ctx.ground?.steps;
    if (!steps?.river) return;
    for (const fall of steps.falls) {
      if (fall.z < course.start.z + 150 || fall.z > course.endZ - 60) continue;
      if (rng() > f.chance) continue;
      // The arch must take the whole river, and the crown stay well under the racing line
      const rise = 13;
      const crown = rise + 6;
      let z = NaN;
      for (const back of [44, 58, 74, 92]) {
        const at = fall.z - back;
        const clear = course.y(at) - steps.pool(at).level - crown > TUBE_RADIUS + 7;
        if (clear && steps.width(at) < 34 && steps.pool(at) === steps.pool(fall.z - 1)) {
          z = at;
          break;
        }
      }
      if (Number.isNaN(z) || course.gates.some((g) => Math.abs(g - z) < 22)) continue;
      const flow = new Vector3(steps.center(z + 4) - steps.center(z - 4), 0, 8).normalize();
      const across = new Vector3(flow.z, 0, -flow.x);
      const reach = steps.width(z) / 2 + 3.5;
      const span = { half: reach + 22, width: f.width, crown, foot: steps.river.bank + 0.5, arch: [reach, rise] as [number, number], depth: steps.river.bed + 6 };
      field.add(new Bridge(new Vector3(steps.center(z), steps.pool(z).level, z), across, span, { ...look, grain: Grain.Layered }));
    }
  } else if (f.kind === "summit") {
    // One colossal spire, and a few lesser ones around it
    const { course } = ctx;
    if (ctx.area && rng() * ONE_OFF_CELLS >= 1) return;
    const z = ctx.area ? range(rng, ctx.area.z0, ctx.area.z1) : course.start.z + (course.endZ - course.start.z) * f.along;
    frame(course, z);
    const s = (rng() < 0.5 ? -1 : 1) * f.lateral;
    const x = ctx.area ? range(rng, ctx.area.x0, ctx.area.x1) : p.x + side.x * s;
    const sz = ctx.area ? z : p.z + side.z * s;
    const g = groundAt(ctx, x, sz, p.y - 320);
    field.add(new Spire(new Vector3(x, g - 20, sz), new Vector3(x, p.y + f.rise, sz), f.radius, f.radius * 0.2, { ...look, grain: Grain.Fluted, roughness: f.radius * 0.12 }));
    for (let k = 0; k < 4; k++) {
      const a = range(rng, 0, Math.PI * 2);
      const d = f.radius * range(rng, 1.4, 2.2);
      const r = f.radius * range(rng, 0.25, 0.4);
      const bx = x + Math.cos(a) * d;
      const bz = sz + Math.sin(a) * d;
      field.add(new Spire(new Vector3(bx, groundAt(ctx, bx, bz, g) - 10, bz), new Vector3(bx, p.y + f.rise * range(rng, 0.3, 0.6), bz), r, r * 0.2, { ...look, grain: Grain.Fluted }));
    }
  } else if (f.kind === "boulders") {
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral, 150);
      const g = groundAt(ctx, x, z, p.y - 100);
      const r = range(rng, f.size[0], f.size[1]);
      const yaw = range(rng, 0, Math.PI * 2);
      const a = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const c = new Vector3(-a.z, 0, a.x);
      field.add(new Slab(new Vector3(x, g + r * 0.15, z), [a, UP.clone(), c], [r * range(rng, 1, 1.5), r * range(rng, 0.6, 0.9), r], { ...look, roughness: r * 0.18 }));
    }
  } else if (f.kind === "arches") {
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const g = groundAt(ctx, x, z, p.y - 100);
      const radius = range(rng, f.radius[0], f.radius[1]);
      const yaw = range(rng, 0, Math.PI);
      field.add(new RockRing(new Vector3(x, g + radius * 0.25, z), new Vector3(Math.cos(yaw), 0, Math.sin(yaw)), radius, radius * range(rng, 0.22, 0.32), { ...look, grain: Grain.Layered }));
    }
  } else if (f.kind === "mesas") {
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const g = groundAt(ctx, x, z, p.y - 200);
      const r = range(rng, f.radius[0], f.radius[1]);
      field.add(
        new Mesa(x, z, g + range(rng, f.rise[0], f.rise[1]), g - 20, r, r * range(rng, 0.55, 0.9), range(rng, 0, Math.PI), { step: f.step, flare: 0.08 }, { ...look, grain: Grain.Layered, roughness: r * 0.05 }),
      );
    }
  } else if (f.kind === "islands") {
    for (let i = 0, n = countOf(ctx, f.count, f.lateral); i < n; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const size = range(rng, f.size[0], f.size[1]);
      const y = ctx.course.y(z) + range(rng, f.rise[0], f.rise[1]);
      const holes = [];
      if (rng() < f.holes) {
        const yaw = range(rng, 0, Math.PI);
        const dir = new Vector3(Math.cos(yaw), range(rng, -0.2, 0.2), Math.sin(yaw)).multiplyScalar(size * 1.3);
        const c = new Vector3(x, y - size * range(rng, 0.1, 0.35), z);
        holes.push({ a: c.clone().sub(dir), b: c.clone().add(dir), r: size * range(rng, 0.14, 0.22) });
      }
      field.add(new NoiseIsland(x, y, z, size, range(rng, 0, Math.PI * 2), ctx.noise, { holes }, look));
    }
  }
}

