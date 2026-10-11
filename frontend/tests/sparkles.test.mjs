import test from "node:test";
import assert from "node:assert/strict";
import { Object3D, Vector3 } from "three";
import { CosmeticSparkles, COSMETIC_SPARKLES } from "../src/game/cosmetics/sparkles.ts";
import { CAPES, HATS, SHOES } from "../src/game/cosmetics/catalog.ts";
import { COSMETIC_FX } from "../src/game/tuning.ts";

function rig() {
  const emitted = [];
  const avatar = { boost: 0, slots: { head: new Object3D() }, feet: [new Object3D(), new Object3D()], capeTip: out => out.set(0, 1, 2) };
  const particles = { budget: 1, emit: (at, velocity, spec) => emitted.push({ at: at.clone(), kind: spec.kind, size: spec.size }) };
  return { avatar, particles, emitted, sparkles: new CosmeticSparkles(avatar, particles) };
}
const look = (cape, hat, shoes) => ({ cape, hat, shoes, wings: "classic", pet: "none" });
const fly = (sparkles, seconds, moving = true) => { for (let t = 0; t < seconds; t += 1 / 60) sparkles.update(1 / 60, new Vector3(0, 0, -40), moving); };

test("every sparkle belongs to a cosmetic in the catalog", () => {
  const ids = { cape: CAPES, hat: HATS, shoes: SHOES };
  for (const key of Object.keys(COSMETIC_SPARKLES)) {
    const [slot, id] = key.split(":");
    assert.ok(ids[slot].some(c => c.id === id), key);
  }
});

test("rare cosmetics shed their particles in flight, plain ones and parked pilots don't", () => {
  const plain = rig();
  plain.sparkles.setAppearance(look("classic", "none", "classic"));
  fly(plain.sparkles, 2);
  assert.equal(plain.emitted.length, 0);

  const rare = rig();
  rare.sparkles.setAppearance(look("aurora", "starwitch", "frost"));
  fly(rare.sparkles, 2, false);
  assert.equal(rare.emitted.length, 0, "nothing while the pilot is held still");
  fly(rare.sparkles, 2);
  // Aurora 14/s, star-witch 8/s, frost 10/s: about 64 in two seconds
  assert.ok(rare.emitted.length > 50 && rare.emitted.length < 80, `${rare.emitted.length} particles`);
  assert.ok(rare.emitted.every(p => Number.isFinite(p.at.x + p.at.y + p.at.z) && p.size > 0));

  const saved = COSMETIC_FX.sparkle;
  COSMETIC_FX.sparkle = 0;
  const off = rare.emitted.length; fly(rare.sparkles, 1);
  assert.equal(rare.emitted.length, off, "the ?tune knob turns them off");
  COSMETIC_FX.sparkle = saved;
});

test("the ember mantle burns brighter while boosting", () => {
  const count = boost => { const r = rig(); r.avatar.boost = boost; r.sparkles.setAppearance(look("ember", "none", "classic")); fly(r.sparkles, 2); return r.emitted.length; };
  assert.ok(count(1) > count(0) * 2);
});
