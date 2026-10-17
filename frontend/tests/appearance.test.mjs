import test from "node:test";
import assert from "node:assert/strict";
import { CAPES, HATS, JARS, SHOES, WINGS } from "../src/game/cosmetics/catalog.ts";
import { PETS } from "../src/game/pets/catalog.ts";
import { buildHat, buildShoe, disposeModel } from "../src/game/cosmetics/models.ts";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, loadAppearance, saveAppearance, validateAppearance } from "../src/game/cosmetics/storage.ts";

test("appearance rejects stale or malformed ids per slot without discarding valid slots", () => {
  for (const value of [null, undefined, 42, "bad", [], { cape: "missing", hat: 2, shoes: {}, pet: "old", jar: "pickle" }]) {
    assert.deepEqual(validateAppearance(value), DEFAULT_APPEARANCE);
  }
  assert.deepEqual(validateAppearance({ cape: "aurora", hat: "lotus", shoes: "missing", pet: "dragon" }), { cape: "aurora", hat: "lotus", shoes: "classic", wings: "classic", pet: "dragon", jar: "none" });
  assert.equal(validateAppearance({ jar: "portal" }).jar, "portal");
  for (const catalog of [CAPES, HATS, SHOES, WINGS, PETS, JARS]) assert.equal(new Set(catalog.map(c => c.id)).size, catalog.length);
});

test("selection round-trips independently of settings and survives unavailable storage", () => {
  const originalStorage = globalThis.localStorage, originalWindow = globalThis.window;
  const data = new Map([["wingrace.settings", "leave me alone"]]); let updates = 0;
  globalThis.window = { dispatchEvent: () => updates++ };
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  try {
    const look = { cape: "verdant", hat: "antlers", shoes: "cloud", wings: "astral", pet: "fox", jar: "fireflies" };
    saveAppearance(look); assert.deepEqual(loadAppearance(), look);
    assert.equal(data.get("wingrace.settings"), "leave me alone"); assert.equal(updates, 1);
    const copy = loadAppearance(); copy.cape = "classic"; assert.deepEqual(loadAppearance(), look);
    data.set(APPEARANCE_KEY, "broken json"); assert.doesNotThrow(loadAppearance);
    globalThis.localStorage = { getItem: () => { throw Error("disabled"); }, setItem: () => { throw Error("disabled"); } };
    saveAppearance({ ...look, cape: "ember" }); assert.equal(loadAppearance().cape, "ember");
  } finally { globalThis.localStorage = originalStorage; globalThis.window = originalWindow; }
});

export function checkModel(group, limit = 16000) {
  let vertices = 0; const seen = new Set();
  group.traverse(o => {
    if (!o.isMesh || seen.has(o.geometry)) return;
    const g = o.geometry; seen.add(g); const p = g.getAttribute("position"); vertices += p.count;
    assert.equal(g.getAttribute("color").count, p.count); assert.equal(g.getAttribute("glow").count, p.count);
    for (const name of ["position", "normal", "color", "glow"]) assert.ok(g.getAttribute(name).array.every(Number.isFinite), `${group.name}: ${name}`);
    g.computeBoundingSphere(); assert.ok(g.boundingSphere.radius > 0 && Number.isFinite(g.boundingSphere.radius));
  });
  assert.ok(vertices > 0 && vertices < limit, `${group.name}: ${vertices} vertices`);
  let disposals = 0; seen.forEach(g => g.addEventListener("dispose", () => disposals++));
  disposeModel(group); assert.equal(disposals, seen.size); assert.equal(group.parent, null);
}

test("every hat and mirrored shoe has finite painted geometry and disposes each geometry once", () => {
  for (const hat of HATS) if (hat.id !== "none") checkModel(buildHat(hat.id));
  for (const shoe of SHOES) if (shoe.id !== "classic") for (const side of [-1, 1]) checkModel(buildShoe(shoe.id, side));
});
