import { Vector3 } from "three";
import { Course } from "./course";
import type { Biome, Level } from "./biomes";
import { RockField } from "./islands";
import type { Palette } from "./palette";
import { TreeIndex } from "./trees";

// Distances beyond this don't matter for scoring, so lookups can stop there
export const PROXIMITY_RANGE = 12;
/** Fall this far below the racing line and you're lost in the clouds */
const ABYSS = 240;

/** Everything a level decides: the line, the islands, the colors. No rendering. */
export class World {
  readonly level: Level;
  readonly biome: Biome;
  readonly seed: number;
  readonly course: Course;
  readonly rock: RockField;
  readonly palette: Palette;
  /** Trees grow on the island tops; chunks add them as they are meshed */
  readonly trees = new TreeIndex(PROXIMITY_RANGE);

  constructor(level: Level) {
    this.level = level;
    this.biome = level.biome;
    this.seed = level.seed;
    this.palette = level.palette;
    this.course = new Course(this.seed);
    this.rock = new RockField(this.seed, this.course);
  }

  /** Distance from a point to the nearest rock or tree (negative inside) */
  distance(x: number, y: number, z: number): number {
    return Math.min(this.rock.distance(x, y, z), this.trees.distance(x, y, z));
  }

  /** Below the islands, there is only the sea of clouds */
  lost(y: number, z: number): boolean {
    return y < this.course.y(z) - ABYSS;
  }

  /** Where to put a pilot who has passed `checkpoints` rings */
  spawnPoint(checkpoints: number): { position: Vector3; direction: Vector3 } {
    const { rings, start, startDirection } = this.course;
    if (checkpoints <= 0) {
      return { position: start.clone(), direction: startDirection.clone() };
    }
    const ring = rings[Math.min(checkpoints, rings.length) - 1];
    return { position: ring.position.clone().addScaledVector(ring.normal, 4), direction: ring.normal.clone() };
  }
}
