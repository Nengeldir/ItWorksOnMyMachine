import type { Rng } from "../rng";

// Zen's open world: one map with no racing line, going on in every direction.
// Its land, water, clouds and sea life are made in square cells around you,
// each from its own seeded streams (`land/<cx>,<cz>`…), so a cell is the same
// whichever order the cells come in, on every thread, and one let go far
// behind comes back the same. Its course is level at y = 0 (`Course.open`):
// the height everything is measured from, as a level's land is from its line.

/** Metres a side of an open world's cell */
export const CELL = 1024;
/**
 * Scenery per square metre, against a level's: a level gathers its rock, islands and clouds within
 * a few hundred metres of the line, an open world spreads that many evenly. Below 1, a little
 * sparser, so the land you see at once costs about what a level's does.
 */
export const DENSITY = 0.7;
/** Metres of z a level spreads its scenery over (from before its start to past its end) */
const COURSE_SPREAD = 2960;

export interface Area {
  cx: number;
  cz: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** For seeded streams and maps: "cx,cz" */
  key: string;
}

export function cell(cx: number, cz: number): Area {
  return { cx, cz, x0: cx * CELL, z0: cz * CELL, x1: (cx + 1) * CELL, z1: (cz + 1) * CELL, key: `${cx},${cz}` };
}

/** The cell holding (x, z) */
export function cellAt(x: number, z: number): Area {
  return cell(Math.floor(x / CELL), Math.floor(z / CELL));
}

/** Every cell overlapping the rectangle x0..x1, z0..z1 */
export function cellsIn(x0: number, z0: number, x1: number, z1: number): Area[] {
  const out: Area[] = [];
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) out.push(cell(cx, cz));
  }
  return out;
}

/** A number for a cell, unique for ±32768 cells (33 000 km) each way */
export function cellIndex(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

/**
 * How many of something a level spreads up to `width` metres either side of its line go in one
 * cell: as many per square metre (times `DENSITY`), the fraction rounded at random
 */
export function perCell(rng: Rng, count: number, width: number): number {
  const expected = (DENSITY * count * CELL * CELL) / (COURSE_SPREAD * 2 * Math.max(width, 200));
  return Math.floor(expected) + (rng() < expected % 1 ? 1 : 0);
}
