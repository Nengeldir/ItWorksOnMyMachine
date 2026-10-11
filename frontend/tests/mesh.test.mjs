import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { World } from '../src/game/world/World.ts';
import { makeLevel } from '../src/game/world/biomes/index.ts';
import { meshNode, NODE_SIZE, VOXEL } from '../src/game/world/terrain/mesh.ts';
import { cleanMesh, remapFaces } from '../src/game/world/meshCleanup.ts';
import { LandStreamer } from '../src/game/world/terrain/streamer.ts';
import { LandCollider } from '../src/game/world/landCollider.ts';
import { TERRAIN } from '../src/game/tuning.ts';
import { TerrainField } from '../src/game/world/terrain/field.ts';

function edgesOf(positions) {
  const edges = new Map();
  for (let i = 0; i < positions.length; i += 9) {
    const vertices = [0, 3, 6].map(o => Array.from(positions.slice(i + o, i + o + 3)));
    for (let j = 0; j < 3; j++) {
      const a = vertices[j], b = vertices[(j + 1) % 3];
      const key = [a.join(','), b.join(',')].sort().join('|');
      const edge = edges.get(key) ?? { a, b, count: 0 };
      edge.count++;
      edges.set(key, edge);
    }
  }
  return [...edges.values()];
}

const level = biome => makeLevel({ biome, seed: 2, mood: 0, runSeed: 0, index: 0 });

test('seeded terrain has no open interior edges after cleanup', () => {
  for (const biome of ['glacier', 'verdant', 'ember', 'archipelago', 'lagoon', 'twilight', 'aurora']) {
    for (const seed of [2, 7, 42]) {
      const world = new World(makeLevel({ biome, seed, mood: 0, runSeed: 0, index: 0 }));
      for (const dz of [100, 250, 400, 650, 900]) {
        const z = world.course.start.z + dz, x = world.course.x(z) + 100;
        const y = world.land.ground?.height(x, z) ?? world.course.y(z);
        const cell = [x, y, z].map(v => Math.floor(v / NODE_SIZE));
        const positions = meshNode(world, 0, ...cell).positions;
        assert.ok(positions.every(Number.isFinite));
        const open = edgesOf(positions).filter(e => e.count === 1 && [e.a, e.b].every(v => v.every((x, j) => x > cell[j] * NODE_SIZE + VOXEL && x < (cell[j] + 1) * NODE_SIZE - VOXEL * 2)));
        assert.equal(open.length, 0, `${biome} seed ${seed} at ${cell}: internal holes`);
      }
    }
  }
});

test('hidden terrain reuses geometry, respects its cache budget and rejects stale work', () => {
  const world = new World(level('verdant'));
  const land = new LandStreamer(world, new THREE.Group(), new THREE.MeshBasicMaterial(), null, new LandCollider());
  const saved = TERRAIN.cacheMiB;
  try {
    TERRAIN.cacheMiB = 48;
    const node = land.node(0, 0, 0, 0, null);
    node.desired = land.stamp;
    node.state = 'pending';
    const result = { key: node.key, positions: new Float32Array([0,0,0, 0,0,6, 6,0,0]), rock: new Uint8Array(12), cover: new Uint8Array(12), snow: new Float32Array(3), plants: new Float32Array(), tufts: new Float32Array() };
    land.take(result);
    land.show(node);
    const geometry = node.mesh.geometry;
    land.hide(node);
    assert.equal(node.state, 'loaded');
    land.show(node);
    assert.equal(node.mesh.geometry, geometry);
    assert.equal(land.cacheBytes, 0);
    land.hide(node);
    TERRAIN.cacheMiB = 0;
    land.trimCache();
    assert.equal(node.state, 'idle');
    assert.equal(node.mesh, null);
    node.state = 'pending';
    node.desired = land.stamp - 1;
    land.take(result);
    assert.equal(node.state, 'idle');
    assert.equal(node.mesh, null);
  } finally { TERRAIN.cacheMiB = saved; land.dispose(); }
});

test('LOD hysteresis keeps fine nodes while hovering around the split distance', () => {
  const world = new World(level('verdant'));
  const land = new LandStreamer(world, new THREE.Group(), new THREE.MeshBasicMaterial(), null, new LandCollider());
  const node = land.node(2, 0, 0, 0, null);
  const camera = new THREE.Vector3();
  const old = TERRAIN.lodHysteresis;
  try {
    TERRAIN.lodHysteresis = 48;
    land.visit(node, camera.set(192 + TERRAIN.lodNear - 1, 96, 96));
    assert.equal(node.split, true);
    land.visit(node, camera.set(192 + TERRAIN.lodNear + 20, 96, 96));
    assert.equal(node.split, true);
    land.visit(node, camera.set(192 + TERRAIN.lodNear + 49, 96, 96));
    assert.equal(node.split, false);
  } finally { TERRAIN.lodHysteresis = old; land.dispose(); }
});

test('v2 chunk joins are closed and collision rays hit the same repaired surface', () => {
  const world = new World(level('verdant'));
  const distance = (x, y, z) => Math.hypot(x - NODE_SIZE, y - NODE_SIZE, z - NODE_SIZE) - 18;
  world.land = {
    distance, shapes: [], groundSurface: 0, noise: { n2: () => 0.7 },
    fill(ox, oy, oz, step, n, out) {
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[x + n * (y + n * z)] = distance(ox + x * step, oy + y * step, oz + z * step);
      return true;
    },
  };
  const positions = [];
  const collider = new LandCollider();
  let key = 0;
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
    const mesh = meshNode(world, 0, x, y, z);
    positions.push(...mesh.positions);
    collider.add(key++, mesh.positions, 6);
  }
  assert.ok(edgesOf(new Float32Array(positions)).every(e => e.count === 2));
  const coarse = meshNode(world, 1, 0, 0, 0);
  assert.ok(edgesOf(coarse.positions).every(e => e.count === 2));
  assert.ok(positions.length > coarse.positions.length * 2, 'approaching adds real geometry detail');
  const center = new THREE.Vector3(NODE_SIZE, NODE_SIZE, NODE_SIZE);
  const hit = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
  for (let i = 0; i < 24; i++) {
    const direction = new THREE.Vector3(Math.cos(i * 2.4), Math.sin(i * 1.7), Math.sin(i * 2.4)).normalize();
    assert.ok(collider.segment(center.clone().addScaledVector(direction, 40), center, hit));
    assert.ok(hit.normal.dot(direction) > 0);
    assert.ok(Math.abs(hit.point.distanceTo(center) - 18) < 2);
  }
});

test('fine chunks remain visible until the coarse replacement arrives', () => {
  const world = new World(level('verdant'));
  const group = new THREE.Group();
  const land = new LandStreamer(world, group, new THREE.MeshBasicMaterial(), null, new LandCollider());
  const parent = land.node(1, 0, 0, 0, null);
  const child = land.node(0, 0, 0, 0, parent);
  parent.children = [child];
  land.roots.length = 0;
  land.roots.push(parent);
  const result = node => ({ key: node.key, positions: new Float32Array([0,0,0, 0,0,6, 6,0,0]), rock: new Uint8Array(12), cover: new Uint8Array(12), snow: new Float32Array(3), plants: new Float32Array(), tufts: new Float32Array() });
  try {
    child.desired = land.stamp;
    child.state = 'pending';
    land.take(result(child));
    land.show(child);
    land.stamp++;
    parent.desired = land.stamp;
    parent.state = 'pending';
    land.desired = [parent];
    land.pruneTree(parent, false);
    land.settle();
    assert.equal(child.shown, true);
    land.take(result(parent));
    land.settle();
    assert.equal(parent.shown, true);
    assert.equal(child.shown, false);
    assert.equal(group.children.length, 1);
    assert.ok(land.covers(10, 10, 10));
    // Split back without worker work: the child is retained in the cache.
    land.stamp++;
    child.desired = land.stamp;
    land.desired = [child];
    land.settle();
    assert.equal(child.shown, true);
    assert.equal(parent.shown, false);
    assert.equal(group.children.length, 1);
  } finally { land.dispose(); }
});

function octahedron(center, radii) {
  const v = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(p => p.map((x, a) => center[a] + x * radii[a]));
  const f = [[0,2,4],[4,2,1],[1,2,5],[5,2,0],[0,4,3],[4,1,3],[1,5,3],[5,0,3]];
  return new Float32Array(f.flatMap(t => t.flatMap(i => v[i])));
}

test('compact floating stones gain facets without moving their bounds or opening holes', () => {
  const input = octahedron([48,48,48], [3,4,3]);
  const result = cleanMesh(input, [0,0,0], 96, 6);
  assert.equal(result.positions.length, input.length * 4);
  assert.ok(edgesOf(result.positions).every(e => e.count === 2));
  for (let a = 0; a < 3; a++) {
    const before = input.filter((_, i) => i % 3 === a), after = result.positions.filter((_, i) => i % 3 === a);
    assert.equal(Math.min(...after), Math.min(...before));
    assert.equal(Math.max(...after), Math.max(...before));
  }
  const paint = Uint8Array.from({length: 8 * 12}, (_, i) => Math.floor(i / 12) * 20);
  const remapped = remapFaces(paint, result.sources, 12);
  result.sources.forEach((source, i) => assert.deepEqual(remapped.slice(i * 12, (i + 1) * 12), paint.slice(source * 12, (source + 1) * 12)));
  const coarse = cleanMesh(input, [0,0,0], 96, 6, false);
  assert.equal(coarse.positions.length, input.length);
});

test('remove closed sheets and hairs but retain solid small stones', () => {
  for (const radii of [[8,0.08,5], [0.08,8,0.08]]) {
    const input = octahedron([30,30,30], radii);
    assert.equal(cleanMesh(input, [0,0,0], 96, 6).positions.length, 0);
  }
  assert.ok(cleanMesh(octahedron([30,30,30], [0.8,0.8,0.8]), [0,0,0], 96, 6).positions.length > 0);
});

test('thin fragments in border collars and incomplete shells remain unchanged', () => {
  for (const origin of [[0,0,0], [-96,-96,-96]]) {
    const input = octahedron(origin.map(x => x + 5), [2,0.05,2]);
    const result = cleanMesh(input, origin, 96, 6);
    assert.equal(result.sources.length, input.length / 9);
    result.sources.forEach((source, i) => assert.deepEqual(result.positions.slice(i*9,i*9+9), input.slice(source*9,source*9+9)));
  }
  const input = octahedron([48,48,48], [8,0.08,5]).slice(0, 27);
  const result = cleanMesh(input, [0,0,0], 96, 6);
  assert.equal(result.sources.length, input.length / 9);
  result.sources.forEach((source, i) => assert.deepEqual(result.positions.slice(i*9,i*9+9), input.slice(source*9,source*9+9)));
});

test('attached narrow tip is shortened without losing faces or reversing their winding', () => {
  // A broad body with a very narrow ring around a protruding top vertex.
  const g = new THREE.CylinderGeometry(0.3, 8, 4, 8, 1, false).toNonIndexed();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x + 48, y + 48 + (Math.hypot(x,z) < 0.01 && y > 0 ? 6 : 0), z + 48);
  }
  const input = new Float32Array(p.array), result = cleanMesh(input, [0,0,0], 96, 6, false);
  assert.equal(result.positions.length, input.length);
  assert.ok(Math.max(...result.positions.filter((_, i) => i % 3 === 1)) < 56);
  assert.ok(edgesOf(result.positions).every(e => e.count === 2));
  result.sources.forEach((source, i) => {
    const normal = (p, n) => {
      const a = new THREE.Vector3().fromArray(p,n), b = new THREE.Vector3().fromArray(p,n+3), c = new THREE.Vector3().fromArray(p,n+6);
      return b.sub(a).cross(c.sub(a));
    };
    assert.ok(normal(input,source*9).dot(normal(result.positions,i*9)) > 0);
  });
  g.dispose();
});

test('terrain glow stays within the biome strength at every detail level', () => {
  const world = new World(level('ember'));
  const maximum = Math.round(Math.max(...world.biome.terrain.surfaces.map(s => s.glow ?? 0)) * 255);
  for (const lod of [0, 1, 2, 3]) {
    const z = world.course.start.z + 400, x = world.course.x(z) + 100;
    const y = world.land.ground.height(x, z), size = NODE_SIZE << lod;
    const mesh = meshNode(world, lod, ...[x,y,z].map(v => Math.floor(v / size)));
    assert.ok(mesh.rock.length > 0);
    const glow = mesh.rock.filter((_, i) => i % 4 === 3);
    assert.ok(glow.some(v => v > 0));
    assert.ok(glow.every(v => v <= maximum), `LOD ${lod}: a face must not amplify faint cracks to full emission`);
  }
});


test('mountain roughness cannot create rock far above peaks or air deep inside them', () => {
  for (const biome of ['ember', 'glacier', 'verdant']) {
    const world = new World(level(biome));
    // Isolate the ground; intentionally floating shape primitives are allowed.
    const field = new TerrainField(world.course, world.land.ground, world.land.groundSurface, world.land.noise);
    for (let z = 0; z <= 900; z += 30) for (let lateral = 350; lateral <= 1000; lateral += 25) {
      const x = world.course.x(z) + lateral, h = field.ground.height(x, z);
      for (let rise = 24; rise <= 240; rise += 12) {
        assert.ok(field.distance(x, h + rise, z) > 0, `${biome}: floating ground at ${x}, ${h + rise}, ${z}`);
        assert.ok(field.distance(x, h - rise, z) < 0, `${biome}: hole deep inside mountain`);
      }
    }
  }
});

test('block and point sampling agree on steep mountain slopes at every LOD', () => {
  const world = new World(level('ember'));
  for (const step of [3, 6, 12, 24]) {
    const n = 8, out = new Float32Array(n ** 3);
    const [ox, oz] = [528, 120];
    const oy = Math.floor(world.land.ground.height(ox, oz) / step) * step;
    assert.ok(world.land.fill(ox, oy, oz, step, n, out));
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      assert.equal(out[x+n*(y+n*z)], Math.fround(world.land.distance(ox+x*step,oy+y*step,oz+z*step)));
    }
  }
});

test('finest detail follows approaches to side mountains with bounded speed look-ahead', () => {
  const world = new World(level('ember'));
  const land = new LandStreamer(world, new THREE.Group(), new THREE.MeshBasicMaterial(), null, new LandCollider());
  try {
    const node = land.node(1, 10, 3, 2, null); // 960 m sideways, far off the racing line
    const at = new THREE.Vector3(node.box.min.x - 250, node.box.min.y + 48, node.box.min.z + 48);
    land.visit(node, at);
    assert.equal(node.split, false, 'stationary, outside the close-detail zone');
    land.update(at, () => false, new THREE.Vector3(100, 0, 0));
    land.visit(node, at);
    assert.equal(node.split, true, 'approaching side mountain loads finest detail ahead');
    assert.equal(land.lookAhead.distanceTo(at), 200);
    land.update(at, () => false, new THREE.Vector3(300, 0, 0));
    assert.equal(land.lookAhead.distanceTo(at), TERRAIN.lodLookAheadMax);
    land.update(at, () => false, new THREE.Vector3(-100, 0, 0));
    land.visit(node, at);
    assert.equal(node.split, false, 'turning away updates detail requests without moving the camera');
    at.x = node.box.min.x - 100;
    land.update(at, () => false);
    land.visit(node, at);
    assert.equal(node.split, true, 'nearby terrain stays detailed even without forward prediction');
  } finally { land.dispose(); }
});


test('crystal optical shading is tagged only on crystal surfaces through meshing', () => {
  const world = new World(level('aurora'));
  world.land = {
    shapes: [], groundSurface: 1, noise: { n2: () => 0.7 },
    fill(ox, oy, oz, step, n, out) {
      for (let z=0; z<n; z++) for (let y=0; y<n; y++) for (let x=0; x<n; x++)
        out[x+n*(y+n*z)] = Math.hypot(ox+x*step-24, oy+y*step-24, oz+z*step-24)-10;
      return true;
    },
  };
  const crystal = meshNode(world, 0, 0, 0, 0);
  assert.ok(crystal.positions.length > 0);
  assert.equal(crystal.crystal.length, crystal.positions.length / 3);
  assert.ok(crystal.crystal.every(v => v === 255));
  assert.ok(edgesOf(crystal.positions).every(e => e.count === 2));
  world.land.groundSurface = 0;
  const stone = meshNode(world, 0, 0, 0, 0);
  assert.ok(stone.crystal.every(v => v === 0));
  assert.deepEqual(crystal.positions, stone.positions, 'optics must not change geometry');
});


test('LOD replacements do not interrupt flight, but genuinely missing terrain does', () => {
  const world = new World(level('verdant'));
  const land = new LandStreamer(world, new THREE.Group(), new THREE.MeshBasicMaterial(), null, new LandCollider());
  const parent = land.node(1, 0, 0, 0, null);
  const child = land.node(0, 0, 0, 0, parent);
  parent.children = [child];
  const at = new THREE.Vector3(10, 10, 10);
  // Hold selection steady to exercise readiness independently of LOD selection.
  land.stamp = 1;
  land.lastUpdate.copy(at);
  land.lastLookAhead.copy(at);
  try {
    land.desired = [child];
    parent.shown = true;
    land.update(at, () => false);
    assert.equal(land.ready, true, 'coarse coverage supports detail upgrades');
    parent.shown = false;
    land.update(at, () => false);
    assert.equal(land.ready, false, 'uncovered terrain still requires loading');
    child.shown = true;
    land.desired = [parent];
    land.update(at, () => false);
    assert.equal(land.ready, true, 'fine coverage supports a pending coarse replacement');
    const missing = land.node(0, 1, 0, 0, parent);
    parent.children.push(missing);
    land.update(at, () => false);
    assert.equal(land.ready, false, 'partial coverage is insufficient');
  } finally { land.dispose(); }
});
