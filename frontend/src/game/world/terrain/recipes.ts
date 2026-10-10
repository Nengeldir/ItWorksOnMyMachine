import { Vector3 } from "three";
import { clamp } from "../../math";
import { type Rng, range } from "../../rng";
import type { Feature, GateKind, LandRecipe } from "../biomes/types";
import { type Course, TUBE_RADIUS } from "../course";
import type { TerrainField } from "./field";
import type { Ground } from "./ground";
import type { Noise } from "./noise";
import { Grain, Mesa, NoiseIsland, RockRing, type ShapeLook, Slab, Spire, UP } from "./shapes";

// Places a biome's rock shapes: something to thread at every gate, and scenery
// around the line. Everything comes from the level's seeded streams, in a fixed
// order, so every client builds the same land.

export interface LandContext {
  course: Course;
  field: TerrainField;
  ground: Ground | null;
  rng: Rng;
  noise: Noise;
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
    buildGate(ctx, weighted(rng, recipe.gates), z, { surface: recipe.gateSurface });
  }
  for (const feature of recipe.features) buildFeature(ctx, feature);
}

function buildGate(ctx: LandContext, kind: GateKind, z: number, look: ShapeLook) {
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
      field.add(
        new Spire(new Vector3(base.x, bottom, base.z), new Vector3(base.x, p.y + range(rng, 20, 50), base.z), r0, r0 * range(rng, 0.55, 0.8), { ...look, grain: Grain.Fluted }),
      );
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
  const { course, rng } = ctx;
  const z = range(rng, course.start.z - spread, course.endZ + spread);
  frame(course, z);
  const s = (rng() < 0.5 ? -1 : 1) * range(rng, lateral[0], lateral[1]);
  return { x: p.x + side.x * s, z: p.z + side.z * s, s };
}

function buildFeature(ctx: LandContext, f: Feature) {
  const { field, rng } = ctx;
  const look = { surface: f.surface };
  if (f.kind === "pillars") {
    for (let i = 0; i < f.count; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const g = groundAt(ctx, x, z, p.y - 200);
      const r0 = range(rng, f.radius[0], f.radius[1]);
      field.add(new Spire(new Vector3(x, g - 10, z), new Vector3(x + range(rng, -3, 3), g + range(rng, f.rise[0], f.rise[1]), z + range(rng, -3, 3)), r0, r0 * range(rng, 0.5, 0.85), { ...look, grain: Grain.Fluted }));
    }
  } else if (f.kind === "boulders") {
    for (let i = 0; i < f.count; i++) {
      const { x, z } = scatter(ctx, f.lateral, 150);
      const g = groundAt(ctx, x, z, p.y - 100);
      const r = range(rng, f.size[0], f.size[1]);
      const yaw = range(rng, 0, Math.PI * 2);
      const a = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const c = new Vector3(-a.z, 0, a.x);
      field.add(new Slab(new Vector3(x, g + r * 0.15, z), [a, UP.clone(), c], [r * range(rng, 1, 1.5), r * range(rng, 0.6, 0.9), r], { ...look, roughness: r * 0.18 }));
    }
  } else if (f.kind === "arches") {
    for (let i = 0; i < f.count; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const g = groundAt(ctx, x, z, p.y - 100);
      const radius = range(rng, f.radius[0], f.radius[1]);
      const yaw = range(rng, 0, Math.PI);
      field.add(new RockRing(new Vector3(x, g + radius * 0.25, z), new Vector3(Math.cos(yaw), 0, Math.sin(yaw)), radius, radius * range(rng, 0.22, 0.32), { ...look, grain: Grain.Layered }));
    }
  } else if (f.kind === "mesas") {
    for (let i = 0; i < f.count; i++) {
      const { x, z } = scatter(ctx, f.lateral);
      const g = groundAt(ctx, x, z, p.y - 200);
      const r = range(rng, f.radius[0], f.radius[1]);
      field.add(
        new Mesa(x, z, g + range(rng, f.rise[0], f.rise[1]), g - 20, r, r * range(rng, 0.55, 0.9), range(rng, 0, Math.PI), { step: f.step, flare: 0.08 }, { ...look, grain: Grain.Layered, roughness: r * 0.05 }),
      );
    }
  } else if (f.kind === "islands") {
    for (let i = 0; i < f.count; i++) {
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

