import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Flight, plainMods } from "../src/game/flight.ts";
import { Charm, ROCKET } from "../src/game/run/charm.ts";
import { Items, RUN_ITEMS, itemLevel, itemsFor } from "../src/game/run/items.ts";
import { ORB, Orbs, orbRestore, placeOrbs } from "../src/game/run/orbs.ts";
import { UPGRADES, offer, upgradeLevel } from "../src/game/run/upgrades.ts";
import { POWERS, charmOf, perksFor, powerOf } from "../src/game/collection/abilities.ts";
import { RARITY_STYLE } from "../src/game/collection/rarity.ts";
import { Course } from "../src/game/world/course.ts";
import { World } from "../src/game/world/World.ts";
import { runLevel, levelId } from "../src/game/world/biomes/index.ts";
import { placeCollection } from "../src/game/run/collection.ts";

const flight = (speed = 40) => { const f = new Flight(); f.reset(new Vector3(0, 50, 0), new Vector3(0, 0, -1), speed); return f; };
const items = () => { const i = new Items(); i.setLevel({ seed: 7, course: new Course(7), distance: () => 100 }); return i; };
const look = (extra = {}) => ({ cape: "classic", hat: "none", shoes: "classic", wings: "classic", pet: "none", charm: "none", ...extra });

test("every pet, every rare or legendary cosmetic and every keepsake has a power; commoner cosmetics are looks only", () => {
  const keys = new Set(POWERS.map((p) => p.key));
  for (const pet of ["swallow", "owl", "crane", "phoenix", "dragon", "kirin", "fox", "griffin"]) assert.ok(keys.has(`pet:${pet}`), pet);
  for (const key of ["cape:aurora", "cape:royal", "cape:ember", "hat:wingedHelm", "hat:starwitch", "shoes:frost", "shoes:ember", "wings:frost", "wings:ember", "wings:storm", "wings:astral"]) assert.ok(keys.has(key), key);
  for (const key of ["cape:dawn", "hat:lotus", "wings:prism", "shoes:petal"]) assert.equal(powerOf(key), null, key);
  for (const item of RUN_ITEMS) if (item.id !== "cometFirework") assert.ok(powerOf(`item:${item.id}`)?.charm, item.id);
  for (const id of ["firework", "goldenFeather", "apple", "starCandy"]) assert.ok(powerOf(`item:${id}`)?.charm, id);
  assert.ok(POWERS.every((p) => p.description.length > 20 && p.voice));
});

test("powers add up: multipliers multiply, the rest adds, and legendary ones are stronger", () => {
  const plain = perksFor(look());
  assert.equal(plain.drag, 1); assert.equal(plain.lives, 0);
  const geared = perksFor(look({ pet: "kirin", cape: "ember", wings: "astral", charm: "goldenFeather" }));
  assert.equal(geared.lives, 2);
  assert.equal(geared.gatePoints, 1.5);
  assert.ok(geared.boostAccel >= 0.2 && geared.orbs > 1 && geared.magnet === 3);
  // The swallow (uncommon) helps less than the dragon (legendary)
  assert.ok(perksFor(look({ pet: "swallow" })).drag > 0.9);
  assert.ok(perksFor(look({ pet: "dragon" })).gateRefill >= 0.2);
});

test("food charms are once per level, relic charms use their item's charges, passive ones never press", () => {
  const f = flight(), bag = items(), charm = new Charm();
  const apple = charmOf(look({ charm: "apple" }));
  charm.set(apple.id, apple.power);
  f.boostCharge = 0.1; assert.ok(charm.press(f, bag)); assert.ok(f.boostCharge > 0.55);
  assert.equal(charm.press(f, bag), false); charm.newLevel(); assert.ok(charm.press(f, bag));
  const boots = charmOf(look({ charm: "aeroBoots" }));
  charm.set(boots.id, boots.power);
  assert.equal(charm.left, 3); assert.ok(charm.press(f, bag)); assert.ok(bag.time("aeroBoots") >= 0); assert.equal(bag.bag.length, 0, "the bag is untouched");
  const feather = charmOf(look({ charm: "goldenFeather" }));
  charm.set(feather.id, feather.power);
  assert.equal(charm.ready, false); assert.equal(charm.press(f, bag), false); assert.equal(charm.hud().state, "passive");
});

test("the giant firework straps on, lights after its swing, pushes until it is taken off", () => {
  const f = flight(40), bag = items(), charm = new Charm();
  const rocket = charmOf(look({ charm: "firework" }));
  charm.set(rocket.id, rocket.power);
  assert.ok(charm.press(f, bag)); assert.equal(charm.rocket, "strapping");
  const push = (seconds) => { let m; for (let i = 0; i < seconds * 120; i++) { m = plainMods(); charm.step(1 / 120, f, m); } return m; };
  assert.equal(push(ROCKET.strap * 0.9).thrust, 0, "no push while it is still being strapped on");
  const burning = push(1);
  assert.equal(charm.rocket, "burning"); assert.ok(burning.thrust > 8 && burning.turn < 1);
  charm.newLevel(); assert.equal(charm.rocket, "burning", "it keeps burning into the next level");
  f.speed = ROCKET.top + 1; assert.equal(push(0.1).thrust, 0, "fades out at its top speed");
  assert.ok(charm.press(f, bag)); assert.equal(charm.rocket, "off"); assert.equal(push(0.2).thrust, 0);
});

test("strong items and abilities wait for experienced pilots; test mode opens everything", () => {
  const legendary = RUN_ITEMS.filter((i) => i.rarity === 3);
  assert.ok(legendary.every((i) => itemLevel(i) >= 6));
  assert.ok(itemsFor(1).every((i) => itemLevel(i) <= 1) && itemsFor(1).length >= 10);
  assert.equal(itemsFor(Infinity).length, RUN_ITEMS.length);
  for (let level = 1; level <= 8; level++) {
    for (const u of offer(42, level, [], 1)) assert.ok(upgradeLevel(u) <= 1, u.id);
  }
  const all = new Set(); for (let seed = 1; seed < 80; seed++) for (const u of offer(seed, 1, [], Infinity)) all.add(u.id);
  assert.ok([...all].some((id) => upgradeLevel(UPGRADES.find((u) => u.id === id)) > 4), "high-level abilities do turn up for high levels");
});

test("stamina orbs: fewer and weaker on deeper levels, collected once by a swept pass", () => {
  assert.ok(orbRestore(1) > orbRestore(4) && orbRestore(4) > orbRestore(8));
  assert.ok(orbRestore(8) >= ORB.least);
  const world = new World(runLevel(7, 1, "verdant"));
  const shallow = placeOrbs(world, 1).length, deep = placeOrbs(world, 8).length;
  assert.ok(shallow > deep && deep > 5, `${shallow} > ${deep}`);
  for (const orb of placeOrbs(world, 1)) {
    assert.ok(world.distance(orb.position.x, orb.position.y, orb.position.z) >= 3);
    assert.ok(world.course.rings.every((r) => Math.abs(r.position.z - orb.position.z) >= ORB.hoopGap - 1e-6));
  }
  const orbs = new Orbs(); orbs.setLevel(world, 3);
  const f = flight(); const target = orbs.orbs[0].position;
  f.position.copy(target).add(new Vector3(0, 0, -30)); orbs.step(f); f.boostCharge = 0;
  f.position.copy(target).add(new Vector3(0, 0, 30)); // a fast pass straight through it in one step
  assert.ok(Math.abs(orbs.step(f) - orbRestore(3)) < 1e-9); assert.ok(f.boostCharge > 0);
  f.position.copy(target).add(new Vector3(0, 0, -30)); assert.equal(orbs.step(f), 0, "taken once");
  orbs.dispose();
});

test("in a run the boost never recharges by itself (but a plain flight does)", () => {
  const plain = flight(); plain.boostCharge = 0.3;
  for (let i = 0; i < 240; i++) plain.step(1 / 120, { pitch: 0, roll: 0 }, 0);
  assert.ok(plain.boostCharge > 0.3);
  const run = flight(); run.boostCharge = 0.3; const mods = plainMods(); mods.recharge = 0;
  for (let i = 0; i < 240; i++) run.step(1 / 120, { pitch: 0, roll: 0 }, 0, undefined, mods);
  assert.equal(run.boostCharge, 0.3);
});

test("deeper levels bend sharper and rise and fall more; level 1 (and every race) is the unchanged map", () => {
  const plain = new Course(42), first = new Course(42, 0);
  for (let z = 0; z < plain.endZ; z += 50) assert.ok(plain.pointAt(z).equals(first.pointAt(z)));
  const turn = (c) => { let most = 0; for (let z = 20; z < c.endZ - 20; z += 4) most = Math.max(most, c.tangentAt(z - 10).angleTo(c.tangentAt(z + 10))); return most; };
  const drop = (c) => { let most = 0; for (let z = 0; z < c.endZ; z += 4) most = Math.max(most, Math.abs(c.y(z + 4) - c.y(z)) / 4); return most; };
  let sharper = 0, steeper = 0;
  for (const seed of [1, 7, 42, 99]) {
    const easy = new Course(seed, 0), hard = new Course(seed, 1);
    if (turn(hard) > turn(easy) * 1.4) sharper++;
    if (drop(hard) > drop(easy) * 1.3) steeper++;
    assert.ok(hard.rings.length >= easy.rings.length && hard.rings[0].radius < easy.rings[0].radius);
  }
  assert.ok(sharper >= 3 && steeper >= 3, `${sharper} ${steeper}`);
  // Each run level is its own map in the workers' caches
  assert.notEqual(levelId(runLevel(7, 1, "verdant").key), levelId(runLevel(7, 8, "verdant").key));
});

test("crystals sit along the line between the hoops, never right at one", () => {
  const world = new World(runLevel(7, 1, "verdant"));
  const rewards = Array.from({ length: 18 }, (_, i) => ({ id: `1:c${i}`, kind: "crystal", key: "crystal", rarity: "common", anchor: (i + 0.5) / 18, angle: i * 1.3 }));
  const placed = placeCollection(world, rewards);
  assert.ok(placed.length >= 14, `${placed.length} placed`);
  for (const p of placed) {
    assert.ok(world.course.rings.every((r) => Math.abs(r.position.z - p.position.z) >= 16 - 1e-6));
    assert.ok(world.course.distance(p.position.x, p.position.y, p.position.z) <= 5.5);
  }
});

test("one rarity palette: common carries no tint, the others their own colors", () => {
  assert.equal(RARITY_STYLE.common.tinted, false);
  assert.deepEqual(["uncommon", "rare", "legendary"].map((r) => RARITY_STYLE[r].tinted), [true, true, true]);
  assert.equal(new Set(Object.values(RARITY_STYLE).map((s) => s.color)).size, 4);
});
