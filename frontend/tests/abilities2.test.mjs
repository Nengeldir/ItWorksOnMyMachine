import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Flight, FLIGHT, plainMods } from "../src/game/flight.ts";
import { ABILITY, Abilities } from "../src/game/run/abilities.ts";
import { statsFor, UPGRADES } from "../src/game/run/upgrades.ts";
import { Course } from "../src/game/world/course.ts";

// The design list's abilities 11 to 20 (run/abilities.ts)

const STEP = 1 / 120;
const make = (speed = 40, direction = new Vector3(0, 0, -1), position = new Vector3()) => { const f = new Flight(); f.reset(position, direction, speed); return f; };
const withAbilities = (ids, seed = 7) => {
  const course = new Course(seed);
  const a = new Abilities();
  a.setStats(statsFor(ids));
  a.setLevel({ course, seed });
  return { a, course };
};
/** One controller step: base mods, the abilities' answer, then the flight with them */
const step = (a, f, partial = {}, proximity = 0) => {
  const input = { pitch: 0, roll: 0, ...partial };
  const mods = plainMods();
  a.step(STEP, input, proximity, f, mods);
  f.step(STEP, input, proximity, FLIGHT, mods);
  return mods;
};
const run = (a, f, seconds, input) => { let mods; for (let i = 0; i < seconds * 120; i++) mods = step(a, f, input); return mods; };

test("the design list's abilities 11 to 20 are upgrades", () => {
  const ids = UPGRADES.map((u) => u.id);
  for (const id of ["moth", "zenith", "resonance", "leyLine", "aeroBrake", "draftWeave", "ascension", "falcon", "butterfly", "echoTrail"]) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
});

test("the new flight mods do nothing at their defaults", () => {
  const plain = make(), modded = make();
  for (let i = 0; i < 240; i++) {
    const input = { pitch: Math.sin(i / 30) * 0.6, roll: Math.cos(i / 40) * 0.8 };
    plain.step(STEP, input, 0.3, FLIGHT, null);
    modded.step(STEP, input, 0.3, FLIGHT, plainMods());
  }
  assert.ok(plain.position.distanceTo(modded.position) < 1e-8);
  assert.ok(Math.abs(plain.speed - modded.speed) < 1e-9);
});

test("Moth's Attraction: the nearer a gate's heart, the faster you come out", () => {
  const { a } = withAbilities(["moth"]);
  const heart = make(40), edge = make(40);
  assert.ok(a.threaded(0, 0.5, 10, heart), "a bullseye");
  assert.ok(!a.threaded(1, 9, 10, edge));
  assert.ok(heart.speed > 50 && edge.speed < 41, `${heart.speed} / ${edge.speed}`);
  const none = make(40);
  assert.ok(!withAbilities([]).a.threaded(0, 0, 10, none));
  assert.equal(none.speed, 40);
});

test("Zenith Climber: a straight-up climb keeps its speed about 20% longer", () => {
  const climbTime = (ids) => {
    const { a } = withAbilities(ids);
    const f = make(45, new Vector3(0, 1, 0));
    let t = 0;
    while (f.speed > 12 && t < 20) { step(a, f); t += STEP; }
    return t;
  };
  const plain = climbTime([]), zenith = climbTime(["zenith"]);
  const ratio = zenith / plain;
  assert.ok(ratio > 1.12 && ratio < 1.22, `ratio ${ratio}`);
  // Level flight is untouched
  const { a } = withAbilities(["zenith"]);
  const f = make(40);
  assert.equal(step(a, f).climb, 1);
});

test("Resonance: the gates ahead in its cone turn to face you, those behind don't", () => {
  const { a, course } = withAbilities(["resonance"]);
  const z = course.rings[2].position.z - 120;
  const f = make(40, course.tangentAt(z), course.pointAt(z).add(new Vector3(9, 4, 0)));
  assert.ok(a.press("resonance", f));
  assert.ok(!a.press("resonance", f), "cooling down");
  for (let i = 0; i < 240; i++) a.step(STEP, { pitch: 0, roll: 0 }, 0, f, plainMods());
  const ring = course.rings[2];
  assert.ok(a.attuned.has(2), "the gate ahead heard it");
  const expected = ring.position.clone().sub(f.position).normalize();
  assert.ok(a.gateNormal(ring).angleTo(expected) < 0.05, "it faces where you were");
  const behind = course.rings.filter((r) => r.position.z < z);
  assert.ok(behind.length > 0);
  for (const r of behind) {
    assert.ok(!a.attuned.has(r.index), `gate ${r.index} behind did not`);
    assert.equal(a.gateNormal(r), r.normal);
  }
  for (const index of a.attuned.keys()) {
    const rel = course.rings[index].position.clone().sub(new Vector3(...course.pointAt(z).add(new Vector3(9, 4, 0)).toArray()));
    assert.ok(rel.length() <= ABILITY.songRange + 1, "within its reach");
  }
});

test("Ley-Line Surger: five gates in quick succession, then endless boost until the gates stop", () => {
  const { a } = withAbilities(["leyLine"]);
  const f = make(40);
  for (let g = 0; g < 5; g++) {
    assert.equal(a.ley, false);
    a.gate(g, g + 1);
    run(a, f, 2, {});
  }
  assert.ok(a.ley, "awake");
  f.boostCharge = 0;
  run(a, f, 2, { pitch: 0, roll: 0, boost: 1 });
  assert.ok(f.boostCharge > 0.99, `boost never runs out: ${f.boostCharge}`);
  run(a, f, ABILITY.leyHold, {});
  assert.equal(a.ley, false, "no gate for too long: the chain broke");
  // Too slow between gates never wakes it
  const slow = withAbilities(["leyLine"]).a;
  for (let g = 0; g < 6; g++) { slow.gate(g, 1); run(slow, f, ABILITY.leyGap + 0.5, {}); }
  assert.equal(slow.ley, false);
});

test("Aero-Braking: pressing the brake flares hard and tightens the turn, once per cooldown", () => {
  const flown = (ids) => {
    const { a } = withAbilities(ids);
    const f = make(70);
    let maxTurn = 1;
    for (let i = 0; i < 60; i++) maxTurn = Math.max(maxTurn, step(a, f, { pitch: 0, roll: 0, brake: 1 }).turn);
    return { f, a, maxTurn };
  };
  const plain = flown([]), flare = flown(["aeroBrake"]);
  assert.ok(flare.f.speed < plain.f.speed - 8, `${flare.f.speed} vs ${plain.f.speed}`);
  assert.ok(flare.maxTurn > 2, `turn ${flare.maxTurn}`);
  assert.equal(plain.maxTurn, 1);
  // Held, it doesn't fire again; let go and press during the cooldown: nothing
  const cue = flare.a.cue.flare;
  run(flare.a, flare.f, 1, { pitch: 0, roll: 0, brake: 1 });
  run(flare.a, flare.f, 0.2, { pitch: 0, roll: 0, brake: 0 });
  run(flare.a, flare.f, 0.2, { pitch: 0, roll: 0, brake: 1 });
  assert.equal(flare.a.cue.flare, cue);
});

test("Draft-Weaving: a tight spiral spins up a tornado that shields one glancing hit", () => {
  const { a } = withAbilities(["draftWeave"]);
  const f = make(40);
  let t = 0;
  while (a.tornado <= 0 && t < 10) { step(a, f, { pitch: 0, roll: 1 }); t += STEP; }
  assert.ok(a.tornado > 0, "formed");
  assert.ok(t > 2, `formed after ${t} s of hard turning`);
  const wall = new Vector3(1, 0, 0);
  assert.equal(a.save("body", wall, new Vector3(-1, 0, 0)), null, "head-on still crashes");
  assert.equal(a.save("body", wall, new Vector3(-0.3, 0, -1).normalize()), "shield");
  a.saved("shield", new Vector3(), wall);
  assert.equal(a.tornado, 0);
  assert.equal(a.save("left", wall, new Vector3(-0.3, 0, -1).normalize()), null, "used up");
  // Two barrel rolls make one too
  const rolls = withAbilities(["draftWeave"]).a;
  rolls.dodged(1, f); rolls.dodged(-1, f);
  assert.ok(rolls.tornado > 0);
});

test("Ascension: all the speed turned straight up", () => {
  const { a } = withAbilities(["ascension"]);
  const f = make(50, new Vector3(1, -0.2, -1).normalize());
  assert.ok(a.press("ascend", f));
  run(a, f, ABILITY.ascendTime + 0.01, {});
  assert.equal(a.ascend, -1);
  assert.ok(f.forward.y > 0.97, `forward ${f.forward.y}`);
  assert.ok(Math.hypot(f.velocity.x, f.velocity.z) < 3);
  assert.ok(f.velocity.y > ABILITY.ascendMin - 4 && f.speed <= ABILITY.ascendMax + 1, `speed ${f.speed}`);
  assert.ok(!a.press("ascend", f), "cooling down");
});

test("gliding stances: falcon falls faster and steers stiffly, butterfly floats; H cycles through the ones you have", () => {
  const { a } = withAbilities(["falcon", "butterfly"]);
  const f = make(40);
  assert.ok(a.press("stance", f));
  assert.equal(a.stance, "falcon");
  let mods = run(a, f, 1, {});
  assert.ok(mods.sink > 2 && mods.drag < 0.7 && mods.turn < 0.6);
  a.press("stance", f);
  assert.equal(a.stance, "butterfly");
  mods = run(a, f, 1, {});
  assert.ok(mods.sink < 0.35 && mods.drag > 2 && mods.turn > 1.7);
  a.press("stance", f);
  assert.equal(a.stance, "none");
  mods = run(a, f, 1, {});
  assert.equal(mods.sink, 1);
  assert.ok(!withAbilities([]).a.press("stance", f));
  // In a dive the falcon pulls ahead, the butterfly lags
  const dive = (stance) => {
    const { a } = withAbilities([stance]);
    const g = make(40, new Vector3(0, -0.5, -1).normalize());
    if (stance !== "none") a.press("stance", g);
    run(a, g, 6, {});
    return g.speed;
  };
  const plain = dive("none");
  assert.ok(dive("falcon") > plain + 5 && dive("butterfly") < plain - 5);
});

test("Echo-Trail: a loop closed across your own ribbon becomes a wind ring and pushes you on", () => {
  const { a } = withAbilities(["echoTrail"]);
  const f = make(42);
  let t = 0;
  let surged = 0;
  while (a.cue.echo === 0 && t < 6) {
    const before = f.speed;
    step(a, f, { pitch: 1, roll: 0 });
    if (f.speed - before > 5) surged = f.speed - before;
    t += STEP;
  }
  assert.equal(a.cue.echo, 1, "the loop closed");
  assert.ok(surged >= ABILITY.echoSurge - 1, `surge ${surged}`);
  const r = a.echoRing;
  assert.ok(r.t >= 0 && r.radius > 6 && r.radius < 30, `radius ${r.radius}`);
  // A vertical loop flown along -z: the ring stands across x
  assert.ok(Math.abs(r.normal.x) > 0.9, `normal ${r.normal.toArray()}`);
  // Level flight never closes one, nor does turning on the spot in a hover-stall
  const { a: b } = withAbilities(["echoTrail", "hoverStall"]);
  const g = make(42);
  run(b, g, 4, {});
  b.press("hover", g);
  run(b, g, ABILITY.hangTime - 0.1, { roll: 1 });
  run(b, g, 3, {});
  assert.equal(b.cue.echo, 0);
});
