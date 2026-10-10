import assert from 'node:assert/strict';
import test from 'node:test';
import { World } from '../src/game/world/World.ts';
import { makeLevel } from '../src/game/world/biomes/index.ts';
import { BLOCK } from '../src/game/world/course.ts';
import { meshNode, NODE_SIZE } from '../src/game/world/terrain/mesh.ts';
import { seedMap, zenLevel, zenSeed } from '../src/game/world/biomes/index.ts';
import { screenFromSearch, urlFor } from '../src/route.ts';

// Zen's endless levels: the line, the land and the water go on for ever, made a block at a
// time. Every thread (the main one and each mesher worker) makes blocks in its own order, so
// a block must come out the same whatever was made before it.

const endless = (biome, seed = 5) => new World(makeLevel({ biome, seed, mood: 0, runSeed: 0, index: 0, endless: true }));

/** A full-detail node on the ground beside the line at z */
function nodeAt(world, z, side = 60) {
  const x = world.course.x(z) + side;
  const y = world.land.ground?.height(x, z) ?? world.course.y(z);
  return [x, y, z].map((v) => Math.floor(v / NODE_SIZE));
}

test('an endless line goes on both ways, the same however far it was asked for first', () => {
  const near = endless('verdant');
  const far = endless('verdant');
  far.course.y(40_000);
  far.course.y(-9_000);
  for (const z of [-8_000, -100, 0, 777, 5_000, 39_000]) {
    assert.equal(far.course.y(z), near.course.y(z), `y at ${z}`);
    assert.equal(far.course.distance(10, -50, z), near.course.distance(10, -50, z));
  }
  // It always goes down forwards
  for (let z = -3_000; z < 30_000; z += 500) assert.ok(near.course.y(z + 500) < near.course.y(z), `descends after ${z}`);
  assert.equal(near.course.rings.length, 0);
  assert.equal(near.course.endZ, Infinity);
});

test('gates come a block at a time, never too close where blocks meet, none at the start', () => {
  const world = endless('verdant');
  const gates = [];
  for (let b = -3; b < 12; b++) gates.push(...world.course.gatesIn(b));
  for (let i = 1; i < gates.length; i++) assert.ok(gates[i] - gates[i - 1] >= 90, `gates ${gates[i - 1]} and ${gates[i]}`);
  assert.ok(!gates.some((z) => z > -120 && z < 90), 'the start is clear');
  assert.deepEqual(endless('verdant').course.gatesIn(7), world.course.gatesIn(7));
});

test('land made in any order meshes the same', () => {
  for (const biome of ['verdant', 'ember', 'glacier', 'lagoon', 'archipelago', 'aurora']) {
    const forward = endless(biome, 3);
    const backward = endless(biome, 3);
    const spots = [300, 2_500, 9_000];
    // One makes its land from the start outwards, the other jumps far ahead first
    const a = spots.map((z) => meshNode(forward, 0, ...nodeAt(forward, z)).positions);
    const b = [...spots].reverse().map((z) => meshNode(backward, 0, ...nodeAt(backward, z)).positions).reverse();
    spots.forEach((z, i) => {
      assert.equal(a[i].length, b[i].length, `${biome}: triangles at ${z}`);
      assert.ok(a[i].every((v, k) => v === b[i][k]), `${biome}: vertices at ${z}`);
    });
    // And the field agrees point by point
    for (const z of [250, 4_100, 8_800]) {
      const x = forward.course.x(z) + 40;
      const y = forward.course.y(z) - 20;
      assert.equal(backward.rock.distance(x, y, z), forward.rock.distance(x, y, z), `${biome}: distance at ${z}`);
    }
  }
});

test('land keeps coming far along the line, with rock shapes in every block', () => {
  const world = endless('ember', 11);
  for (const z of [3_000, 12_000, 25_000]) {
    const positions = meshNode(world, 0, ...nodeAt(world, z, 0)).positions;
    assert.ok(positions.length > 0, `ground under the line at ${z}`);
  }
  const [from, to] = world.made;
  assert.ok(from < 0 && to > 25_000, `made ${from}..${to}`);
  const perBlock = new Map();
  for (const shape of world.land.shapes) {
    const b = Math.floor((shape.min.z + shape.max.z) / 2 / BLOCK);
    perBlock.set(b, (perBlock.get(b) ?? 0) + 1);
  }
  for (let b = 1; b < 24; b++) assert.ok((perBlock.get(b) ?? 0) >= 5, `block ${b}: ${perBlock.get(b) ?? 0} shapes`);
});

test('steps and their river carry on across blocks', () => {
  const world = endless('verdant', 2);
  const steps = world.land.ground.steps;
  for (let b = -2; b < 10; b++) {
    const { pools, falls } = steps.section(b);
    assert.equal(pools[0].z0, b * BLOCK);
    assert.equal(pools.at(-1).z1, (b + 1) * BLOCK);
    for (let i = 1; i < pools.length; i++) assert.equal(pools[i].z0, pools[i - 1].z1);
    // Each fall drops (the line descends), the last into the next block's first pool
    falls.forEach((fall) => assert.ok(fall.bottom < fall.top));
    assert.equal(falls.at(-1).bottom, steps.section(b + 1).pools[0].level);
  }
  // The floor is flat in a pool and only changes at the falls
  const pool = steps.section(4).pools[1];
  assert.equal(steps.level((pool.z0 + pool.z1) / 2), pool.level);
  // And the line always flies over the water
  for (let z = -1_000; z < 9_000; z += 37) assert.ok(world.course.y(z) > steps.pool(z).level + 5, `line over the water at ${z}`);
});

test('the sea follows an endless line', () => {
  const world = endless('lagoon', 4);
  for (const z of [0, 6_000, 20_000]) {
    const sea = world.seaAt(z);
    assert.ok(Math.abs(world.course.y(z) - 24 - sea) < 15, `sea ${sea} under the line ${world.course.y(z)} at ${z}`);
  }
});

test('an endless line plants land around you as you fly, digs it up behind, and loads in a cone ahead', async () => {
  const THREE = await import('three');
  const { LandStreamer } = await import('../src/game/world/terrain/streamer.ts');
  const { LandCollider } = await import('../src/game/world/landCollider.ts');
  const world = endless('verdant', 5);
  const land = new LandStreamer(world, new THREE.Group(), new THREE.MeshBasicMaterial(), null, new LandCollider());
  const asked = [];
  const request = (r) => (asked.push(r), true);
  // Every request comes back at once, empty: this is about which land is wanted, not its meshes
  const answer = () => {
    for (const r of asked.splice(0)) land.receive({ key: r.key, positions: new Float32Array(0), rock: new Uint8Array(0), cover: new Uint8Array(0), snow: new Float32Array(0), plants: new Float32Array(0), tufts: new Float32Array(0) });
  };
  const at = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const fly = (z) => {
    world.course.pointAt(z, at).y += 25;
    world.course.tangentAt(z, velocity).multiplyScalar(45);
    land.update(at, request, velocity);
    answer();
  };
  // What's kept stays about the same however far you fly
  const most = (from, to) => {
    let roots = 0;
    let nodes = 0;
    for (let z = from; z < to; z += 30) {
      fly(z);
      roots = Math.max(roots, land.roots.length);
      nodes = Math.max(nodes, land.byKey.size);
    }
    return { roots, nodes };
  };
  const early = most(0, 6_000);
  const late = most(6_000, 20_000);
  for (let i = 0; i < 4; i++) fly(20_000);
  assert.ok(land.ready, 'the land around you is in');
  assert.ok(late.roots < early.roots * 1.4 && late.nodes < early.nodes * 1.4, `kept ${JSON.stringify(early)} early, ${JSON.stringify(late)} late`);
  assert.ok(land.roots.every((root) => root.box.max.z > 20_000 - 2_600), 'nothing kept from far behind');
  assert.ok(land.roots.some((root) => root.box.min.z > 20_000 + 900), 'land planted ahead');
  // The cone: as far ahead as behind, the land ahead is finer
  const lodAt = (z) => {
    const p = world.course.pointAt(z);
    p.y = world.land.ground.height(p.x, z);
    return land.desired.find((node) => node.box.containsPoint(p))?.lod;
  };
  const ahead = lodAt(20_000 + 520);
  const back = lodAt(20_000 - 520);
  assert.ok(ahead !== undefined && back !== undefined && ahead < back, `ahead lod ${ahead}, behind lod ${back}`);
  // Collisions: unplanted land in the corridor falls back to the field; beyond it there is none
  assert.equal(land.covers(world.course.x(60_000), world.course.y(60_000), 60_000), false);
  assert.equal(land.covers(world.course.x(60_000) + 5_000, world.course.y(60_000), 60_000), true);
  land.dispose();
});

test('Zen has a URL and a map for every seed, never Sky Isles', () => {
  assert.deepEqual(screenFromSearch('?zen=5', true), { kind: 'zen', seed: 5 });
  assert.equal(urlFor({ kind: 'zen', seed: 5 }), '/?zen=5');
  // 16 is Sky Isles' showcase seed: its Zen is the next seed's map
  assert.equal(seedMap(16).biome, 'skyIsles');
  assert.ok(zenSeed(16) > 16 && seedMap(zenSeed(16)).biome !== 'skyIsles');
  assert.equal(zenSeed(5), 5);
  const level = zenLevel(5);
  assert.equal(level.key.endless, true);
  assert.equal(level.biome.id, 'verdant');
});
