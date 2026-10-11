import { Vector3 } from "three";
import { type Rng, makeRng, range } from "../rng";
import type { Biome, Level } from "./biomes";
import { Course } from "./course";
import { RockField } from "./islands";
import { type Area, CELL, cellIndex, cellsIn } from "./open";
import type { Palette } from "./palette";
import { GROW_MARGIN, TerrainField } from "./terrain/field";
import { Ground } from "./terrain/ground";
import { makeNoise } from "./terrain/noise";
import { type LandContext, buildLand, buildLandCell } from "./terrain/recipes";
import { NoiseIsland, type Shape } from "./terrain/shapes";
import type { Steps, WaterKind } from "./terrain/river";
import { TreeIndex } from "./trees";

// Distances beyond this don't matter for scoring, so lookups can stop there
export const PROXIMITY_RANGE = 12;
/** Fall this far below the racing line and you're lost in the clouds */
const ABYSS = 240;
const SEA_STEP = 8;
const SEA_PAD = 1700;
const START_AIM_LIFT = 4; // metres above the first ring's centre the start aims at, for the sink on the way
const START_CLEARANCE = 3; // metres of air the aimed start needs all the way to the first ring
/** An open world's cell's shapes are ordered from its `cellIndex` · ORDER_SPAN, so cells made in any order blend alike */
const ORDER_SPAN = 100_000;
/** An open world keeps at most this many cells of land made; past it, the furthest go (back the same if asked for again) */
const KEEP_CELLS = 120;
/** …down to this many */
const TRIM_CELLS = 90;

export interface WaterHit {
  distance: number;
  level: number;
  kind: WaterKind;
}

/** A waterfall pouring off a floating island's rim into the void */
export interface IslandFall {
  x: number; // the lip
  y: number;
  z: number;
  dx: number; // outward, horizontal
  dz: number;
  width: number;
  drop: number; // metres down to where it fades into the clouds
  island: Shape; // the island it pours off
}

/** Anything with a signed distance: the legacy islands or a generator-v2 field */
export interface Rock {
  distance(x: number, y: number, z: number): number;
}

/** Everything a level decides: the line, the land, the water, the colors. No rendering. */
export class World {
  readonly level: Level;
  readonly biome: Biome;
  readonly seed: number;
  readonly course: Course;
  readonly palette: Palette;
  /** All the land, for collisions */
  readonly rock: Rock;
  /** The race map's islands (Sky Isles only) */
  readonly legacy: RockField | null = null;
  /** Generator-v2 land (every other biome) */
  readonly land: TerrainField | null = null;
  /** The stepped valley floor and its river, if the biome has one */
  readonly steps: Steps | null = null;
  /** Whether the biome has a sea. Its surface follows the racing line down (`seaAt`) */
  readonly hasSea: boolean = false;
  private seaTable: Float32Array | null = null;
  /** Waterfalls off floating islands */
  readonly islandFalls: IslandFall[] = [];
  /** Trees grow on the land; chunks add them as they are meshed */
  readonly trees = new TreeIndex(PROXIMITY_RANGE);
  /** Which way pilots face on the start line */
  readonly startDirection: Vector3;
  /**
   * An open world (Zen; generator-v2 land only): no line, land every way, made a cell at a time
   * around whatever is asked for (`ensure`), each cell from its own seeded streams (see `open.ts`)
   */
  readonly open: boolean;
  /** An open world's rivers and lakes: one level, where the ground is below it */
  readonly openWater: { level: number; kind: WaterKind } | null = null;
  private landContext: LandContext | null = null;
  private seaLevel = 0;
  /** An open world's cells of land made so far, and their shapes */
  private readonly made = new Map<string, { area: Area; shapes: Shape[] }>();
  private making = false;

  constructor(level: Level) {
    this.level = level;
    this.biome = level.biome;
    this.seed = level.seed;
    this.palette = level.palette;
    const terrain = this.biome.terrain;
    this.open = !!level.key.open && terrain.kind !== "legacyIslands";
    this.course = new Course(this.seed, this.open);
    if (terrain.kind === "legacyIslands") {
      this.legacy = new RockField(this.seed, this.course);
      this.rock = this.legacy;
    } else {
      const noise = makeNoise(this.seed, "land");
      const ground = terrain.ground ? new Ground(this.course, terrain.ground, makeRng(this.seed, "ground"), noise) : null;
      const field = new TerrainField(this.course, ground, terrain.groundSurface, noise);
      if (terrain.sea) {
        this.hasSea = true;
        this.seaLevel = terrain.sea.level;
        if (!this.open) this.seaTable = this.buildSeaTable(terrain.sea.level);
      }
      this.land = field;
      this.rock = field;
      this.steps = ground?.steps?.river ? ground.steps : null;
      if (ground?.waterLevel != null && terrain.ground?.river) this.openWater = { level: ground.waterLevel, kind: terrain.ground.river.kind };
      const context: LandContext = { course: this.course, field, ground, rng: makeRng(this.seed, "land"), noise, seaAt: this.hasSea ? (z) => this.seaAt(z) : null };
      if (this.open) {
        this.landContext = context;
        field.grow = (x0, z0, x1, z1) => this.ensure(x0, z0, x1, z1);
        const { start } = this.course;
        this.ensure(start.x, start.z, start.x, start.z);
      } else {
        buildLand(context, terrain.land);
        if (terrain.islandFalls) this.findIslandFalls(terrain.islandFalls.chance, field.shapes, makeRng(this.seed, "island falls"));
      }
    }
    this.startDirection = this.startHeading();
  }

  /**
   * An open world: makes every cell within `GROW_MARGIN` of the rectangle, and lets the furthest
   * cells go once there are too many. Every thread makes the same cells, whichever it asks for first.
   */
  ensure(x0: number, z0: number, x1: number, z1: number) {
    const context = this.landContext;
    if (!context || this.making) return;
    const wanted = cellsIn(x0 - GROW_MARGIN, z0 - GROW_MARGIN, x1 + GROW_MARGIN, z1 + GROW_MARGIN);
    this.making = true;
    try {
      for (const area of wanted) if (!this.made.has(area.key)) this.makeCell(area);
      if (this.made.size > KEEP_CELLS) this.trim((x0 + x1) / 2, (z0 + z1) / 2, wanted);
      // Queries inside this need nothing new: everything within the margin of them is made
      const ready = context.field.ready;
      ready[0] = Math.floor((x0 - GROW_MARGIN) / CELL) * CELL + GROW_MARGIN;
      ready[1] = Math.floor((z0 - GROW_MARGIN) / CELL) * CELL + GROW_MARGIN;
      ready[2] = (Math.floor((x1 + GROW_MARGIN) / CELL) + 1) * CELL - GROW_MARGIN;
      ready[3] = (Math.floor((z1 + GROW_MARGIN) / CELL) + 1) * CELL - GROW_MARGIN;
    } finally {
      this.making = false;
    }
  }

  /** An open world: the cells of land made now */
  get cells(): Area[] {
    return [...this.made.values()].map((m) => m.area);
  }

  /** An open world: a cell's land, from the cell's own streams */
  private makeCell(area: Area) {
    const context = this.landContext!;
    const terrain = this.biome.terrain;
    if (terrain.kind === "legacyIslands") return;
    const { field } = context;
    const first = field.shapes.length;
    field.nextOrder = cellIndex(area.cx, area.cz) * ORDER_SPAN;
    buildLandCell({ ...context, rng: makeRng(this.seed, `land/${area.key}`) }, terrain.land, area);
    const shapes = field.shapes.slice(first);
    this.made.set(area.key, { area, shapes });
    const falls = terrain.islandFalls;
    if (falls) this.findIslandFalls(falls.chance, shapes, makeRng(this.seed, `island falls/${area.key}`));
  }

  /** An open world: lets the cells furthest from (x, z) go, but none of `keep` */
  private trim(x: number, z: number, keep: Area[]) {
    const kept = new Set(keep.map((a) => a.key));
    const far = [...this.made.values()]
      .filter((m) => !kept.has(m.area.key))
      .sort((a, b) => cellDistance(b.area, x, z) - cellDistance(a.area, x, z));
    const gone = new Set<Shape>();
    for (const m of far.slice(0, this.made.size - TRIM_CELLS)) {
      for (const shape of m.shapes) gone.add(shape);
      this.made.delete(m.area.key);
    }
    this.landContext!.field.remove(gone);
    for (let i = this.islandFalls.length - 1; i >= 0; i--) if (gone.has(this.islandFalls[i].island)) this.islandFalls.splice(i, 1);
  }

  /**
   * The sea keeps its depth under the line (a flat sea at the last gate's height
   * lay hundreds of metres below the start, out of sight and past the world's
   * edge). The line's slope is smoothed so the surface doesn't undulate with it.
   */
  private buildSeaTable(level: number): Float32Array {
    const { course } = this;
    const table = new Float32Array(Math.ceil((course.endZ + SEA_PAD * 2 - course.start.z) / SEA_STEP) + 2);
    for (let i = 0; i < table.length; i++) {
      const z = course.start.z - SEA_PAD + i * SEA_STEP;
      let sum = 0;
      for (let k = -5; k <= 5; k++) sum += course.y(z + k * 40);
      table[i] = sum / 11 + level;
    }
    return table;
  }

  /** The sea's surface height at z, or null if there is no sea */
  seaAt(z: number): number | null {
    if (!this.hasSea) return null;
    const table = this.seaTable;
    // An open world's sea is level, at its depth under y = 0
    if (!table) return this.seaLevel;
    const f = Math.min(Math.max((z - this.course.start.z + SEA_PAD) / SEA_STEP, 0), table.length - 1.001);
    const i = Math.floor(f);
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  }

  /** Flying straight off the start goes through the first ring, unless rock is in the way: then follow the line */
  private startHeading(): Vector3 {
    const { start, rings, startDirection } = this.course;
    if (!rings.length) return startDirection.clone();
    const aim = rings[0].position.clone().add(new Vector3(0, START_AIM_LIFT, 0)).sub(start);
    const point = new Vector3();
    for (let t = 0; t <= 1; t += 0.02) {
      point.copy(start).addScaledVector(aim, t);
      if (this.rock.distance(point.x, point.y, point.z) < START_CLEARANCE) return startDirection.clone();
    }
    return aim.normalize();
  }

  /** Finds a rim to pour from on some of the big floating islands among `shapes` */
  private findIslandFalls(chance: number, shapes: Shape[], rng: Rng) {
    const field = this.land!;
    for (const shape of shapes) {
      if (!(shape instanceof NoiseIsland) || shape.anchor.size < 24) continue;
      const roll = rng();
      const angle = range(rng, 0, Math.PI * 2);
      if (roll > chance) continue;
      const { x, y, z, size } = shape.anchor;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      // Walk out from the middle, a little below the top, until we leave the rock
      const level = y + size * 0.12;
      let r = 0;
      while (r < size * 1.6 && field.distance(x + dx * r, level, z + dz * r) < 0) r += 2;
      if (r >= size * 1.6 || r < size * 0.3) continue;
      // Keep the racing line clear of the curtain
      if (this.course.distance(x + dx * r, level - 20, z + dz * r) < 30) continue;
      this.islandFalls.push({
        x: x + dx * (r - 2.5),
        y: level,
        z: z + dz * (r - 2.5),
        dx,
        dz,
        width: size * range(rng, 0.12, 0.2),
        drop: level - (this.course.y(z) - 230),
        island: shape,
      });
    }
  }

  /** Distance from a point to the nearest rock, tree or water surface (negative inside) */
  distance(x: number, y: number, z: number): number {
    return Math.min(this.rock.distance(x, y, z), this.otherDistance(x, y, z));
  }

  /** Distance to everything solid but the rock: trees, river pools, the sea */
  otherDistance(x: number, y: number, z: number): number {
    let d = this.trees.distance(x, y, z);
    if (this.steps) d = Math.min(d, this.steps.waterDistance(x, y, z));
    const sea = this.seaAt(z);
    if (sea !== null) d = Math.min(d, y - sea);
    // Below an open world's water level is either water or ground
    if (this.openWater) d = Math.min(d, y - this.openWater.level);
    return d;
  }

  /**
   * The water surface nearest a point (river pools or the sea): its distance,
   * height and kind, or null if there is no water near. Fills and returns `out`.
   */
  waterNear(x: number, y: number, z: number, out: WaterHit): WaterHit | null {
    let found = false;
    out.distance = Infinity;
    if (this.steps) {
      const d = this.steps.waterDistance(x, y, z);
      if (d < out.distance) {
        out.distance = d;
        out.level = this.steps.pool(z).level;
        out.kind = this.steps.river!.kind;
        found = true;
      }
    }
    const sea = this.seaAt(z);
    if (sea !== null && y - sea < out.distance && this.wetAt(x, z, sea)) {
      out.distance = y - sea;
      out.level = sea;
      out.kind = "water";
      found = true;
    }
    const water = this.openWater;
    if (water && y - water.level < out.distance && this.wetAt(x, z, water.level)) {
      out.distance = y - water.level;
      out.level = water.level;
      out.kind = water.kind;
      found = true;
    }
    return found ? out : null;
  }

  /** Is there water at this level here? An open world's ground can stand above it; a level's sea has none there */
  private wetAt(x: number, z: number, level: number): boolean {
    const ground = this.open ? this.land?.ground : null;
    return !ground || ground.height(x, z) < level;
  }

  /** Height of the valley floor under the racing line at z (where valley mist pools) */
  valleyFloor(z: number): number {
    const sea = this.seaAt(z);
    if (sea !== null) return sea;
    if (this.openWater) return this.openWater.level;
    const ground = this.land?.ground;
    if (this.open) return ground ? (ground.spec.level ?? -ground.spec.depth) : -40;
    if (!ground) return this.course.y(z) - 40;
    if (ground.steps) return ground.steps.level(z);
    return ground.spec.level !== null ? ground.height(this.course.x(z), z) : this.course.y(z) - ground.spec.depth;
  }

  /** Below the islands, there is only the sea of clouds */
  lost(y: number, z: number): boolean {
    return y < this.course.y(z) - ABYSS;
  }

  /** Where to put a pilot who has passed `checkpoints` rings */
  spawnPoint(checkpoints: number): { position: Vector3; direction: Vector3 } {
    const { rings, start } = this.course;
    if (checkpoints <= 0 || !rings.length) {
      return { position: start.clone(), direction: this.startDirection.clone() };
    }
    const ring = rings[Math.min(checkpoints, rings.length) - 1];
    return { position: ring.position.clone().addScaledVector(ring.normal, 4), direction: ring.normal.clone() };
  }
}

/** Metres from (x, z) to a cell's middle */
function cellDistance(area: Area, x: number, z: number): number {
  return Math.hypot((area.x0 + area.x1) / 2 - x, (area.z0 + area.z1) / 2 - z);
}
