import { smoothstep } from "../../math";
import { hash3 } from "../../rng";
import type { FloraSpecies } from "../biomes/types";
import { TUBE_RADIUS } from "../course";
import { STRUCTURE_INFO, structuresOf } from "../structures/kinds";
import { fbm } from "../terrain/noise";
import type { World } from "../World";
import { PLANT_STRIDE, SPECIES, TUFT_STRIDE } from "./species";

// Where plants grow, worked out in the mesher workers straight from the land's
// distance field, not from the meshes: so a plant stands in the same spot
// whichever level of detail its node was meshed at. Candidates sit on a
// jittered grid aligned to the world, so a big node's plants are exactly its
// small nodes' plants put together.

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

const EMPTY = new Float32Array(0);
/** Structures are looked for this far around a node, so its plants keep clear of a neighbour's tower */
const SITE_MARGIN = 12;
/** Floats per structure site: x, y, z, the radius plants keep clear of */
const SITE_STRIDE = 4;

/** The topmost land surface in a column within [y0, y1), or NaN */
function surfaceIn(world: World, x: number, z: number, y0: number, y1: number, shapesNear: boolean): number {
  const field = world.land!;
  const ground = field.ground;
  if (ground && !shapesNear) {
    // Ground only: start from the heightfield and settle onto the real surface (overhang noise, tube)
    let y = ground.height(x, z);
    if (y < y0 - 12 || y >= y1 + 12) return NaN;
    for (let i = 0; i < 3; i++) {
      const d = field.distance(x, y, z);
      if (Math.abs(d) < 0.05) break;
      y -= d;
    }
    if (Math.abs(field.distance(x, y, z)) > 0.4) return NaN;
    return y >= y0 && y < y1 ? y : NaN;
  }
  // Rock shapes about: march down from the top of the range
  let y = y1;
  for (let i = 0; i < 80 && y >= y0; i++) {
    const d = field.distance(x, y, z);
    if (d < 0.08) return d > -1 && y < y1 - 0.01 ? y : NaN;
    y -= Math.max(d, 0.35);
  }
  return NaN;
}

/** The land's upward-ness at a surface point (normal.y of the field's gradient) */
function upness(world: World, x: number, y: number, z: number): number {
  const field = world.land!;
  const e = 0.7;
  const d0 = field.distance(x, y, z);
  const gx = field.distance(x + e, y, z) - d0;
  const gy = field.distance(x, y + e, z) - d0;
  const gz = field.distance(x, y, z + e) - d0;
  const length = Math.hypot(gx, gy, gz);
  return length > 1e-6 ? gy / length : 0;
}

/** 0..1: how much of a forest a spot is in (fireflies gather in its shade) */
export function forestAt(world: World, x: number, z: number): number {
  const veg = world.biome.vegetation;
  if (veg.kind !== "flora" || !world.land) return 0;
  const n = world.land.noise.n2;
  return smoothstep(1 - veg.forest.cover - 0.12, 1 - veg.forest.cover + 0.12, 0.5 + 0.5 * fbm(n, x / veg.forest.scale + 40.3, z / veg.forest.scale, 3));
}

/** Plants (and, for full-detail nodes, grass and flowers) in a node's box */
export function placeFlora(world: World, box: Box, withTufts: boolean): { plants: Float32Array; tufts: Float32Array } {
  const veg = world.biome.vegetation;
  const terrain = world.biome.terrain;
  if (veg.kind !== "flora" || terrain.kind !== "v2" || !world.land) return { plants: EMPTY, tufts: EMPTY };
  const field = world.land;
  const noise = field.noise.n2;
  const salt = world.seed % 100_003;
  const steps = world.steps;
  const surfaces = terrain.surfaces;
  const anyShapes = field.shapes.filter((s) => s.max.x >= box.x0 && s.min.x <= box.x1 && s.max.z >= box.z0 && s.min.z <= box.z1 && s.max.y >= box.y0 - 2 && s.min.y <= box.y1);
  const shapesAt = (x: number, z: number) => anyShapes.some((s) => x >= s.min.x - 2 && x <= s.max.x + 2 && z >= s.min.z - 2 && z <= s.max.z + 2);
  const surfaceOk = (x: number, y: number, z: number, near: boolean) => !near || !surfaces[field.surfaceAt(x, y, z)]?.bare;
  const sea = world.seaLevel;
  const inWater = (x: number, y: number, z: number) => {
    if (sea !== null && y < sea + 0.8) return true;
    if (!steps) return false;
    const lateral = Math.abs(x - steps.center(z)) - steps.width(z) / 2;
    return lateral < 1.5 && y < steps.level(z) + 1.5;
  };
  const nearWater = (x: number, y: number, z: number) => {
    if (sea !== null && y < sea + 4) return true;
    if (!steps) return false;
    const lateral = Math.abs(x - steps.center(z)) - steps.width(z) / 2;
    return lateral < 14 && y < steps.level(z) + 5;
  };

  // --- structures -----------------------------------------------------------------
  // A site depends only on where it is, never on the node's box: a tower stands
  // in the same spot at every level of detail. They come after the species in
  // the plant list (see structures/kinds.ts). Standing on the ground only, for now
  const plants: number[] = [];
  const sites: number[] = [];
  const ground = field.ground;
  const structures = ground ? structuresOf(world.biome) : [];
  const start = world.course.start;
  for (let index = 0; index < structures.length; index++) {
    const spec = structures[index];
    const info = STRUCTURE_INFO[spec.id];
    const step = spec.spacing;
    const s0 = salt + 101 + index * 37;
    const where = spec.where;
    const earlier = sites.length;
    for (let gi = Math.floor((box.x0 - SITE_MARGIN) / step) - 1; gi <= Math.floor((box.x1 + SITE_MARGIN) / step) + 1; gi++) {
      for (let gk = Math.floor((box.z0 - SITE_MARGIN) / step) - 1; gk <= Math.floor((box.z1 + SITE_MARGIN) / step) + 1; gk++) {
        if (hash3(gi, gk, s0) > spec.chance) continue;
        const x = (gi + 0.5 + (hash3(gi, gk, s0 + 1) - 0.5) * 0.6) * step;
        const z = (gk + 0.5 + (hash3(gi, gk, s0 + 2) - 0.5) * 0.6) * step;
        if (x < box.x0 - SITE_MARGIN || x >= box.x1 + SITE_MARGIN || z < box.z0 - SITE_MARGIN || z >= box.z1 + SITE_MARGIN) continue;
        const height = spec.height[0] + (spec.height[1] - spec.height[0]) * hash3(gi, gk, s0 + 3);
        const foot = info.foot * height;
        if (field.shapes.some((s) => x >= s.min.x - foot - 2 && x <= s.max.x + foot + 2 && z >= s.min.z - foot - 2 && z <= s.max.z + foot + 2)) continue;
        let y = ground!.height(x, z);
        for (let i = 0; i < 3; i++) y -= field.distance(x, y, z);
        if (Math.abs(field.distance(x, y, z)) > 0.4) continue;
        const above = y - world.course.y(z);
        if (where?.above && (above < where.above[0] || above > where.above[1])) continue;
        const lateral = Math.abs(x - world.course.x(z));
        if (where?.lateral && (lateral < where.lateral[0] || lateral > where.lateral[1])) continue;
        if (inWater(x, y, z)) continue;
        if (where?.wet !== undefined && where.wet !== nearWater(x, y, z)) continue;
        if (where?.forest !== undefined && where.forest !== forestAt(world, x, z) > 0.5) continue;
        if (upness(world, x, y, z) < 0.75) continue;
        // Level ground under the whole plinth
        const slack = info.sink * height;
        let level = true;
        for (let i = 0; i < 4 && level; i++) {
          const fx = x + (i % 2 ? foot : -foot);
          const fz = z + (i < 2 ? foot : -foot);
          level = Math.abs(field.distance(fx, y, fz)) < slack && !inWater(fx, y, fz);
        }
        if (!level) continue;
        if (where?.hilltop) {
          // The land falls away on at least half its sides
          let open = 0;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            if (field.distance(x + Math.cos(a) * height * 2.2, y - height * 0.2, z + Math.sin(a) * height * 2.2) > 0) open++;
          }
          if (open < 4) continue;
        }
        // Keep the racing line and the start clear
        if (world.course.distance(x, y + height / 2, z) < TUBE_RADIUS + height / 2 + 3) continue;
        if (Math.hypot(x - start.x, y - start.y, z - start.z) < 40 + height) continue;
        // Structures listed earlier come first where two would stand in each other's way
        const clear = foot + 1.5;
        let taken = false;
        for (let o = 0; o < earlier && !taken; o += SITE_STRIDE) taken = Math.hypot(x - sites[o], z - sites[o + 2]) < clear + sites[o + 3];
        // (a site that loses still counts for the kinds after it, so no node sees a different outcome)
        sites.push(x, y, z, clear);
        if (taken) continue;
        if (x < box.x0 || x >= box.x1 || z < box.z0 || z >= box.z1 || y < box.y0 || y >= box.y1) continue;
        plants.push(veg.species.length + index, x, y - 0.1, z, height, height, hash3(gi, gk, s0 + 4) * Math.PI * 2, hash3(gi, gk, s0 + 5));
      }
    }
  }
  const built = (x: number, z: number, reach: number) => {
    for (let o = 0; o < sites.length; o += SITE_STRIDE) if (Math.hypot(x - sites[o], z - sites[o + 2]) < sites[o + 3] + reach) return true;
    return false;
  };

  // --- plants ---------------------------------------------------------------------
  const spacing = veg.spacing;
  const gx0 = Math.ceil(box.x0 / spacing - 0.5);
  const gx1 = Math.floor(box.x1 / spacing - 0.5);
  const gz0 = Math.ceil(box.z0 / spacing - 0.5);
  const gz1 = Math.floor(box.z1 / spacing - 0.5);
  const totalWeight = veg.species.reduce((a, s) => a + s.weight, 0);
  for (let gi = gx0 - 1; gi <= gx1 + 1; gi++) {
    for (let gk = gz0 - 1; gk <= gz1 + 1; gk++) {
      const x = (gi + 0.5 + (hash3(gi, gk, salt) - 0.5) * 0.9) * spacing;
      const z = (gk + 0.5 + (hash3(gi, gk, salt + 1) - 0.5) * 0.9) * spacing;
      if (x < box.x0 || x >= box.x1 || z < box.z0 || z >= box.z1) continue;
      if (built(x, z, 3)) continue;
      const forest = forestAt(world, x, z);
      const keep = veg.openDensity + (veg.density - veg.openDensity) * forest;
      if (hash3(gi, gk, salt + 2) > keep) continue;
      const near = shapesAt(x, z);
      const y = surfaceIn(world, x, z, box.y0, box.y1, near);
      if (Number.isNaN(y)) continue;
      const above = y - world.course.y(z);
      if (above > veg.treeline + 30 * noise(x / 90, z / 90)) continue;
      if (inWater(x, y, z)) continue;
      if (!surfaceOk(x, y, z, near)) continue;
      if (upness(world, x, y, z) < veg.minUp) continue;
      // Which species: weighted, among those that like this spot
      const wet = nearWater(x, y, z);
      const inForest = forest > 0.5;
      const fits = (s: FloraSpecies) =>
        (!s.where?.above || (above >= s.where.above[0] && above <= s.where.above[1])) &&
        (s.where?.wet === undefined || s.where.wet === wet) &&
        (s.where?.forest === undefined || s.where.forest === inForest);
      let r = hash3(gi, gk, salt + 3) * totalWeight;
      let pick = -1;
      for (let i = 0; i < veg.species.length; i++) {
        const s = veg.species[i];
        r -= s.weight;
        if (r <= 0) {
          pick = i;
          break;
        }
      }
      if (pick < 0 || !fits(veg.species[pick])) {
        // The first choice doesn't grow here: try the others in order
        pick = veg.species.findIndex(fits);
        if (pick < 0 || hash3(gi, gk, salt + 4) < 0.35) continue;
      }
      const s = veg.species[pick];
      const info = SPECIES[s.id];
      const t = hash3(gi, gk, salt + 5);
      const height = s.height[0] + (s.height[1] - s.height[0]) * t * t;
      const radius = height * (info.aspect[0] + (info.aspect[1] - info.aspect[0]) * hash3(gi, gk, salt + 6));
      // Keep the racing line clear
      if (world.course.distance(x, y + height / 2, z) < TUBE_RADIUS + height / 2 + 3) continue;
      plants.push(pick, x, y - 0.25, z, height, radius, hash3(gi, gk, salt + 7) * Math.PI * 2, hash3(gi, gk, salt + 8));
    }
  }

  // --- grass and flowers, near the camera only -------------------------------------
  const tufts: number[] = [];
  const grass = veg.grass;
  if (withTufts && grass) {
    const step = grass.spacing;
    const tx0 = Math.ceil(box.x0 / step - 0.5);
    const tx1 = Math.floor(box.x1 / step - 0.5);
    const tz0 = Math.ceil(box.z0 / step - 0.5);
    const tz1 = Math.floor(box.z1 / step - 0.5);
    const coverSlope = terrain.layers.topSlope + 0.04;
    for (let gi = tx0 - 1; gi <= tx1 + 1; gi++) {
      for (let gk = tz0 - 1; gk <= tz1 + 1; gk++) {
        const x = (gi + 0.5 + (hash3(gi, gk, salt + 11) - 0.5) * 0.95) * step;
        const z = (gk + 0.5 + (hash3(gi, gk, salt + 12) - 0.5) * 0.95) * step;
        if (x < box.x0 || x >= box.x1 || z < box.z0 || z >= box.z1) continue;
        if (built(x, z, -1.5)) continue;
        // Meadows come and go
        const meadow = 0.5 + 0.5 * fbm(noise, x / 70 - 13.7, z / 70, 2);
        if (hash3(gi, gk, salt + 13) > 0.35 + meadow * 0.75) continue;
        const near = shapesAt(x, z);
        const y = surfaceIn(world, x, z, box.y0, box.y1, near);
        if (Number.isNaN(y)) continue;
        if (y - world.course.y(z) > veg.treeline + 60) continue;
        if (nearWater(x, y, z) && hash3(gi, gk, salt + 14) < 0.7) continue;
        if (inWater(x, y, z) || !surfaceOk(x, y, z, near)) continue;
        if (upness(world, x, y, z) < coverSlope) continue;
        let kind = 0;
        if (grass.flowers.length) {
          const patch = 0.5 + 0.5 * noise(x / 26 + 7.7, z / 26);
          if (patch > 1 - grass.flowerShare * 1.6 && hash3(gi, gk, salt + 15) < 0.55) {
            kind = 1 + Math.floor(hash3(Math.floor(x / 9), Math.floor(z / 9), salt + 16) * grass.flowers.length);
          }
        }
        const scale = grass.height[0] + (grass.height[1] - grass.height[0]) * hash3(gi, gk, salt + 17);
        tufts.push(x, y - 0.1, z, scale, hash3(gi, gk, salt + 18), kind);
      }
    }
  }

  return { plants: new Float32Array(plants), tufts: new Float32Array(tufts) };
}

export { PLANT_STRIDE, TUFT_STRIDE };
