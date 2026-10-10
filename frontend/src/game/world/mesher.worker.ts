// Cuts rock meshes off the main thread. Every worker builds the same World from
// the level's key (it's deterministic), then meshes whichever chunks it is asked for.
import { type LevelKey, levelId, makeLevel } from "./biomes";
import { meshChunk } from "./mesher";
import { World } from "./World";

export interface MeshRequest {
  level: LevelKey;
  key: number;
  ix: number;
  iy: number;
  iz: number;
}

let world: World | null = null;
let worldId = "";

self.onmessage = (event: MessageEvent<MeshRequest>) => {
  const { level, key, ix, iy, iz } = event.data;
  const id = levelId(level);
  if (!world || worldId !== id) {
    world = new World(makeLevel(level));
    worldId = id;
  }
  const mesh = meshChunk(world, ix, iy, iz);
  self.postMessage(
    { level: id, key, ...mesh },
    { transfer: [mesh.positions.buffer, mesh.colors.buffer, mesh.trees.buffer] },
  );
};
