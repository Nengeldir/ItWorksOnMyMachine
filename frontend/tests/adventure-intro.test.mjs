import test from "node:test";
import assert from "node:assert/strict";
import { Scene, Vector3, Quaternion } from "three";
import { Game } from "../src/game/Game.ts";
import { Flight } from "../src/game/flight.ts";
import { Autopilot } from "../src/game/autopilot.ts";
import { RunController } from "../src/game/run/controller.ts";
import { World } from "../src/game/world/World.ts";
import { runLevel } from "../src/game/world/biomes/index.ts";

// The real opening preview, rail step and in-place take-off handover, without a WebGL renderer.
function preview() {
  const game = Object.create(Game.prototype);
  const world = new World(runLevel(7, 1, "skyIsles"));
  const spawn = world.spawnPoint(0), flight = new Flight();
  flight.reset(spawn.position, spawn.direction, 32);
  const calls = { resets: 0, releases: 0, bursts: 0, snaps: 0, rings: [] };
  Object.assign(game, {
    world, flight, rails: new Autopilot(), scene: new Scene(),
    prevPosition: spawn.position.clone(), prevQuaternion: new Quaternion(), prevVelocity: new Vector3(), prevDodgeVelocity: new Vector3(),
    paused: false, startSlot: null, style: 0, accumulator: 0, elapsed: 0,
    input: { reset: () => calls.resets++, releasePointer: () => calls.releases++ },
    avatar: { resetMotion() {}, revive() {} }, fx: { reset() {} }, speedLines: { reset() {} },
    rig: { snap: () => calls.snaps++ },
    view: { setRings: (mode, next) => calls.rings.push(mode === "hidden" ? mode : [mode, next]), gates: { passing: () => false } },
    glide: { stop() {} }, whiteOut() {}, veil() {}, insideWormhole() {},
    setLevel() {}, gateBurst: () => calls.bursts++,
  });
  game.run = new RunController(7, game, {});
  game.run.start(world.level);
  return { game, calls, spawn };
}

test("Adventure preview glides the safe rail with gates hidden and leaves run progress untouched", () => {
  const { game, calls } = preview();
  game.holdRun(true);
  assert.equal(game.frozen, false, "the preview must move");
  assert.equal(game.autopiloting, true);
  assert.equal(game.introAutopilot, true);
  assert.equal(calls.releases, 1);
  assert.equal(calls.rings.at(-1), "hidden", "gates wait until take-off");
  const start = game.flight.position.clone();
  for (let i = 0; i < 6000; i++) game.autopilotStep();
  assert.ok(game.flight.position.distanceTo(start) > 100);
  assert.equal(calls.bursts, 0, "the preview never passes gates");
  assert.equal(game.run.checkpoint, 0);
  assert.equal(game.run.score, 0);
  assert.equal(game.run.levelTime, 0);
  assert.equal(game.run.phaseTime, 0);
  game.run.dispose();
});

test("Take off hands control over in place and skips the gates already behind", () => {
  const { game, calls, spawn } = preview();
  game.holdRun(true);
  for (let i = 0; i < 1200; i++) game.autopilotStep();
  const at = game.flight.position.clone();
  const speed = game.flight.speed;
  assert.ok(at.distanceTo(spawn.position) > 50, "the preview flew a stretch first");
  game.run.phaseTime = 45;
  game.run.levelTime = 45;
  game.holdRun(false);
  assert.equal(game.autopiloting, false);
  assert.equal(game.introAutopilot, false);
  assert.equal(game.frozen, false);
  assert.ok(game.flight.position.distanceTo(at) < 1e-9, "no jump back to the start");
  assert.equal(game.flight.speed, speed);
  assert.equal(game.run.phase, "arrive");
  assert.equal(game.run.phaseTime, 0);
  assert.equal(game.run.levelTime, 0);
  assert.equal(game.run.score, 0, "skipped gates score nothing");
  const rings = game.world.course.rings;
  const behind = rings.filter((ring, i) => i < rings.length - 1 && new Vector3().subVectors(at, ring.position).dot(ring.normal) > 0).length;
  assert.ok(behind > 0, "the preview flew past a gate");
  assert.deepEqual(calls.rings.at(-1), ["race", behind], "the gates ahead grow in");
  assert.ok(calls.resets >= 1, "preview input cannot leak into flight");
  game.run.dispose();
});
