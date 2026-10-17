// The Reaches' region map (docs/open-world-plan.md R1): which region every point of the world belongs to,
// and how much, so borders blend instead of stepping. Lanternhaven sits in the middle, the surface regions
// (shared/catalog/regions.json) on a ring round it, each owning the land nearest its centre (a Voronoi map)
// with borders that wander (the point is warped by a seeded noise first). Within `borders.band` metres of a
// border the two regions share it, 50/50 on the line; the hub fades into the region round it over
// `borders.hubBand`. Beyond `worldRadius` there is only open sky.
//
// backend/regions.py is the same function on the same numbers, and both run
// shared/catalog/tests/region-vectors.json. To agree to the last bit it uses only + − × ÷, floor and sqrt
// (exactly rounded in both languages) and a 32-bit integer hash: no sin or cos, whose last bits differ
// between JavaScript and C's maths library.

import { HUB, REGIONS, REGION_BORDERS, WORLD_RADIUS, WORLD_SEED } from "../../catalog";
import type { PlaceId, Region, RegionId } from "../../catalog";

/** What lies past the edge of the Reaches */
export const EDGE = "edge";
export type MapPlace = PlaceId | typeof EDGE;

/**
 * Who owns a point: up to three places sharing it, most first, their weights summing to 1 (two regions near
 * their border; the hub, or the open sky past the edge, taking its share on top)
 */
export interface RegionWeights {
  places: MapPlace[];
  weights: number[];
  /** The place that owns it most, and how much */
  a: MapPlace;
  wa: number;
  /** Metres to the nearest line where places meet (a border, the hub's rim, the edge), after the warp */
  border: number;
}

const SURFACE: readonly Region[] = REGIONS.filter((region) => region.layer === "surface");
// The catalog's ids are checked against its unions by shared/catalog/check.mjs
const SURFACE_IDS = SURFACE.map((region) => region.id as RegionId);
const HUB_ID = HUB.id as PlaceId;

const MASK = 0xffffffff;
/** 32-bit unsigned multiply, as Python's `(a * b) & 0xffffffff` */
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;

/** A number in [0, 1) for an integer lattice point and a stream */
export function latticeHash(ix: number, iz: number, stream: number): number {
  let h = (mul(ix & MASK, 0x27d4eb2d) ^ mul(iz & MASK, 0x165667b1) ^ mul(stream & MASK, 0x9e3779b1)) >>> 0;
  h = mul((h ^ (h >>> 15)) >>> 0, 0x85ebca6b);
  h = mul((h ^ (h >>> 13)) >>> 0, 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1) */
export function valueNoise(x: number, z: number, stream: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = latticeHash(ix, iz, stream), b = latticeHash(ix + 1, iz, stream);
  const c = latticeHash(ix, iz + 1, stream), d = latticeHash(ix + 1, iz + 1, stream);
  const top = a + (b - a) * fx, bottom = c + (d - c) * fx;
  return top + (bottom - top) * fz;
}

/** Where a point lands on the region map once the borders' wander is applied */
export function warp(x: number, z: number): [number, number] {
  const { warp: amount, warpScale: scale } = REGION_BORDERS;
  const s = WORLD_SEED * 4;
  const fine = scale / 2.5;
  const wx = (valueNoise(x / scale, z / scale, s) - 0.5) * 2 + (valueNoise(x / fine, z / fine, s + 1) - 0.5) * 0.8;
  const wz = (valueNoise(x / scale, z / scale, s + 2) - 0.5) * 2 + (valueNoise(x / fine, z / fine, s + 3) - 0.5) * 0.8;
  return [x + wx * amount, z + wz * amount];
}

/** The share of the side a point is on the far side of a line from: ½ on it, 0 `band`/2 beyond it on its own side */
function share(distance: number, band: number): number {
  const t = Math.min(1, Math.max(0, distance / (band / 2)));
  return 0.5 * (1 - smooth(t));
}

/** The weight of whatever lies on the negative side of a line, at signed distance `d` from it */
function within(d: number, band: number): number {
  return d >= 0 ? share(d, band) : 1 - share(-d, band);
}

/** Who owns the point (x, z) on the surface, and how much: regions, the hub, the sky past the edge */
export function regionWeights(x: number, z: number): RegionWeights {
  const [px, pz] = warp(x, z);
  const { band, hubBand } = REGION_BORDERS;
  // The two nearest surface regions, and the distance to the line between them
  let first = 0, second = 1, d1 = Infinity, d2 = Infinity;
  for (let i = 0; i < SURFACE.length; i++) {
    const [cx, cz] = SURFACE[i].center;
    const d = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
    if (d < d1) { second = first; d2 = d1; first = i; d1 = d; }
    else if (d < d2) { second = i; d2 = d; }
  }
  const [ax, az] = SURFACE[first].center, [bx, bz] = SURFACE[second].center;
  const apart = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  const border = (d2 - d1) / (2 * apart);
  const wb = share(border, band);
  // The hub in the middle, or the sky past the edge (never both), takes its share on top
  const [hx, hz] = HUB.center;
  const fromHub = Math.sqrt((px - hx) * (px - hx) + (pz - hz) * (pz - hz)) - HUB.radius;
  const fromEdge = WORLD_RADIUS - Math.sqrt(px * px + pz * pz);
  const hub = within(fromHub, hubBand);
  const sky = within(fromEdge, band);
  const over: MapPlace = hub >= sky ? HUB_ID : EDGE;
  const top = Math.max(hub, sky);
  const entries: [MapPlace, number][] = [[over, top], [SURFACE_IDS[first], (1 - top) * (1 - wb)], [SURFACE_IDS[second], (1 - top) * wb]];
  // Most first (a stable sort: ties keep this order, as Python's sorted does)
  const kept = entries.filter(([, w]) => w > 0).sort((p, q) => q[1] - p[1]);
  return {
    places: kept.map(([place]) => place),
    weights: kept.map(([, w]) => w),
    a: kept[0][0],
    wa: kept[0][1],
    // Where the hub (or the sky) owns it all, the region borders underneath don't count
    border: top >= 1 ? Math.abs(hub >= sky ? fromHub : fromEdge) : Math.min(Math.abs(border), Math.abs(fromHub), Math.abs(fromEdge)),
  };
}

/** The place that owns (x, z) most */
export function regionAt(x: number, z: number): MapPlace {
  return regionWeights(x, z).a;
}

/** A surface region by id (undefined for the hub and the edge) */
export function surfaceRegion(id: MapPlace): Region | undefined {
  return SURFACE.find((region) => region.id === id);
}

export type { RegionId };
