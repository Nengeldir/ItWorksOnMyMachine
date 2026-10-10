import { Vector3 } from "three";
import { makeRng, range } from "../rng";
import type { Biome, Level } from "./biomes";
import { Course } from "./course";
import { RockField } from "./islands";
import type { Palette } from "./palette";
import { TerrainField } from "./terrain/field";
import { Ground } from "./terrain/ground";
import { makeNoise } from "./terrain/noise";
import { buildLand } from "./terrain/recipes";
import { NoiseIsland } from "./terrain/shapes";
import type { Steps, WaterKind } from "./terrain/river";
import { TreeIndex } from "./trees";

// Distances beyond this don't matter for scoring, so lookups can stop there
export const PROXIMITY_RANGE = 12;
/** Fall this far below the racing line and you're lost in the clouds */
const ABYSS = 240;
const START_AIM_LIFT = 4; // metres above the first ring's centre the start aims at, for the sink on the way
const START_CLEARANCE = 3; // metres of air the aimed start needs all the way to the first ring

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
  /** The sea's height, if the biome has a sea */
  readonly seaLevel: number | null = null;
  /** Waterfalls off floating islands */
  readonly islandFalls: IslandFall[] = [];
  /** Trees grow on the land; chunks add them as they are meshed */
  readonly trees = new TreeIndex(PROXIMITY_RANGE);
  /** Which way pilots face on the start line */
  readonly startDirection: Vector3;

  constructor(level: Level) {
    this.level = level;
    this.biome = level.biome;
    this.seed = level.seed;
    this.palette = level.palette;
    this.course = new Course(this.seed);
    const terrain = this.biome.terrain;
    if (terrain.kind === "legacyIslands") {
      this.legacy = new RockField(this.seed, this.course);
      this.rock = this.legacy;
    } else {
      const noise = makeNoise(this.seed, "land");
      const ground = terrain.ground ? new Ground(this.course, terrain.ground, makeRng(this.seed, "ground"), noise) : null;
      const field = new TerrainField(this.course, ground, terrain.groundSurface, noise);
      this.seaLevel = terrain.sea ? this.course.y(this.course.endZ) + terrain.sea.level : null;
      buildLand({ course: this.course, field, ground, rng: makeRng(this.seed, "land"), noise, seaLevel: this.seaLevel }, terrain.land);
      this.land = field;
      this.rock = field;
      this.steps = ground?.steps?.river ? ground.steps : null;
      if (terrain.islandFalls) this.findIslandFalls(terrain.islandFalls.chance);
    }
    this.startDirection = this.startHeading();
  }

  /** Flying straight off the start goes through the first ring, unless rock is in the way: then follow the line */
  private startHeading(): Vector3 {
    const { start, rings, startDirection } = this.course;
    const aim = rings[0].position.clone().add(new Vector3(0, START_AIM_LIFT, 0)).sub(start);
    const point = new Vector3();
    for (let t = 0; t <= 1; t += 0.02) {
      point.copy(start).addScaledVector(aim, t);
      if (this.rock.distance(point.x, point.y, point.z) < START_CLEARANCE) return startDirection.clone();
    }
    return aim.normalize();
  }

  /** Finds a rim to pour from on some of the big floating islands */
  private findIslandFalls(chance: number) {
    const rng = makeRng(this.seed, "island falls");
    const field = this.land!;
    for (const shape of field.shapes) {
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
    let d = Math.min(this.rock.distance(x, y, z), this.trees.distance(x, y, z));
    if (this.steps) d = Math.min(d, this.steps.waterDistance(x, y, z));
    if (this.seaLevel !== null) d = Math.min(d, y - this.seaLevel);
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
    if (this.seaLevel !== null && y - this.seaLevel < out.distance) {
      out.distance = y - this.seaLevel;
      out.level = this.seaLevel;
      out.kind = "water";
      found = true;
    }
    return found ? out : null;
  }

  /** Height of the valley floor under the racing line at z (where valley mist pools) */
  valleyFloor(z: number): number {
    if (this.seaLevel !== null) return this.seaLevel;
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
    if (checkpoints <= 0) {
      return { position: start.clone(), direction: this.startDirection.clone() };
    }
    const ring = rings[Math.min(checkpoints, rings.length) - 1];
    return { position: ring.position.clone().addScaledVector(ring.normal, 4), direction: ring.normal.clone() };
  }
}
