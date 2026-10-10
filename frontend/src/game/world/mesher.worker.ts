// Cuts land meshes off the main thread. Every worker builds the same World from
// the level's key (it's deterministic), then meshes whichever chunks it is asked
// for: the race map's chunks (legacy) or generator-v2 nodes at any level of detail.
import { type LevelKey, levelId, makeLevel } from "./biomes";
import { placeFlora } from "./flora/placement";
import { meshChunk } from "./mesher";
import { NODE_SIZE, meshNode } from "./terrain/mesh";
import type { NodeRequest } from "./terrain/streamer";
import { World } from "./World";

export interface ChunkRequest {
  kind: "chunk";
  key: number;
  ix: number;
  iy: number;
  iz: number;
}

export type MeshRequest = { level: LevelKey } & (ChunkRequest | NodeRequest);

let world: World | null = null;
let worldId = "";

self.onmessage = (event: MessageEvent<MeshRequest>) => {
  const request = event.data;
  const id = levelId(request.level);
  if (!world || worldId !== id) {
    world = new World(makeLevel(request.level));
    worldId = id;
  }
  if (request.kind === "chunk") {
    const mesh = meshChunk(world, request.ix, request.iy, request.iz);
    self.postMessage(
      { kind: "chunk", level: id, key: request.key, ...mesh },
      { transfer: [mesh.positions.buffer, mesh.colors.buffer, mesh.trees.buffer] },
    );
  } else {
    const { lod, ix, iy, iz } = request;
    const mesh = meshNode(world, lod, ix, iy, iz);
    const size = NODE_SIZE << lod;
    const flora = placeFlora(world, { x0: ix * size, y0: iy * size, z0: iz * size, x1: (ix + 1) * size, y1: (iy + 1) * size, z1: (iz + 1) * size }, lod === 0);
    const transfer = [flora.plants.buffer, flora.tufts.buffer];
    if (mesh.positions.length) transfer.push(mesh.positions.buffer, mesh.rock.buffer, mesh.cover.buffer, mesh.snow.buffer);
    self.postMessage({ kind: "node", level: id, key: request.key, ...mesh, ...flora }, { transfer: transfer.filter((b) => b.byteLength > 0) });
  }
};
