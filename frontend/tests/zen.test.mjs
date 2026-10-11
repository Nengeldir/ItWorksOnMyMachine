import assert from 'node:assert/strict';
import test from 'node:test';
import { World } from '../src/game/world/World.ts';
import { makeLevel } from '../src/game/world/biomes/index.ts';
import { CELL } from '../src/game/world/open.ts';
import { meshNode, NODE_SIZE } from '../src/game/world/terrain/mesh.ts';
import { seedMap, zenLevel } from '../src/game/world/biomes/index.ts';
import { screenFromSearch, urlFor } from '../src/route.ts';

// Zen's open world: no line, land every way, made a cell at a time. Every thread (the main one
// and each mesher worker) makes cells in its own order and lets far ones go, so a cell must come
// out the same whatever was made before it.

const open = (biome, seed = 5) => new World(makeLevel({ biome, seed, mood: 0, runSeed: 0, index: 0, open: true }));

/** Points spread over a few kilometres around the start, from the ground up into the sky */
const SAMPLES = Array.from({ length: 300 }, (_, i) => [((i * 7919) % 5000) - 2500, ((i * 104729) % 400) - 120, ((i * 1299709) % 5000) - 2500]);

test('an open world has no line: no gates, no rings, no tube, level at y = 0', () => {
  const world = open('verdant');
  assert.equal(world.course.rings.length, 0);
  assert.equal(world.course.gates.length, 0);
  for (const z of [-9_000, 0, 40_000]) {
    assert.equal(world.course.y(z), 0);
    assert.equal(world.course.distance(0, 0, z), Infinity);
  }
  assert.deepEqual(world.course.startDirection.toArray(), [0, 0, 1]);
});

test('every cell is the same whichever order the cells are made in', () => {
  for (const biome of ['verdant', 'archipelago', 'lagoon']) {
    const near = open(biome, 3);
    const far = open(biome, 3);
    far.ensure(12_000, -9_000, 12_000, -9_000);
    far.ensure(-7_000, 30_000, -7_000, 30_000);
    for (const [x, y, z] of SAMPLES) assert.equal(far.distance(x, y, z), near.distance(x, y, z), `${biome} at ${x}, ${y}, ${z}`);
  }
});

test('land goes on every way, and cells far behind are let go and come back the same', () => {
  const world = open('verdant', 9);
  const before = SAMPLES.map(([x, y, z]) => world.distance(x, y, z));
  const counts = [];
  // A long flight out sideways and round: there is land wherever you go
  for (let k = 1; k <= 40; k++) {
    const x = Math.cos(k * 0.4) * k * 1_500;
    const z = Math.sin(k * 0.4) * k * 1_500;
    world.ensure(x, z, x, z);
    assert.ok(world.land.columnRange(x - 200, z - 200, x + 200, z + 200), `land at ${x | 0}, ${z | 0}`);
    counts.push(world.land.shapes.length);
  }
  assert.ok(world.cells.length <= 120, `${world.cells.length} cells kept`);
  assert.ok(Math.max(...counts.slice(20)) < Math.max(...counts.slice(0, 20)) * 2, `shapes kept ${counts}`);
  SAMPLES.forEach(([x, y, z], i) => assert.equal(world.distance(x, y, z), before[i], `back at ${x}, ${y}, ${z}`));
});

test('the ground keeps to the heights of a level, with rivers in its valleys', () => {
  for (const biome of ['verdant', 'glacier', 'ember', 'aurora']) {
    const world = open(biome, 7);
    const ground = world.land.ground;
    const level = world.openWater.level;
    let wet = 0;
    let n = 0;
    let top = -Infinity;
    for (let x = -5_000; x <= 5_000; x += 100) {
      for (let z = -5_000; z <= 5_000; z += 100) {
        const h = ground.height(x, z);
        top = Math.max(top, h);
        if (h < level) wet++;
        n++;
      }
    }
    assert.ok(top < 1_400, `${biome}: highest ground ${top}`);
    assert.ok(wet / n > 0.01 && wet / n < 0.15, `${biome}: ${((100 * wet) / n).toFixed(1)}% under water`);
    // Water only where the ground dips below it
    const hit = { distance: 0, level: 0, kind: 'water' };
    let dry = null;
    for (let x = 0; x < 3_000 && dry === null; x += 50) if (ground.height(x, 0) > level + 20) dry = x;
    assert.equal(world.waterNear(dry, level + 2, 0, hit), null, `${biome}: no water on dry land`);
  }
});

test('valleys never jump: the land eases up from them, no cliff off a flat floor', () => {
  const ground = open('aurora', 5).land.ground;
  let worst = 0;
  for (let x = -4_000; x < 4_000; x += 10) {
    const z = x * 0.37 + 900;
    worst = Math.max(worst, Math.abs(ground.valleyDistance(x + 10, z) - ground.valleyDistance(x, z)));
  }
  assert.ok(worst < 80, `distance from a valley jumped ${worst.toFixed(0)} m in 10 m`);
});

test('a lagoon is a level sea everywhere, its islets and stacks standing in it', () => {
  const world = open('lagoon', 4);
  for (const z of [0, -2_000, 9_000]) assert.equal(world.seaAt(z), -24, `sea at ${z}`);
  assert.ok(world.land.shapes.length > 0);
});

test('meshing an open cell works anywhere, far from where the world began', () => {
  const world = open('ember', 11);
  let triangles = 0;
  for (const [x, z] of [[0, 0], [9_000, -4_000], [-15_000, 22_000]]) {
    const y = world.land.ground.height(x, z);
    const mesh = meshNode(world, 0, Math.floor(x / NODE_SIZE), Math.floor(y / NODE_SIZE), Math.floor(z / NODE_SIZE));
    triangles += mesh.positions.length / 9;
  }
  assert.ok(triangles > 0);
});

test('the streamer plants land around you every way, digs it up behind, and loads in a cone ahead', async () => {
  const THREE = await import('three');
  const { LandStreamer } = await import('../src/game/world/terrain/streamer.ts');
  const { LandCollider } = await import('../src/game/world/landCollider.ts');
  const world = open('verdant', 5);
  const land = new LandStreamer(world, new THREE.Group(), new THREE.MeshBasicMaterial(), null, new LandCollider());
  const asked = [];
  const request = (r) => (asked.push(r), true);
  // Every request comes back at once, empty: this is about which land is wanted, not its meshes
  const answer = () => {
    for (const r of asked.splice(0)) land.receive({ key: r.key, positions: new Float32Array(0), rock: new Uint8Array(0), cover: new Uint8Array(0), snow: new Float32Array(0), plants: new Float32Array(0), tufts: new Float32Array(0) });
  };
  const at = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  // Flying out sideways (+x), the way a line never went
  const fly = (x) => {
    at.set(x, Math.max(world.land.ground.height(x, 0), world.openWater.level) + 60, 0);
    velocity.set(45, 0, 0);
    land.update(at, request, velocity);
    answer();
  };
  const most = (from, to) => {
    let roots = 0;
    let nodes = 0;
    for (let x = from; x < to; x += 30) {
      fly(x);
      roots = Math.max(roots, land.roots.length);
      nodes = Math.max(nodes, land.byKey.size);
    }
    return { roots, nodes };
  };
  const early = most(0, 5_000);
  const late = most(5_000, 15_000);
  for (let i = 0; i < 4; i++) fly(15_000);
  assert.ok(land.ready, 'the land around you is in');
  assert.ok(late.roots < early.roots * 1.4 && late.nodes < early.nodes * 1.4, `kept ${JSON.stringify(early)} early, ${JSON.stringify(late)} late`);
  assert.ok(land.roots.every((root) => root.box.max.x > 15_000 - 2_600), 'nothing kept from far behind');
  assert.ok(land.roots.some((root) => root.box.min.x > 15_000 + 900), 'land planted ahead');
  assert.ok(land.roots.some((root) => root.box.max.z < -900) && land.roots.some((root) => root.box.min.z > 900), 'land planted to both sides');
  // The cone: as far ahead as behind, the land ahead is finer
  const lodAt = (x) => {
    const p = new THREE.Vector3(x, world.land.ground.height(x, 0), 0);
    return land.desired.find((node) => node.box.containsPoint(p))?.lod;
  };
  const ahead = lodAt(15_000 + 520);
  const back = lodAt(15_000 - 520);
  assert.ok(ahead !== undefined && back !== undefined && ahead < back, `ahead lod ${ahead}, behind lod ${back}`);
  // Collisions where the land isn't planted yet fall back to the field
  assert.equal(land.covers(60_000, 0, 60_000), false);
  land.dispose();
});

test('Zen has a URL and flies the map a seed stands for, Sky Isles too', () => {
  assert.deepEqual(screenFromSearch('?zen=5', true), { kind: 'zen', seed: 5 });
  assert.equal(urlFor({ kind: 'zen', seed: 5 }), '/?zen=5');
  // 16 is Sky Isles' showcase seed: an open world like any other map
  assert.equal(seedMap(16).biome, 'skyIsles');
  const sky = new World(zenLevel(16));
  assert.equal(sky.open, true);
  sky.ensure(5_000, 5_000, 5_000, 5_000);
  assert.ok(sky.land.columnRange(4_000, 4_000, 6_000, 6_000), 'islands far off the start');
  const level = zenLevel(5);
  assert.equal(level.key.open, true);
  assert.equal(level.biome.id, 'verdant');
  assert.ok(CELL > 0);
});
