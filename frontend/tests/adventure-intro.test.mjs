import test from "node:test";
import assert from "node:assert/strict";
import { Scene, Vector3, Quaternion } from "three";
import { Game } from "../src/game/Game.ts";
import { Flight } from "../src/game/flight.ts";
import { Autopilot } from "../src/game/autopilot.ts";
import { RunController } from "../src/game/run/controller.ts";
import { World } from "../src/game/world/World.ts";
import { runLevel } from "../src/game/world/biomes/index.ts";

// Exercise the real preview, rail step and take-off handover without a WebGL renderer.
function preview() {
  const game = Object.create(Game.prototype);
  const world = new World(runLevel(7, 1, "skyIsles"));
  const spawn = world.spawnPoint(0), flight = new Flight();
  flight.reset(spawn.position, spawn.direction, 32);
  const calls = { resets: 0, releases: 0, bursts: 0, snaps: 0 };
  Object.assign(game, {
    world, flight, rails: new Autopilot(), scene: new Scene(),
    prevPosition: spawn.position.clone(), prevQuaternion: new Quaternion(), prevVelocity: new Vector3(),
    paused: false, startSlot: null, style: 0, accumulator: 0, elapsed: 0,
    input: { reset: () => calls.resets++, releasePointer: () => calls.releases++ },
    avatar: { resetMotion() {}, revive() {} }, fx: { reset() {} }, speedLines: { reset() {} },
    rig: { snap: () => calls.snaps++ },
    view: { setRings() {}, gates: { passing: () => false } },
    glide: { stop() {} }, whiteOut() {}, veil() {}, insideWormhole() {},
    setLevel() {}, gateBurst: () => calls.bursts++,
  });
  game.run = new RunController(7, game, {});
  game.run.start(world.level);
  return { game, calls, spawn };
}

test("Adventure preview follows the safe rail, crosses gates and leaves run progress untouched", () => {
  const { game, calls } = preview();
  game.holdRun(true);
  assert.equal(game.frozen, false, "the preview must move");
  assert.equal(game.autopiloting, true);
  assert.equal(game.introAutopilot, true);
  assert.equal(calls.releases, 1);
  const start = game.flight.position.clone();
  for (let i = 0; i < 6000; i++) game.autopilotStep();
  assert.ok(game.flight.position.distanceTo(start) > 100);
  assert.ok(calls.bursts > 0, "preview passes actual gates");
  assert.equal(game.run.checkpoint, 0);
  assert.equal(game.run.score, 0);
  assert.equal(game.run.levelTime, 0);
  assert.equal(game.run.phaseTime, 0);
  game.run.dispose();
});

test("Take off restores control at the original start with fresh flight and title timing", () => {
  const { game, calls, spawn } = preview();
  game.holdRun(true);
  for (let i = 0; i < 600; i++) game.autopilotStep();
  game.run.phase = "explore";
  game.run.phaseTime = 45;
  game.run.levelTime = 45;
  game.holdRun(false);
  assert.equal(game.autopiloting, false);
  assert.equal(game.introAutopilot, false);
  assert.equal(game.frozen, false);
  assert.ok(game.flight.position.distanceTo(spawn.position) < 1e-9);
  assert.equal(game.flight.speed, 32);
  assert.equal(game.flight.boost, 0);
  assert.equal(game.flight.brake, 0);
  assert.equal(game.run.phase, "arrive");
  assert.equal(game.run.phaseTime, 0);
  assert.equal(game.run.levelTime, 0);
  assert.equal(calls.snaps, 1, "camera resets with the pilot");
  assert.ok(calls.resets >= 2, "preview input cannot leak into flight");
  game.run.dispose();
});
