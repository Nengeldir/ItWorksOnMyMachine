// Cuts rock meshes off the main thread. Every worker builds the same World from
// the seed (it's deterministic), then meshes whichever chunks it is asked for.
import { meshChunk } from "./mesher";
import { World } from "./World";

export interface MeshRequest {
  seed: number;
  key: number;
  ix: number;
  iy: number;
  iz: number;
}

let world: World | null = null;

self.onmessage = (event: MessageEvent<MeshRequest>) => {
  const { seed, key, ix, iy, iz } = event.data;
  if (!world || world.seed !== seed) world = new World(seed);
  const mesh = meshChunk(world, ix, iy, iz);
  self.postMessage(
    { seed, key, ...mesh },
    { transfer: [mesh.positions.buffer, mesh.colors.buffer, mesh.trees.buffer] },
  );
};
