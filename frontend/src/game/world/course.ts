import { Vector3 } from "three";
import { makeRng, range } from "../rng";
import { Arch, type Obstacle, Pillar, Rock } from "./obstacles";
import { type Terrain, smoothstep } from "./terrain";

export const RING_COUNT = 14;
export const RING_RADIUS = 13;
export const FINISH_RADIUS = 18;
// Obstacles keep at least this far from the racing line
const LINE_CLEARANCE = 16;
// The racing line stays at least this far above the ground
const GROUND_CLEARANCE = 20;

export interface Ring {
  index: number;
  position: Vector3;
  normal: Vector3; // the direction you fly through it
  radius: number;
  finish: boolean;
}

export interface Course {
  start: Vector3;
  startDirection: Vector3;
  rings: Ring[];
  /** Points along a smooth line through every ring, ~8 m apart */
  line: Vector3[];
}

interface Key {
  z: number;
  side: number; // -1..1 across the valley floor
  above: number; // metres above the valley floor
}

const SAMPLE_STEP = 2; // metres of z between racing line samples

/** Rings down the valley, from the seed. Same seed, same course. */
export function buildCourse(seed: number, terrain: Terrain): Course {
  const rng = makeRng(seed, "course");

  // The start, then every ring: where across the valley and how high
  const keys: Key[] = [{ z: -60, side: 0, above: 120 }];
  let z = 230;
  for (let i = 0; i < RING_COUNT; i++) {
    keys.push({ z, side: range(rng, -0.45, 0.45), above: range(rng, 26, 70) });
    z += range(rng, 230, 300);
  }
  const radii = keys.slice(1).map((_, i) => (i === RING_COUNT - 1 ? FINISH_RADIUS : RING_RADIUS));

  // The racing line follows the valley's bends between the keys, so it never cuts through a slope
  const firstZ = keys[0].z;
  const lastZ = keys[keys.length - 1].z + 150;
  const dense: Vector3[] = [];
  let k = 0;
  for (let z = firstZ; z <= lastZ; z += SAMPLE_STEP) {
    while (k < keys.length - 2 && z > keys[k + 1].z) k++;
    const a = keys[k];
    const b = keys[Math.min(k + 1, keys.length - 1)];
    const f = b.z > a.z ? smoothstep(0, 1, (z - a.z) / (b.z - a.z)) : 0;
    const side = a.side + (b.side - a.side) * f;
    const above = a.above + (b.above - a.above) * f;
    dense.push(new Vector3(terrain.centerX(z) + side * terrain.halfWidth(z), terrain.floorY(z) + above, z));
  }
  const indexAt = (z: number) => Math.round((z - firstZ) / SAMPLE_STEP);

  // Where the ground comes too close, lift the line with a smooth bump
  const need = dense.map((p) => {
    const ring = keys.findIndex((key, i) => i > 0 && Math.abs(key.z - p.z) < SAMPLE_STEP / 2);
    const clearance = ring > 0 ? Math.max(GROUND_CLEARANCE, radii[ring - 1] + 8) : GROUND_CLEARANCE;
    return Math.max(0, terrain.height(p.x, p.z) + clearance - p.y);
  });
  const reach = Math.round(60 / SAMPLE_STEP);
  dense.forEach((p, i) => {
    let lift = 0;
    for (let j = Math.max(0, i - reach); j <= Math.min(dense.length - 1, i + reach); j++) {
      if (need[j] > 0) lift = Math.max(lift, need[j] * Math.cos(((i - j) / reach) * (Math.PI / 2)));
    }
    p.y += lift;
  });

  const tangent = (i: number) =>
    dense[Math.min(i + 2, dense.length - 1)].clone().sub(dense[Math.max(i - 2, 0)]).normalize();

  const rings: Ring[] = keys.slice(1).map((key, index) => {
    const i = indexAt(key.z);
    const position = dense[i].clone();
    const radius = radii[index];
    const low = ringGroundClearance(terrain, position, radius);
    if (low < 4) position.y += 4 - low;
    return { index, position, normal: tangent(i), radius, finish: index === RING_COUNT - 1 };
  });

  // Resample evenly along the line, for obstacle placement
  const line: Vector3[] = [dense[0]];
  let travelled = 0;
  for (let i = 1; i < dense.length; i++) {
    travelled += dense[i].distanceTo(dense[i - 1]);
    if (travelled >= 8) {
      line.push(dense[i]);
      travelled = 0;
    }
  }

  // Face a point a little way down the line, so the run starts with a view down the valley
  const lookAt = dense[Math.min(dense.length - 1, indexAt(firstZ + 160))];
  return {
    start: dense[0].clone(),
    startDirection: lookAt.clone().sub(dense[0]).normalize(),
    rings,
    line,
  };
}

/** How far the lowest point of a ring is above the ground under it */
function ringGroundClearance(terrain: Terrain, center: Vector3, radius: number): number {
  let lowest = Infinity;
  for (let a = 0; a < 8; a++) {
    // The ring stands upright, so its rim spans the vertical plane
    const angle = (a / 8) * Math.PI * 2;
    const px = center.x + Math.cos(angle) * radius;
    const py = center.y + Math.sin(angle) * radius;
    lowest = Math.min(lowest, py - terrain.height(px, center.z));
  }
  return lowest;
}

/** Rock spires, boulders and arches near the course, never on the racing line */
export function buildObstacles(seed: number, terrain: Terrain, course: Course): Obstacle[] {
  const rng = makeRng(seed, "obstacles");
  const obstacles: Obstacle[] = [];
  const endZ = course.rings[course.rings.length - 1].position.z + 250;

  const clearOfLine = (o: Obstacle, margin: number) => {
    for (const p of course.line) {
      if (Math.abs(p.z - o.z) > o.bound + margin + 10) continue;
      if (o.distance(p.x, p.y, p.z) < margin) return false;
    }
    return true;
  };

  // Rock spires standing in the meadows, here and there
  for (let z = 150; z < endZ; z += range(rng, 140, 320)) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = terrain.centerX(z) + side * range(rng, 0.35, 0.95) * terrain.halfWidth(z);
    const ground = terrain.height(x, z);
    const radius = range(rng, 6, 12);
    const spire = new Pillar(x, z, ground - 10, ground + range(rng, 40, 110), radius * 1.3, radius * 1.3 * 0.35);
    if (clearOfLine(spire, LINE_CLEARANCE)) obstacles.push(spire);
  }

  // Boulders lying in the grass, half sunk into it
  for (let i = 0; i < 70; i++) {
    const z = range(rng, 150, endZ);
    const side = rng() < 0.5 ? -1 : 1;
    const x = terrain.centerX(z) + side * (terrain.riverWidth(z) * 2 + range(rng, 0, 1) * terrain.halfWidth(z));
    const radius = range(rng, 3, 9);
    const rock = new Rock(x, terrain.height(x, z) + radius * 0.3, z, radius);
    if (clearOfLine(rock, LINE_CLEARANCE)) obstacles.push(rock);
  }

  // Natural rock arches over the river
  for (let i = 0; i < 8; i++) {
    const z = range(rng, 300, endZ - 200);
    const dx = terrain.centerX(z + 20) - terrain.centerX(z - 20);
    const arch = new Arch(
      terrain.centerX(z),
      terrain.floorY(z) - range(rng, 0, 15),
      z,
      terrain.halfWidth(z) * 0.8 + range(rng, 10, 40),
      range(rng, 5, 9),
      Math.atan2(dx, 40),
    );
    if (clearOfLine(arch, LINE_CLEARANCE)) obstacles.push(arch);
  }
  return obstacles;
}
