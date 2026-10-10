import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Flight, FLIGHT, plainMods } from "../src/game/flight.ts";
import { ABILITY, Abilities, laneAt } from "../src/game/run/abilities.ts";
import { statsFor, baseStats, UPGRADES } from "../src/game/run/upgrades.ts";
import { Course, TUBE_RADIUS } from "../src/game/world/course.ts";

const STEP = 1 / 120;
const make = (speed = 40, direction = new Vector3(0, 0, -1)) => { const f = new Flight(); f.reset(new Vector3(), direction, speed); return f; };
const fly = (f, seconds, input = {}, mods = null) => {
  for (let i = 0; i < seconds * 120; i++) f.step(STEP, { pitch: 0, roll: 0, ...input }, 0, FLIGHT, mods);
};
/** Abilities on a real course, with these upgrades */
const withAbilities = (ids, seed = 7) => {
  const course = new Course(seed);
  const a = new Abilities();
  a.setStats(statsFor(ids));
  a.setLevel({ course, seed });
  return { a, course };
};
/** One controller step: base mods, then the abilities' */
const stepAbilities = (a, f, proximity = 0, input = { pitch: 0, roll: 0 }) => {
  const mods = plainMods();
  a.step(STEP, input, proximity, f, mods);
  return mods;
};

test("the design list's ten abilities are upgrades, and the old Featherfall and Featherweight are gone", () => {
  const ids = UPGRADES.map((u) => u.id);
  for (const id of ["featherfalling", "skimBooster", "cloudSurf", "plunge", "windShear", "thermalVision", "slipstream", "galeForce", "acrobatic", "hoverStall"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("hover") && !ids.includes("featherweight"));
  const feather = statsFor(["featherfalling", "featherfalling"]);
  assert.ok(Math.abs(feather.sink - 0.55 ** 2) < 1e-9 && feather.stall < 1 && feather.drag < 1);
  assert.equal(baseStats().plunge, 0);
});

test("the new flight mods do nothing at their defaults, and thrust pushes along the path", () => {
  const plain = make(), modded = make(), pushed = make();
  fly(plain, 2); fly(modded, 2, {}, plainMods());
  assert.ok(plain.position.distanceTo(modded.position) < 1e-8);
  fly(pushed, 2, {}, { ...plainMods(), thrust: 10 });
  assert.ok(pushed.speed > plain.speed + 15);
});

test("a plunge hauls the nose down to the dive angle, steering still works", () => {
  const f = make(45);
  const mods = { ...plainMods(), dive: 1, diveAngle: (ABILITY.plungeAngle * Math.PI) / 180 };
  fly(f, 1, { roll: 0.3 }, mods);
  const angle = (Math.asin(f.forward.y) * 180) / Math.PI;
  assert.ok(Math.abs(angle + ABILITY.plungeAngle) < 4, `dive angle ${angle}`);
  assert.ok(Math.abs(f.bank) > 0.1);
});

test("hover-stall: the pilot stops, turns on the spot, and launches off where it looks", () => {
  const { a } = withAbilities(["hoverStall"]);
  const f = make(50);
  assert.ok(a.press("hover", f));
  const start = f.position.clone();
  let moved = 0;
  for (let i = 0; i < 1.5 * 120; i++) {
    const before = f.position.clone();
    const input = { pitch: 0, roll: i < 72 ? 1 : 0 };
    f.step(STEP, input, 0, FLIGHT, stepAbilities(a, f, 0, input));
    if (i > 60) moved += f.position.distanceTo(before);
  }
  assert.ok(f.speed < 1, `speed ${f.speed}`);
  assert.ok(moved < 0.5, `drifted ${moved} m while hanging`);
  assert.ok(f.position.distanceTo(start) < 12);
  // Turned right on the spot: the nose swung towards +x
  assert.ok(f.forward.x > 0.5, `heading ${f.forward.x}`);
  for (let i = 0; i < 0.6 * 120; i++) f.step(STEP, { pitch: 0, roll: 0 }, 0, FLIGHT, stepAbilities(a, f));
  assert.equal(a.hang, -1);
  assert.ok(f.speed >= ABILITY.hangMinLaunch - 1 && f.velocity.x > 20);
  assert.ok(!a.press("hover", f), "cooling down");
});

test("Wind-Shear Dash turns the dodge into a longer, quicker blink", () => {
  const { a } = withAbilities(["windShear"]);
  const plain = make(), blink = make();
  const p = a.dodgeParams();
  assert.equal(p.dodgeDistance, ABILITY.shearDistance);
  plain.dodge(1); blink.dodge(1, p);
  fly(plain, 0.2); fly(blink, 0.2);
  assert.ok(Math.abs(blink.position.x - ABILITY.shearDistance) < 0.01, `blink moved ${blink.position.x}`);
  assert.ok(plain.position.x < 3);
  assert.equal(withAbilities([]).a.dodgeParams(), FLIGHT);
});

test("Skim-Booster refills the boost only while skimming", () => {
  const { a } = withAbilities(["skimBooster"]);
  const f = make();
  f.boostCharge = 0.2;
  for (let i = 0; i < 120; i++) stepAbilities(a, f, 0);
  assert.equal(f.boostCharge, 0.2);
  for (let i = 0; i < 120; i++) stepAbilities(a, f, 1);
  assert.ok(f.boostCharge > 0.55);
});

test("Gale Force charges from gates, widens the gates in its tunnel and pushes inside it", () => {
  const { a, course } = withAbilities(["galeForce"]);
  const f = make(40);
  f.reset(course.pointAt(60), course.tangentAt(60), 40);
  assert.ok(!a.press("burst", f), "half charged at first");
  a.gate(0, 1); a.gate(1, 1);
  assert.ok(a.press("burst", f));
  assert.ok(a.widened.size >= 1, "the gate ahead is in the tunnel");
  const ring = course.rings[[...a.widened][0]];
  assert.equal(a.widening(ring), ABILITY.burstWiden);
  assert.ok(stepAbilities(a, f).thrust > 10);
});

test("a plunge through a gate is a strike: bonus points times the chain", () => {
  const { a } = withAbilities(["plunge"]);
  const f = make();
  assert.equal(a.gate(3, 2), 0);
  assert.ok(a.press("plunge", f));
  assert.ok(stepAbilities(a, f).dive > 0);
  assert.equal(a.gate(4, 3), ABILITY.plungeBonus * 3);
  assert.equal(a.plunge, -1);
});

test("Acrobatic Recovery saves a clipped wing, never the body, then recharges", () => {
  const { a } = withAbilities(["acrobatic"]);
  assert.ok(!a.canRecover("body") && a.canRecover("left"));
  a.recovered(new Vector3(), new Vector3(1, 0, 0));
  assert.ok(!a.canRecover("right"));
  const f = make();
  for (let i = 0; i < (ABILITY.recoverCooldown + 0.1) * 120; i++) stepAbilities(a, f);
  assert.ok(a.canRecover("right"));
  assert.ok(!withAbilities([]).a.canRecover("left"));
  // The glance: out of the wall and no longer flying into it
  const g = make(40, new Vector3(1, 0, -1).normalize());
  g.deflect(new Vector3(-1, 0, 0), 0.8, 0.9);
  assert.ok(g.velocity.x <= 0.01 && g.position.x < 0 && Math.abs(g.speed - 36) < 1e-6);
});

test("cloud lanes lie just under the racing line, inside its tube, and surfing them pushes and refills", () => {
  const { a, course } = withAbilities(["cloudSurf"]);
  assert.ok(a.lanes.length >= 2);
  const top = new Vector3();
  for (const lane of a.lanes) {
    for (let z = lane.z0; z < lane.z1; z += 10) {
      laneAt(course, lane, z, top);
      const line = course.pointAt(z);
      assert.ok(line.y - top.y > 3 && line.y - top.y < 8);
      assert.ok(course.distance(top.x, top.y, top.z) < TUBE_RADIUS - 3, "the lane's middle is well inside the tube");
    }
  }
  const lane = a.lanes[0];
  const z = (lane.z0 + lane.z1) / 2;
  const f = make(35);
  f.reset(laneAt(course, lane, z, top).add(new Vector3(0, 2, 0)), course.tangentAt(z), 35);
  f.boostCharge = 0.5;
  let mods;
  for (let i = 0; i < 60; i++) mods = stepAbilities(a, f);
  assert.ok(a.surf > 0.9 && mods.thrust > 3 && f.boostCharge > 0.55 && a.restore > 0);
});

test("the spirit manta keeps ahead along the line, and its wake pulls you", () => {
  const { a, course } = withAbilities(["slipstream"]);
  const f = make(40);
  f.reset(course.pointAt(200), course.tangentAt(200), 40);
  stepAbilities(a, f);
  assert.ok(a.manta.active && a.manta.z > 250);
  // Right behind it, flying its way
  const m = a.manta;
  f.reset(m.position.clone().addScaledVector(m.tangent, -10), m.tangent, 40);
  let mods;
  for (let i = 0; i < 60; i++) {
    mods = stepAbilities(a, f);
    f.step(STEP, { pitch: 0, roll: 0 }, 0, FLIGHT, mods);
  }
  assert.ok(a.slip > 0.3 && mods.thrust > 4, `slip ${a.slip}`);
  assert.ok(course.distance(m.position.x, m.position.y, m.position.z) < 5, "it stays in the racing tube");
});
