import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/game/world/World.ts";
import { runLevel } from "../src/game/world/biomes/index.ts";
import { placeFlora } from "../src/game/world/flora/placement.ts";
import { PLANT_STRIDE } from "../src/game/world/flora/species.ts";
import { STRUCTURE_INFO, kindInfo } from "../src/game/world/structures/kinds.ts";
import { Plant } from "../src/game/world/trees.ts";

test("a windmill collides with its tower and the disc its sails sweep, turned by its yaw", () => {
  const shape = STRUCTURE_INFO.windmill.collider;
  const h = 20;
  // Yaw 0: the sails face +z, 0.21 h out front, around the hub at 0.78 h
  const mill = new Plant(0, 0, 0, h, h, 0, shape);
  assert.ok(mill.distance(0, 0.4 * h, 0) < 0, "inside the tower");
  assert.ok(mill.distance(0.4 * h, 0.78 * h, 0.21 * h) < 0, "a sail's tip");
  assert.ok(mill.distance(0.4 * h, 0.78 * h, -0.1 * h) > 1, "beside the tower, behind the sails");
  assert.ok(mill.distance(0.4 * h, 0.78 * h, 0.21 * h + 3) > 1, "in front of the sails");
  // A quarter turn: the sails face +x
  const turned = new Plant(0, 0, 0, h, h, Math.PI / 2, shape);
  assert.ok(turned.distance(0.21 * h, 0.78 * h, 0.4 * h) < 0);
  assert.ok(turned.distance(0.4 * h, 0.78 * h, 0.21 * h) > 1);
});

test("structures stand in the same spots at every level of detail, clear of the racing line", () => {
  const world = new World(runLevel(2, 1, "verdant"));
  const species = world.biome.vegetation.species.length;
  const built = (box) => {
    const out = [];
    const { plants } = placeFlora(world, box, false);
    for (let o = 0; o < plants.length; o += PLANT_STRIDE) if (plants[o] >= species) out.push(Array.from(plants.slice(o, o + PLANT_STRIDE)));
    return out;
  };
  const key = (p) => p.map((n) => n.toFixed(3)).join(",");
  const z0 = 768;
  const x0 = Math.floor(world.course.x(z0 + 192) / 384) * 384;
  const y0 = Math.floor(world.course.y(z0 + 192) / 384) * 384;
  const coarse = [];
  const fine = [];
  for (const dy of [-384, 0]) {
    coarse.push(...built({ x0, y0: y0 + dy, z0, x1: x0 + 384, y1: y0 + dy + 384, z1: z0 + 384 }));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      const x = x0 + i * 96, y = y0 + dy + j * 96, z = z0 + k * 96;
      fine.push(...built({ x0: x, y0: y, z0: z, x1: x + 96, y1: y + 96, z1: z + 96 }));
    }
  }
  assert.ok(coarse.length > 3, `only ${coarse.length} structures`);
  assert.deepEqual(fine.map(key).sort(), coarse.map(key).sort());
  for (const p of coarse) {
    const [kind, x, y, z, height, radius, yaw] = p;
    const collider = new Plant(x, y, z, height, radius, yaw, kindInfo(world.biome, kind).collider);
    for (let cz = z - 30; cz <= z + 30; cz += 2) {
      assert.ok(collider.distance(world.course.x(cz), world.course.y(cz), cz) > 3, "a structure reaches into the racing line");
    }
  }
});

test("bridges span the river with an arch to fly through, well under the racing line", async () => {
  const { Bridge } = await import("../src/game/world/terrain/shapes.ts");
  let total = 0;
  for (const seed of [2, 3, 7]) {
    const world = new World(runLevel(seed, 1, "verdant"));
    const steps = world.steps;
    const bridges = world.land.shapes.filter((s) => s instanceof Bridge);
    total += bridges.length;
    for (const b of bridges) {
      const z = b.cz;
      const x = steps.center(z);
      const water = steps.pool(z).level;
      assert.ok(world.land.distance(x, water + 4, z) > 2, "the arch is open over the water");
      assert.ok(world.land.distance(x, water + 16, z) < 0, "the crown is solid");
      // Nothing of it within reach of the racing tube (the shape's distance is a lower bound)
      for (let cz = z - 40; cz <= z + 40; cz += 2) {
        assert.ok(b.distance(world.course.x(cz), world.course.y(cz), cz) > 11 + 1, "a bridge crowds the racing line");
      }
    }
  }
  assert.ok(total >= 4, `only ${total} bridges over three levels`);
  console.log("bridges over three levels:", total);
});

test("a shrine gate collides with its posts and lintel, and is open in between", () => {
  const h = 20;
  // Yaw 0: the posts stand 0.36 h either side along x, the opening looks along z
  const gate = new Plant(0, 0, 0, h, h, 0, STRUCTURE_INFO.shrineGate.collider);
  assert.ok(gate.distance(0.36 * h, 0.4 * h, 0) < 0, "inside a post");
  assert.ok(gate.distance(0, 0.86 * h, 0) < 0, "inside the lintel");
  assert.ok(gate.distance(0, 0.4 * h, 0) > 4, "through the opening");
  const turned = new Plant(0, 0, 0, h, h, Math.PI / 2, STRUCTURE_INFO.shrineGate.collider);
  assert.ok(turned.distance(0, 0.4 * h, 0.36 * h) < 0, "a post, turned a quarter");
});

test("every run biome has a landmark and scattered structures, the same at every level of detail", () => {
  for (const biome of ["glacier", "archipelago", "lagoon", "twilight", "ember", "aurora"]) {
    const world = new World(runLevel(5, 3, biome));
    const species = world.biome.vegetation.species.length;
    const kinds = world.biome.structures;
    assert.ok(species + kinds.length <= 16, `${biome}: more kinds than the impostor atlas has cells`);
    assert.ok(kinds[0].landmark, `${biome}: the landmark comes first`);
    const built = (box, out) => {
      const { plants } = placeFlora(world, box, false);
      for (let o = 0; o < plants.length; o += PLANT_STRIDE) if (plants[o] >= species) out.push(Array.from(plants.slice(o, o + PLANT_STRIDE)).map((n) => n.toFixed(3)).join(","));
    };
    const coarse = [];
    const fine = [];
    const landmarks = new Set();
    for (let band = 0; band < 6; band++) {
      const z0 = band * 384;
      const x0 = Math.floor(world.course.x(z0 + 192) / 384) * 384;
      const y0 = Math.floor(world.course.y(z0 + 192) / 384) * 384;
      for (const dx of [-384, 0, 384]) for (const dy of [-384, 0]) built({ x0: x0 + dx, y0: y0 + dy, z0, x1: x0 + dx + 384, y1: y0 + dy + 384, z1: z0 + 384 }, coarse);
      if (band !== 2) continue;
      for (const dy of [-384, 0]) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
        const x = x0 + i * 96, y = y0 + dy + j * 96, z = z0 + k * 96;
        built({ x0: x, y0: y, z0: z, x1: x + 96, y1: y + 96, z1: z + 96 }, fine);
      }
    }
    for (const p of coarse) if (Number(p.split(",")[0]) === species) landmarks.add(p);
    assert.ok(landmarks.size >= 1 && landmarks.size <= 3, `${biome}: ${landmarks.size} landmarks`);
    assert.ok(coarse.length > 15, `${biome}: only ${coarse.length} structures`);
    const here = new Set(coarse);
    assert.ok(fine.length > 0 && fine.every((p) => here.has(p)), `${biome}: full-detail nodes disagree with coarse ones`);
  }
});
