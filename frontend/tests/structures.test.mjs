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
  for (const biome of ["glacier", "archipelago", "lagoon", "twilight", "ember", "aurora", "reef"]) {
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

test("the ETH main building collides along its whole length, and only some levels have one", () => {
  const h = 30;
  // Yaw 0: the wings run along x, the rotunda looks along z
  const eth = new Plant(0, 0, 0, h, h, 0, STRUCTURE_INFO.ethMainBuilding.collider);
  assert.ok(eth.distance(1.05 * h, 0.3 * h, 0) < 0, "inside the end of a wing");
  assert.ok(eth.distance(0, 0.85 * h, 0.1 * h) < 0, "inside the dome");
  assert.ok(eth.distance(1.05 * h, 0.8 * h, 0) > 3, "above the wing's roof");
  assert.ok(eth.distance(0, 0.3 * h, 0.9 * h) > 3, "in front of the rotunda");
  const turned = new Plant(0, 0, 0, h, h, Math.PI / 2, STRUCTURE_INFO.ethMainBuilding.collider);
  assert.ok(turned.distance(0, 0.3 * h, 1.05 * h) < 0 && turned.distance(1.05 * h, 0.3 * h, 0) > 3);
  // Seeds 2 and 3 have none, seed 6 has one (about one Verdant level in six does)
  const count = (seed) => {
    const world = new World(runLevel(seed, 1, "verdant"));
    assert.equal(world.biome.structures[0].id, "ethMainBuilding");
    const species = world.biome.vegetation.species.length;
    let n = 0;
    for (let iz = 0; iz < 7; iz++) {
      const cx = Math.floor(world.course.x(iz * 384 + 192) / 384), cy = Math.floor(world.course.y(iz * 384 + 192) / 384);
      for (let ix = cx - 2; ix <= cx + 2; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const { plants } = placeFlora(world, { x0: ix * 384, y0: iy * 384, z0: iz * 384, x1: ix * 384 + 384, y1: iy * 384 + 384, z1: iz * 384 + 384 }, false);
        for (let o = 0; o < plants.length; o += PLANT_STRIDE) if (plants[o] === species) n++;
      }
    }
    return n;
  };
  assert.equal(count(2), 0);
  assert.equal(count(6), 1);
});

test("the Einstein bust is a rare landmark close to the racing line", () => {
  const find = (seed) => {
    const world = new World(runLevel(seed, 1, "verdant"));
    assert.equal(world.biome.structures[1].id, "einsteinBust");
    const kind = world.biome.vegetation.species.length + 1;
    const out = [];
    for (let iz = 0; iz < 7; iz++) {
      const cx = Math.floor(world.course.x(iz * 384 + 192) / 384), cy = Math.floor(world.course.y(iz * 384 + 192) / 384);
      for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const { plants } = placeFlora(world, { x0: ix * 384, y0: iy * 384, z0: iz * 384, x1: ix * 384 + 384, y1: iy * 384 + 384, z1: iz * 384 + 384 }, false);
        for (let o = 0; o < plants.length; o += PLANT_STRIDE) if (plants[o] === kind) out.push(Math.abs(plants[o + 1] - world.course.x(plants[o + 3])));
      }
    }
    return out;
  };
  assert.equal(find(2).length, 0);
  const near = find(6);
  assert.equal(near.length, 1);
  assert.ok(near[0] >= 25 && near[0] <= 140, `${near[0]} m from the line`);
});

test("a shipwreck collides with its hull and its mast, which leans back with the bow up", () => {
  const h = 26;
  // Yaw 0: the hull runs along x, bow towards +x
  const wreck = new Plant(0, 0, 0, h, h, 0, STRUCTURE_INFO.shipwreck.collider);
  assert.ok(wreck.distance(0.7 * h, 0.15 * h, 0) < 0, "inside the bow");
  assert.ok(wreck.distance(-0.7 * h, 0.15 * h, 0) < 0, "inside the stern");
  assert.ok(wreck.distance(-0.13 * h, 0.9 * h, 0) < 0, "the top of the mast, leaning aft");
  assert.ok(wreck.distance(0.13 * h, 0.9 * h, 0) > 2, "ahead of the mast");
  assert.ok(wreck.distance(0.5 * h, 0.6 * h, 0) > 4, "over the foredeck");
  assert.ok(wreck.distance(0, 0.15 * h, 0.4 * h) > 3, "beside the hull");
});

test("every run dives to the Sunken Reef, and leaves one of the other middle biomes out", async () => {
  const { runOrder, destination, RUN_LENGTH } = await import("../src/game/run/run.ts");
  const middle = ["glacier", "archipelago", "lagoon", "twilight", "ember"];
  const left = new Set();
  const slots = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const order = runOrder(seed);
    assert.equal(order.length, RUN_LENGTH);
    assert.equal(new Set(order).size, RUN_LENGTH, "a biome comes twice");
    assert.deepEqual([order[0], order[1], order[RUN_LENGTH - 1]], ["skyIsles", "verdant", "aurora"]);
    assert.ok(order.includes("reef"));
    const out = middle.filter((b) => !order.includes(b));
    assert.equal(out.length, 1);
    left.add(out[0]);
    slots.add(order.indexOf("reef"));
    // The portals lead along the same order
    const path = [];
    for (let level = 1; level <= RUN_LENGTH; level++) {
      path.push(level === 1 ? order[0] : destination(seed, level - 1, path));
    }
    assert.deepEqual(path, order);
  }
  assert.equal(left.size, middle.length, "every middle biome sits out some runs");
  assert.equal(slots.size, 5, "the reef comes at every place from third to seventh");
});
