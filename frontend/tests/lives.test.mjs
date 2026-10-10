import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Flight } from "../src/game/flight.ts";
import { RunController } from "../src/game/run/controller.ts";
import { START_LIVES } from "../src/game/run/run.ts";
import { UPGRADES, statsFor } from "../src/game/run/upgrades.ts";
import { Course } from "../src/game/world/course.ts";

/** A run on a stand-in game: one course, no rendering */
const makeRun = (lives) => {
  const course = new Course(7);
  const flight = new Flight();
  flight.reset(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 30);
  const summaries = [];
  const host = {
    scene: new THREE.Scene(), particles: { emit() {} }, flight, prevPosition: new THREE.Vector3(), camera: new THREE.PerspectiveCamera(),
    world: { course, seed: 7, biome: { name: "Sky Isles" }, palette: { name: "Alpine", accent: "#fff" }, distance: () => 100 },
    view: { ready: true, setRings() {} }, style: 240, pixelHeight: 720, white: 0,
    setLevel() {}, respawnAt() {}, freeze() {}, veil() {}, insideWormhole() {}, whiteOut(k) { this.white = k; },
    gateBurst() {}, wingbeat() {}, stinger() {}, portalHum() {},
  };
  const run = new RunController(7, host, { ended: (s) => summaries.push(s) }, lives);
  run.start();
  return { run, host, summaries };
};

test("A spare feather is an upgrade worth one life a stack", () => {
  const upgrade = UPGRADES.find((u) => u.id === "spareFeather");
  assert.equal(upgrade?.effect.lives, 1);
  assert.equal(statsFor(["spareFeather", "spareFeather"]).lives, 2);
  assert.equal(START_LIVES, 3);
});

test("a run starts with three lives, a crash costs one, and the last one's crash ends it", () => {
  const { run, host, summaries } = makeRun();
  assert.equal(run.hud().lives, 3);
  run.crashed();
  run.crashed();
  assert.equal(run.hud().lives, 1);
  assert.equal(run.phase, "arrive");
  assert.equal(run.frozen, false);
  run.crashed();
  assert.equal(run.hud().lives, 0);
  assert.equal(run.phase, "lost");
  assert.equal(run.frozen, true); // no respawn
  // The crash plays out before the summary, and the view fades into light
  run.frame(0.5);
  assert.equal(summaries.length, 0);
  for (let i = 0; i < 20; i++) run.frame(0.1);
  assert.equal(host.white, 1);
  assert.equal(summaries.length, 1);
  const [s] = summaries;
  assert.equal(s.completed, false);
  assert.equal(s.crashes, 3);
  assert.equal(s.livesLeft, 0);
  assert.equal(s.levels, 1);
  assert.equal(s.style, 240);
  assert.equal(s.score, 240); // the level's style still counts
  // Nothing after the end counts
  run.crashed();
  assert.equal(summaries.length, 1);
  assert.equal(s.crashes, 3);
});

test("A spare feather adds a life when it is gained, and a finished run reports what's left", () => {
  const { run, summaries } = makeRun();
  run.crashed();
  run.grant("spareFeather");
  assert.equal(run.hud().lives, 3);
  run.grant("dash");
  assert.equal(run.hud().lives, 3);
  run.crashed();
  run.testWin();
  assert.equal(summaries[0].completed, true);
  assert.equal(summaries[0].livesLeft, 2);
  assert.equal(summaries[0].crashes, 2);
});

test("the test sandbox never runs out of lives", () => {
  const { run, summaries } = makeRun(Infinity);
  for (let i = 0; i < 10; i++) run.crashed();
  assert.equal(run.phase, "arrive");
  assert.equal(run.hud().lives, Infinity);
  assert.equal(summaries.length, 0);
});

/** Through the portal and the upgrade pick, to the moment the way out hands control back (the blur still clearing) */
const leavePortal = (run) => {
  run.enterPortal();
  run.frame(0.55);
  run.frame(0.55);
  assert.equal(run.phase, "pick");
  run.pick("dash");
  run.frame(0.1);
  run.frame(0.41);
  assert.equal(run.phase, "portal");
};

test("a crash on the way out of a portal, once control is back, costs a life", () => {
  const { run } = makeRun();
  leavePortal(run);
  run.crashed();
  assert.equal(run.hud().lives, 2);
  // The transition still ends in the new level
  run.frame(2);
  assert.equal(run.phase, "arrive");
  run.testWin();
});

test("the last life's crash on the way out of a portal ends the run and clears the blur", () => {
  const { run, host, summaries } = makeRun(1);
  let veil = 1;
  host.veil = (k) => { veil = k; };
  leavePortal(run);
  assert.ok(veil > 0);
  run.crashed();
  assert.equal(run.phase, "lost");
  assert.equal(veil, 0);
  for (let i = 0; i < 20; i++) run.frame(0.1);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].completed, false);
  assert.equal(summaries[0].crashes, 1);
});

test("inside the wormhole nothing counts as a crash", () => {
  const { run } = makeRun();
  run.enterPortal();
  run.frame(0.55);
  run.crashed();
  assert.equal(run.hud().lives, 3);
});
