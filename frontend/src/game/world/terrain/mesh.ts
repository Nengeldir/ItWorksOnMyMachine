import { Color } from "three";
import { clamp, smoothstep } from "../../math";
import { hash3 } from "../../rng";
import type { Surface } from "../biomes/types";
import { SurfaceCutter, snapToSurface } from "../snap";
import type { World } from "../World";

// Surface nets for generator-v2 land, at any level of detail. A node of LOD n
// is 96·2ⁿ metres wide with 16 cells a side (6·2ⁿ m voxels), so far land is
// coarse and every node costs about the same. Coarse nodes also own the edges
// one cell past their borders: they overlap their neighbours a little, which
// hides the cracks where two levels of detail meet.
//
// Every triangle is painted flat: a rock color (with strata and streaks), the
// color of what would cover it if it were flat (grass, moss, sand…), how wet it
// is, how much it glows and how high it is for snow. The terrain shader blends
// those by slope; see terrainMaterial.ts.

export const VOXEL = 6;
export const NODE_CELLS = 16;
export const NODE_SIZE = VOXEL * NODE_CELLS;

export interface TerrainMesh {
  positions: Float32Array; // flat triangles, world coordinates
  rock: Uint8Array; // rgba per vertex: rock color, glow
  cover: Uint8Array; // rgba per vertex: cover color, wetness
  snow: Float32Array; // per vertex: metres above the racing line for snow (very negative: never)
}

const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
const EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

interface Paint {
  rock: Color;
  rock2: Color;
  under: Color;
  top: Color;
  top2: Color;
  surface: Surface;
}

const paintCache = new Map<Surface, Paint>();

function paintFor(surface: Surface): Paint {
  let paint = paintCache.get(surface);
  if (!paint) {
    const rock = new Color(surface.rock);
    paint = {
      rock,
      rock2: new Color(surface.rock2 ?? surface.rock),
      under: new Color(surface.under ?? rock.clone().multiplyScalar(0.6).getHex()),
      top: new Color(surface.top),
      top2: new Color(surface.top2 ?? surface.top),
      surface,
    };
    paintCache.set(surface, paint);
  }
  return paint;
}

export function nodeKey(lod: number, ix: number, iy: number, iz: number): number {
  // Up to ±1024 nodes on each axis at every level
  return ((lod * 2048 + ix + 1024) * 2048 + iy + 1024) * 2048 + iz + 1024;
}

const EMPTY: TerrainMesh = { positions: new Float32Array(0), rock: new Uint8Array(0), cover: new Uint8Array(0), snow: new Float32Array(0) };

export function meshNode(world: World, lod: number, ix: number, iy: number, iz: number): TerrainMesh {
  const field = world.land!;
  const terrain = world.biome.terrain;
  if (terrain.kind !== "v2") return EMPTY;
  const N = NODE_CELLS;
  const S = VOXEL << lod;
  const size = S * N;
  const E = lod > 0 ? 1 : 0; // overlap into the neighbours
  const P = 1 + E; // samples before the node's first corner
  const D = N + 2 + 2 * E; // samples a side
  const C = D - 1; // cells a side
  const ox = ix * size - P * S;
  const oy = iy * size - P * S;
  const oz = iz * size - P * S;

  const fieldValues = new Float32Array(D * D * D);
  if (!field.fill(ox, oy, oz, S, D, fieldValues)) return EMPTY;
  let inside = 0;
  for (let i = 0; i < fieldValues.length; i++) if (fieldValues[i] < 0) inside++;
  if (inside === 0 || inside === fieldValues.length) return EMPTY;

  // One vertex per crossed cell, at the average of where its edges cross the surface
  const vertices = new Float32Array(C * C * C * 3);
  const used: number[] = [];
  const values = new Float32Array(8);
  for (let k = 0; k < C; k++) {
    for (let j = 0; j < C; j++) {
      for (let i = 0; i < C; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [cx, cy, cz] = CORNERS[c];
          values[c] = fieldValues[i + cx + D * (j + cy + D * (k + cz))];
          if (values[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let count = 0;
        for (const [a, b] of EDGES) {
          const va = values[a];
          const vb = values[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const [ax, ay, az] = CORNERS[a];
          const [bx, by, bz] = CORNERS[b];
          sx += ax + (bx - ax) * t;
          sy += ay + (by - ay) * t;
          sz += az + (bz - az) * t;
          count++;
        }
        const v = (i + C * (j + C * k)) * 3;
        vertices[v] = ox + (i + sx / count) * S;
        vertices[v + 1] = oy + (j + sy / count) * S;
        vertices[v + 2] = oz + (k + sz / count) * S;
        used.push(v);
      }
    }
  }
  // Full detail (the land you can touch): vertices onto the surface collisions use
  // and faces cut where they still stray from it (ridges, lips, creases)
  const distance = (x: number, y: number, z: number) => field.distance(x, y, z);
  if (lod === 0) snapToSurface(vertices, used, distance, S);
  const cutter = lod === 0 ? new SurfaceCutter(distance) : null;

  const positions: number[] = [];
  const rockOut: number[] = [];
  const coverOut: number[] = [];
  const snowOut: number[] = [];
  const surfaces = terrain.surfaces;
  // Only ask which surface a face belongs to when shapes are nearby; otherwise it's the ground
  const shapesNear = field.shapes.some(
    (s) => s.max.x + 20 >= ox && s.min.x - 20 <= ox + C * S && s.max.y + 20 >= oy && s.min.y - 20 <= oy + C * S && s.max.z + 20 >= oz && s.min.z - 20 <= oz + C * S,
  );
  const steps = world.steps;
  const sea = world.seaLevel;
  const noise = field.noise.n2;
  const rock = new Color();
  const cover = new Color();
  const cell = (i: number, j: number, k: number) => (i + C * (j + C * k)) * 3;
  const byte = (x: number) => Math.round(clamp(x, 0, 1) * 255);
  // The paint of the face being written (every piece of a cut face gets the same)
  const rgba = [0, 0, 0, 0, 0, 0, 0, 0];
  let snowHeight = 0;
  const corner = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    rockOut.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    coverOut.push(rgba[4], rgba[5], rgba[6], rgba[7]);
    snowOut.push(snowHeight);
  };
  const emit = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    corner(ax, ay, az);
    corner(bx, by, bz);
    corner(cx, cy, cz);
  };
  if (cutter) cutter.emit = emit;

  const triangle = (a: number, b: number, c: number) => {
    const ax = vertices[a];
    const ay = vertices[a + 1];
    const az = vertices[a + 2];
    const e1x = vertices[b] - ax;
    const e1y = vertices[b + 1] - ay;
    const e1z = vertices[b + 2] - az;
    const e2x = vertices[c] - ax;
    const e2y = vertices[c + 1] - ay;
    const e2z = vertices[c + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-6) return;
    const up = ny / length;
    const mx = ax + (e1x + e2x) / 3;
    const my = ay + (e1y + e2y) / 3;
    const mz = az + (e1z + e2z) / 3;
    const jitter = hash3(Math.round(mx * 4), Math.round(my * 4), Math.round(mz * 4));
    const id = shapesNear ? field.surfaceAt(mx, my, mz) : field.groundSurface;
    const paint = paintFor(surfaces[id] ?? surfaces[0]);
    const s = paint.surface;
    const above = my - world.course.y(mz);

    // Rock: strata bands wavering around the hill, dark streaks running down, darker undersides
    rock.copy(paint.rock);
    if (s.bands) {
      const band = Math.floor((my + 3 * Math.sin(mx * 0.021 + mz * 0.017)) / s.bands);
      if (band & 1) rock.lerp(paint.rock2, 0.85);
    } else {
      rock.lerp(paint.rock2, smoothstep(0.2, 0.7, noise(mx * 0.03, mz * 0.03 + my * 0.004)) * 0.8);
    }
    if (s.streaks) rock.multiplyScalar(1 - s.streaks * 0.45 * smoothstep(0.1, 0.65, noise(mx * 0.09, mz * 0.09)));
    rock.lerp(paint.under, smoothstep(-0.2, -0.6, up));
    rock.multiplyScalar(0.9 + 0.18 * jitter);

    // Cover: lusher low down and in damp hollows, drier up high
    const damp = 0.5 + 0.5 * noise(mx / 240, mz / 240) - smoothstep(20, 160, above) * 0.45;
    cover.copy(paint.top).lerp(paint.top2, clamp(1 - damp, 0, 1));
    cover.multiplyScalar(0.88 + 0.2 * jitter);

    // Wet: river banks and the water's edge
    let wet = 0;
    if (steps) {
      const lateral = Math.abs(mx - steps.center(mz)) - steps.width(mz) / 2;
      wet = (1 - smoothstep(-1, 7, lateral)) * (1 - smoothstep(0.5, 4, my - steps.level(mz)));
    }
    // Beaches: sand from just under the sea up a few metres
    if (sea !== null && my > sea - 8) wet = Math.max(wet, 1 - smoothstep(1, 4.5, my - sea));

    // Glowing cracks
    let glow = 0;
    if (s.glow) glow = smoothstep(1 - s.glow, 1, 0.5 + 0.5 * noise(mx * 0.11, mz * 0.11 + my * 0.07)) * (0.6 + 0.4 * jitter);

    snowHeight = s.snow ? above + (jitter - 0.5) * 24 : -1e4;
    rgba[0] = byte(rock.r);
    rgba[1] = byte(rock.g);
    rgba[2] = byte(rock.b);
    rgba[3] = byte(glow);
    rgba[4] = byte(cover.r);
    rgba[5] = byte(cover.g);
    rgba[6] = byte(cover.b);
    rgba[7] = byte(wet);
    const bx = vertices[b];
    const by = vertices[b + 1];
    const bz = vertices[b + 2];
    const cx = vertices[c];
    const cy = vertices[c + 1];
    const cz = vertices[c + 2];
    if (cutter) cutter.triangle(ax, ay, az, bx, by, bz, cx, cy, cz);
    else emit(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  const quad = (a: number, b: number, c: number, d: number) => {
    triangle(a, b, c);
    triangle(a, c, d);
  };

  // A quad for every grid edge the surface crosses, from the four cells around it.
  // Edges starting at the node's own corners (plus one cell around, for coarse nodes).
  const first = P - E;
  const last = P + N - 1 + E;
  for (let k = first; k <= last; k++) {
    for (let j = first; j <= last; j++) {
      for (let i = first; i <= last; i++) {
        const inside0 = fieldValues[i + D * (j + D * k)] < 0;
        if (inside0 !== fieldValues[i + 1 + D * (j + D * k)] < 0) {
          const q = [cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k)];
          if (inside0) quad(q[0], q[1], q[2], q[3]);
          else quad(q[0], q[3], q[2], q[1]);
        }
        if (inside0 !== fieldValues[i + D * (j + 1 + D * k)] < 0) {
          const q = [cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1)];
          if (inside0) quad(q[0], q[1], q[2], q[3]);
          else quad(q[0], q[3], q[2], q[1]);
        }
        if (inside0 !== fieldValues[i + D * (j + D * (k + 1))] < 0) {
          const q = [cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k)];
          if (inside0) quad(q[0], q[1], q[2], q[3]);
          else quad(q[0], q[3], q[2], q[1]);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    rock: new Uint8Array(rockOut),
    cover: new Uint8Array(coverOut),
    snow: new Float32Array(snowOut),
  };
}
