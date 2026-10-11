import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Autopilot } from "../src/game/autopilot.ts";
import { Flight, hitboxWorld } from "../src/game/flight.ts";
import { makeLevel, runLevel } from "../src/game/world/biomes/index.ts";
import { World } from "../src/game/world/World.ts";

// Flies a whole course on the autopilot, to 40 m past the finish (where Game loops it)
function fly(level) {
  const world = new World(level);
  const flight = new Flight();
  const autopilot = new Autopilot();
  const spawn = world.spawnPoint(0);
  flight.reset(spawn.position, spawn.direction, 32);
  const ball = new Vector3();
  const wings = Array.from({ length: 8 }, () => new Vector3());
  const before = new Vector3();
  let clearance = Infinity;
  let offCentre = 0;
  let passed = 0;
  for (let t = 0; flight.position.z < world.course.endZ + 40 && t < 300; t += 1 / 120) {
    before.copy(flight.position);
    autopilot.step(1 / 120, flight, world.course);
    hitboxWorld(flight.position, flight.quaternion, ball, wings);
    for (const p of [ball, ...wings]) clearance = Math.min(clearance, world.distance(p.x, p.y, p.z));
    assert.ok(!world.lost(flight.position.y, flight.position.z));
    for (const ring of world.course.rings) {
      const a = before.clone().sub(ring.position).dot(ring.normal);
      const b = flight.position.clone().sub(ring.position).dot(ring.normal);
      if (a < 0 && b >= 0) {
        passed++;
        offCentre = Math.max(offCentre, before.clone().lerp(flight.position, a / (a - b)).distanceTo(ring.position));
      }
    }
  }
  return { clearance, offCentre, passed, rings: world.course.rings.length };
}

test("the autopilot flies through the middle of every gate and keeps clear of the land", () => {
  const skyIsles = (seed) => makeLevel({ biome: "skyIsles", seed, mood: 0, runSeed: 0, index: 0 });
  for (const level of [skyIsles(42), skyIsles(7), runLevel(1, 1, "lagoon"), runLevel(2, 1, "ember")]) {
    const { clearance, offCentre, passed, rings } = fly(level);
    assert.equal(passed, rings, "every gate, once");
    assert.ok(offCentre < 0.5, `through the middle (${offCentre.toFixed(2)} m off)`);
    assert.ok(clearance > 6, `clear of the land (${clearance.toFixed(1)} m)`);
  }
});
