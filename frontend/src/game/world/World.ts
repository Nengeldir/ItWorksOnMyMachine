import { Vector3 } from "three";
import { type Rng, makeRng, range } from "../rng";
import type { Biome, Level } from "./biomes";
import { BLOCK, Course } from "./course";
import { RockField } from "./islands";
import type { Palette } from "./palette";
import { GROW_MARGIN, TerrainField } from "./terrain/field";
import { Ground } from "./terrain/ground";
import { makeNoise } from "./terrain/noise";
import { type LandContext, buildLand, buildLandBlock } from "./terrain/recipes";
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
/** Shapes of block b are ordered from (b + ORDER_OFFSET) · ORDER_SPAN, so blocks made in any order blend alike */
const ORDER_OFFSET = 100_000;
const ORDER_SPAN = 100_000;

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
   * Endless (Zen; generator-v2 land only): the line, its land and its water go on for ever, made a
   * block at a time around whatever is asked for (`ensure`), each block from its own seeded streams
   */
  readonly endless: boolean;
  private landContext: LandContext | null = null;
  private seaLevel = 0;
  private madeFrom = 0; // blocks made, madeFrom..madeTo (none while madeTo < madeFrom)
  private madeTo = -1;
  private making = false;

  constructor(level: Level) {
    this.level = level;
    this.biome = level.biome;
    this.seed = level.seed;
    this.palette = level.palette;
    const terrain = this.biome.terrain;
    this.endless = !!level.key.endless && terrain.kind !== "legacyIslands";
    this.course = new Course(this.seed, this.endless);
    if (terrain.kind === "legacyIslands") {
      this.legacy = new RockField(this.seed, this.course);
      this.rock = this.legacy;
    } else {
      const noise = makeNoise(this.seed, "land");
      const steps = this.endless ? (b: number) => makeRng(this.seed, `steps/${b}`) : null;
      const ground = terrain.ground ? new Ground(this.course, terrain.ground, makeRng(this.seed, "ground"), noise, steps) : null;
      const field = new TerrainField(this.course, ground, terrain.groundSurface, noise);
      if (terrain.sea) {
        this.hasSea = true;
        this.seaLevel = terrain.sea.level;
        if (!this.endless) this.seaTable = this.buildSeaTable(terrain.sea.level);
      }
      this.land = field;
      this.rock = field;
      this.steps = ground?.steps?.river ? ground.steps : null;
      const context: LandContext = { course: this.course, field, ground, rng: makeRng(this.seed, "land"), noise, seaAt: this.hasSea ? (z) => this.seaAt(z) : null };
      if (this.endless) {
        this.landContext = context;
        field.grow = (z0, z1) => this.ensure(z0, z1);
        this.ensure(this.course.start.z, this.course.start.z);
      } else {
        buildLand(context, terrain.land);
        if (terrain.islandFalls) this.findIslandFalls(terrain.islandFalls.chance, field.shapes, makeRng(this.seed, "island falls"));
      }
    }
    this.startDirection = this.startHeading();
  }

  /**
   * Endless: makes the land around z0..z1 (GROW_MARGIN either side), and every block between it and
   * what is already made. Every thread makes the same blocks, whichever it asks for first.
   */
  ensure(z0: number, z1: number) {
    const context = this.landContext;
    if (!context || this.making) return;
    const from = Math.floor((z0 - GROW_MARGIN) / BLOCK);
    const to = Math.floor((z1 + GROW_MARGIN) / BLOCK);
    if (from >= this.madeFrom && to <= this.madeTo) return;
    this.making = true;
    try {
      if (this.madeTo < this.madeFrom) {
        this.madeFrom = from;
        this.madeTo = from - 1;
      }
      while (this.madeTo < to) this.makeBlock(++this.madeTo);
      while (this.madeFrom > from) this.makeBlock(--this.madeFrom);
      context.field.madeFrom = this.madeFrom * BLOCK;
      context.field.madeTo = (this.madeTo + 1) * BLOCK;
    } finally {
      this.making = false;
    }
  }

  /** Endless: z of the land made so far, [from, to) */
  get made(): [number, number] {
    return [this.madeFrom * BLOCK, (this.madeTo + 1) * BLOCK];
  }

  /** Endless: block b's land, from the block's own streams */
  private makeBlock(b: number) {
    const context = this.landContext!;
    const terrain = this.biome.terrain;
    if (terrain.kind === "legacyIslands") return;
    const { field } = context;
    const first = field.shapes.length;
    field.nextOrder = (b + ORDER_OFFSET) * ORDER_SPAN;
    buildLandBlock({ ...context, rng: makeRng(this.seed, `land/${b}`) }, terrain.land, b);
    const falls = terrain.islandFalls;
    if (falls) this.findIslandFalls(falls.chance, field.shapes.slice(first), makeRng(this.seed, `island falls/${b}`));
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
    if (!table) {
      // Endless: no table, the same average worked out where it's asked for
      let sum = 0;
      for (let k = -5; k <= 5; k++) sum += this.course.y(z + k * 40);
      return sum / 11 + this.seaLevel;
    }
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
    if (sea !== null && y - sea < out.distance) {
      out.distance = y - sea;
      out.level = sea;
      out.kind = "water";
      found = true;
    }
    return found ? out : null;
  }

  /** Height of the valley floor under the racing line at z (where valley mist pools) */
  valleyFloor(z: number): number {
    const sea = this.seaAt(z);
    if (sea !== null) return sea;
    const ground = this.land?.ground;
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
