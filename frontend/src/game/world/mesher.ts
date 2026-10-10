import { clearOfItems } from "./itemClearance";
import { Color } from "three";
import { smoothstep } from "../math";
import { hash3 } from "../rng";
import { TUBE_RADIUS } from "./course";
import type { Palette } from "./palette";
import type { World } from "./World";
import { cleanMesh, remapFaces } from "./meshCleanup";

// Surface nets: sample the rock's distance field on a grid, put one vertex in
// every cell the surface crosses, and join the vertices of the four cells around
// every crossed grid edge into a quad. A coarse grid and one color per triangle
// give the low-poly look. Runs in web workers (see mesher.worker.ts).

export const VOXEL = 6; // metres between samples
export const CHUNK_VOXELS = 16;
export const CHUNK_SIZE = VOXEL * CHUNK_VOXELS;

export interface ChunkMesh {
  positions: Float32Array; // flat-shaded triangles, world coordinates
  colors: Float32Array;
  trees: Float32Array; // [x, ground, z, height, radius] per tree
  /** Per tree, how far below `ground` its trunk is drawn: down to the snapped rock, never changing its collider */
  treeSink: Float32Array;
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

interface Colors {
  grass: Color;
  rock: Color;
  under: Color;
  snow: Color;
  tunnel: Color;
}

const colorCache = new Map<string, Colors>();

function colorsFor(palette: Palette): Colors {
  let colors = colorCache.get(palette.name);
  if (!colors) {
    const rock = new Color(palette.rock);
    colors = {
      grass: new Color(palette.grass),
      rock,
      under: rock.clone().multiplyScalar(0.62),
      snow: new Color(palette.snow),
      tunnel: rock.clone().multiplyScalar(0.75),
    };
    colorCache.set(palette.name, colors);
  }
  return colors;
}

export function chunkKey(ix: number, iy: number, iz: number): number {
  return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
}

/** Every chunk that might hold rock: the ones overlapping a shape */
export function rockChunks(world: World): { ix: number; iy: number; iz: number; key: number }[] {
  const found = new Map<number, { ix: number; iy: number; iz: number; key: number }>();
  for (const shape of world.legacy!.shapes) {
    const r = shape.bound + VOXEL;
    const range = (c: number) => [Math.floor((c - r) / CHUNK_SIZE), Math.floor((c + r) / CHUNK_SIZE)];
    const [x0, x1] = range(shape.cx);
    const [y0, y1] = range(shape.cy);
    const [z0, z1] = range(shape.cz);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const key = chunkKey(ix, iy, iz);
          if (!found.has(key)) found.set(key, { ix, iy, iz, key });
        }
      }
    }
  }
  return [...found.values()];
}

export function meshChunk(world: World, ix: number, iy: number, iz: number): ChunkMesh {
  const N = CHUNK_VOXELS;
  const D = N + 2; // corners from one before the chunk to one after
  const C = D - 1; // cells
  const S = VOXEL;
  const ox = ix * CHUNK_SIZE - S;
  const oy = iy * CHUNK_SIZE - S;
  const oz = iz * CHUNK_SIZE - S;

  const field = new Float32Array(D * D * D);
  let inside = 0;
  for (let k = 0; k < D; k++) {
    for (let j = 0; j < D; j++) {
      for (let i = 0; i < D; i++) {
        const v = world.legacy!.distance(ox + i * S, oy + j * S, oz + k * S);
        field[i + D * (j + D * k)] = v;
        if (v < 0) inside++;
      }
    }
  }
  if (inside === 0 || inside === field.length) {
    return { positions: new Float32Array(0), colors: new Float32Array(0), trees: new Float32Array(0), treeSink: new Float32Array(0) };
  }

  // One vertex per crossed cell, at the average of where its edges cross the surface
  const vertices = new Float32Array(C * C * C * 3);
  const values = new Float32Array(8);
  for (let k = 0; k < C; k++) {
    for (let j = 0; j < C; j++) {
      for (let i = 0; i < C; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [cx, cy, cz] = CORNERS[c];
          values[c] = field[i + cx + D * (j + cy + D * (k + cz))];
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
      }
    }
  }
  // Keep the original net vertices and triangle diagonal: tree placement and
  // colors on the race map depend on them. Emit the original faces.
  const grid = vertices;
  const distance = (x: number, y: number, z: number) => world.legacy!.distance(x, y, z);

  const positions: number[] = [];
  const colors: number[] = [];
  const trees: number[] = [];
  const treeSink: number[] = [];
  const palette = colorsFor(world.palette);
  const color = new Color();
  const cell = (i: number, j: number, k: number) => (i + C * (j + C * k)) * 3;
  const emit = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };

  const triangle = (a: number, b: number, c: number) => {
    const ax = grid[a];
    const ay = grid[a + 1];
    const az = grid[a + 2];
    const e1x = grid[b] - ax;
    const e1y = grid[b + 1] - ay;
    const e1z = grid[b + 2] - az;
    const e2x = grid[c] - ax;
    const e2y = grid[c + 1] - ay;
    const e2z = grid[c + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-6) return;
    const up = ny / length; // 1 facing the sky, -1 facing the clouds below
    const mx = ax + (e1x + e2x) / 3;
    const my = ay + (e1y + e2y) / 3;
    const mz = az + (e1z + e2z) / 3;
    const jitter = hash3(Math.round(mx * 4), Math.round(my * 4), Math.round(mz * 4));
    const above = my - world.course.y(mz);

    // Grassy tops, rocky sides, darker undersides, snow on the highest islands
    color.copy(palette.rock).lerp(palette.grass, smoothstep(0.45, 0.7, up));
    const snowy = up > 0.5 && above > 70 + 40 * jitter;
    if (snowy) color.lerp(palette.snow, smoothstep(0.5, 0.75, up));
    color.lerp(palette.under, smoothstep(-0.15, -0.55, up));
    // Tunnel walls along the racing line
    if (world.course.distance(mx, my, mz) < TUBE_RADIUS + 3) color.lerp(palette.tunnel, 0.6);
    color.multiplyScalar(0.92 + 0.16 * jitter);

    emit(vertices[a], vertices[a + 1], vertices[a + 2], vertices[b], vertices[b + 1], vertices[b + 2], vertices[c], vertices[c + 1], vertices[c + 2]);

    // A pine now and then on flat grass, never in the way of the racing line
    if (up > 0.88 && !snowy && jitter < 0.08) {
      const height = 6 + 8 * hash3(Math.round(mx * 4), Math.round(mz * 4), 3);
      if (world.course.distance(mx, my + height / 2, mz) > TUBE_RADIUS + height / 2 + 4 && clearOfItems(world,mx,my,mz,height,height*0.27)) {
        trees.push(mx, my - 0.3, mz, height, height * 0.27);
        // The rock drawn there may now lie lower than the grid's face: reach down to it
        treeSink.push(Math.max(0, distance(mx, my, mz)));
      }
    }
  };

  const quad = (a: number, b: number, c: number, d: number) => {
    triangle(a, b, c);
    triangle(a, c, d);
  };

  // A quad for every grid edge the surface crosses, from the four cells around it.
  // Only edges starting at this chunk's own corners, so neighbouring chunks never overlap.
  for (let k = 1; k <= N; k++) {
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        const v0 = field[i + D * (j + D * k)];
        const inside0 = v0 < 0;
        // Along x: the cells around it span y and z
        if (inside0 !== field[i + 1 + D * (j + D * k)] < 0) {
          const q = [cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k)];
          if (inside0) quad(q[0], q[1], q[2], q[3]);
          else quad(q[0], q[3], q[2], q[1]);
        }
        // Along y: the cells around it span z and x
        if (inside0 !== field[i + D * (j + 1 + D * k)] < 0) {
          const q = [cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1)];
          if (inside0) quad(q[0], q[1], q[2], q[3]);
          else quad(q[0], q[3], q[2], q[1]);
        }
        // Along z: the cells around it span x and y
        if (inside0 !== field[i + D * (j + D * (k + 1))] < 0) {
          const q = [cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k)];
          if (inside0) quad(q[0], q[1], q[2], q[3]);
          else quad(q[0], q[3], q[2], q[1]);
        }
      }
    }
  }

  const cleaned = cleanMesh(new Float32Array(positions), [ix * CHUNK_SIZE, iy * CHUNK_SIZE, iz * CHUNK_SIZE], CHUNK_SIZE, S);
  return {
    positions: cleaned.positions,
    colors: remapFaces(new Float32Array(colors), cleaned.sources, 9),
    trees: new Float32Array(trees),
    treeSink: new Float32Array(treeSink),
  };
}
