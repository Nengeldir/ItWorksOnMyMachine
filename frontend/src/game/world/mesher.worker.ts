// Cuts land meshes off the main thread. Every worker builds the same World from
// the level's key (it's deterministic), then meshes whichever chunks it is asked
// for: the race map's chunks (legacy) or generator-v2 nodes at any level of detail.
import { type LevelKey, levelId, makeLevel } from "./biomes";
import { meshChunk } from "./mesher";
import { meshNode } from "./terrain/mesh";
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
    const mesh = meshNode(world, request.lod, request.ix, request.iy, request.iz);
    const transfer = mesh.positions.length ? [mesh.positions.buffer, mesh.rock.buffer, mesh.cover.buffer, mesh.snow.buffer] : [];
    self.postMessage({ kind: "node", level: id, key: request.key, ...mesh }, { transfer });
  }
};
