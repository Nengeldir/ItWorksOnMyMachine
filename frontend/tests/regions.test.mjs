import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EDGE, latticeHash, regionAt, regionWeights, warp } from "../src/game/reaches/regions.ts";
import { HUB, REGIONS, REGION_BORDERS } from "../src/catalog.ts";

// The region map (plan R1). backend/tests/test_regions.py runs the same vectors against backend/regions.py.
const vectors = JSON.parse(readFileSync(new URL("../../shared/catalog/tests/region-vectors.json", import.meta.url), "utf8"));

test("the shared vectors, to the last bit", () => {
  for (const { ix, iz, stream, value } of vectors.hashes) assert.equal(latticeHash(ix, iz, stream), value);
  for (const c of vectors.cases) {
    assert.deepEqual(warp(c.x, c.z), c.warp);
    const w = regionWeights(c.x, c.z);
    assert.deepEqual([w.places, w.weights, w.border], [c.places, c.weights, c.border], `${c.x},${c.z}`);
  }
});

test("weights sum to 1, most first, and every place owns its middle", () => {
  for (let x = -7000; x <= 7000; x += 350) {
    for (let z = -7000; z <= 7000; z += 350) {
      const w = regionWeights(x, z);
      assert.ok(Math.abs(w.weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
      for (let i = 1; i < w.weights.length; i++) assert.ok(w.weights[i - 1] >= w.weights[i]);
      assert.equal(w.a, w.places[0]);
    }
  }
  assert.equal(regionAt(...HUB.center), HUB.id);
  for (const region of REGIONS.filter((r) => r.layer === "surface")) assert.equal(regionAt(...region.center), region.id);
  // The Hollow Deeps lie under the surface: never on the surface map
  assert.ok(!REGIONS.filter((r) => r.layer === "deep").some((r) => regionAt(...r.center) === r.id));
  assert.equal(regionAt(9000, 0), EDGE);
});

test("borders blend smoothly: no seams anywhere in the world", () => {
  const step = 9;
  let worst = 0;
  for (let x = -6600; x <= 6600; x += 61) {
    let previous = null;
    for (let z = -6600; z <= 6600; z += step) {
      const w = regionWeights(x, z);
      const now = new Map(w.places.map((place, i) => [place, w.weights[i]]));
      if (previous) for (const place of new Set([...now.keys(), ...previous.keys()])) worst = Math.max(worst, Math.abs((now.get(place) ?? 0) - (previous.get(place) ?? 0)));
      previous = now;
    }
  }
  assert.ok(worst < 0.15, `a weight jumped ${worst.toFixed(3)} over ${step} m`);
  // Shared over the band, owned beyond it
  const deep = regionWeights(...REGIONS[0].center);
  assert.equal(deep.weights.length, 1);
  assert.ok(REGION_BORDERS.band >= 200, "borders are wide enough to blend");
});

const { Discovery, FOUND_SHARE } = await import("../src/game/reaches/discovery.ts");
const { paintMap, worldToMap, mapToWorld } = await import("../src/game/reaches/mapPaint.ts");

test("a place is found once, only where it owns the land, and listeners hear of it", () => {
  const discovery = new Discovery(null);
  let heard = 0;
  discovery.subscribe(() => heard++);
  const meadow = REGIONS.find((r) => r.id === "meadow_rise");
  assert.equal(discovery.visit(...meadow.center), "meadow_rise");
  assert.equal(discovery.visit(...meadow.center), null, "found only once");
  assert.equal(discovery.visit(9000, 0), null, "the open sky past the edge is no place");
  // On a border neither side is found
  let blended = null;
  for (let x = 0; x < 3000 && !blended; x += 5) {
    const w = regionWeights(x, -3500);
    if (w.wa < FOUND_SHARE && w.a !== "lanternhaven" && !discovery.has(w.a)) blended = [x, -3500];
  }
  assert.ok(blended, "a border point to try");
  assert.equal(discovery.visit(...blended), null);
  assert.equal(heard, 1);
  assert.deepEqual(discovery.places, ["meadow_rise"]);
});

test("the painted map: found places clear, the rest under cloud, the same every time", () => {
  const size = 48;
  const meadow = REGIONS.find((r) => r.id === "meadow_rise");
  const [px, py] = worldToMap(...meadow.center, size).map(Math.floor);
  const [x, z] = mapToWorld(px, py, size);
  assert.ok(Math.abs(x - meadow.center[0]) < 600 && Math.abs(z - meadow.center[1]) < 600, "map and world agree");
  const hidden = paintMap(size, new Set());
  const shown = paintMap(size, new Set(["meadow_rise"]));
  assert.equal(hidden.length, size * size * 4);
  const at = (pixels) => { const o = (py * size + px) * 4; return pixels[o] + pixels[o + 1] + pixels[o + 2]; };
  assert.ok(at(hidden) > at(shown) + 30, "cloud is paler than the wash under it");
  assert.deepEqual(paintMap(size, new Set(["meadow_rise"])), shown);
  for (let i = 3; i < shown.length; i += 4) assert.equal(shown[i], 255);
});
