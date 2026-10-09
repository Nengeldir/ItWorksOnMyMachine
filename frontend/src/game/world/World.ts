import { Vector3 } from "three";
import { buildCourse, buildObstacles, type Course } from "./course";
import { type Obstacle, ObstacleGrid } from "./obstacles";
import { type Palette, paletteFor } from "./palette";
import { Terrain } from "./terrain";

// Distances beyond this don't matter for scoring, so obstacle lookups can stop there
export const PROXIMITY_RANGE = 12;

/** Everything a seed decides: terrain, course, obstacles, colors. No rendering. */
export class World {
  readonly seed: number;
  readonly terrain: Terrain;
  readonly course: Course;
  readonly obstacles: Obstacle[];
  readonly palette: Palette;
  private readonly grid: ObstacleGrid;

  constructor(seed: number) {
    this.seed = seed;
    this.terrain = new Terrain(seed);
    this.course = buildCourse(seed, this.terrain);
    this.obstacles = buildObstacles(seed, this.terrain, this.course);
    this.grid = new ObstacleGrid(this.obstacles, PROXIMITY_RANGE);
    this.palette = paletteFor(seed);
  }

  /** Distance from a point to the nearest surface (negative inside) */
  distance(x: number, y: number, z: number): number {
    return Math.min(this.terrain.distance(x, y, z), this.grid.distance(x, y, z));
  }

  /** Where to put a pilot who has passed `checkpoints` rings */
  spawnPoint(checkpoints: number): { position: Vector3; direction: Vector3 } {
    const { rings, start, startDirection } = this.course;
    if (checkpoints <= 0) {
      return { position: start.clone(), direction: startDirection.clone() };
    }
    const ring = rings[Math.min(checkpoints, rings.length) - 1];
    const next = rings[checkpoints];
    const direction = next ? next.position.clone().sub(ring.position).normalize() : ring.normal.clone();
    return { position: ring.position.clone().addScaledVector(ring.normal, 4), direction };
  }
}
