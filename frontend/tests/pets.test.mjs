import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { PETS } from "../src/game/pets/catalog.ts";
import { PetModel } from "../src/game/pets/models.ts";
import { Companion } from "../src/game/pets/companion.ts";
import { PET_LOOKS } from "../src/game/tuning.ts";
import { Course } from "../src/game/world/course.ts";
import { World } from "../src/game/world/World.ts";
import { runLevel } from "../src/game/world/biomes/index.ts";

test("all twelve pets animate finite, budgeted toon geometry and clean up their owned resources", () => {
  const signatures = new Set();
  for (const pet of PETS) {
    if (pet.id === "none") continue;
    const model = new PetModel(pet.id), geometries = new Set(); let meshes = 0, vertices = 0;
    model.group.traverse(o => {
      if (!o.isMesh) return; meshes++; if (geometries.has(o.geometry)) return;
      const g = o.geometry; geometries.add(g); const p = g.getAttribute("position"); vertices += p.count;
      for (const attr of ["position", "normal", "color", "glow"]) {
        assert.ok(g.getAttribute(attr).array.every(Number.isFinite)); assert.equal(g.getAttribute(attr).count, p.count);
      }
    });
    assert.ok(meshes <= 12); assert.ok(vertices < 16000);
    signatures.add(`${vertices}:${geometries.size}`);
    for (let i = 0; i < 300; i++) model.animate(1/60);
    model.group.updateMatrixWorld(true);
    model.group.traverse(o => assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
    const pose = model.group.children.map(o => o.quaternion.toArray());
    model.animate(0); assert.deepEqual(model.group.children.map(o => o.quaternion.toArray()), pose);
    let disposed = 0; geometries.forEach(g => g.addEventListener("dispose", () => disposed++));
    model.dispose(); assert.equal(disposed, geometries.size);
  }
  assert.equal(signatures.size, 12, "pets have different geometry, not only different colors");
});

test("follower handles pause, hiding, respawn, re-equip and removal without touching the pilot", () => {
  const scene = new Group(), pilot = new Group(), follower = new Companion(scene);
  pilot.position.set(12, 8, -30); pilot.quaternion.setFromAxisAngle(new Vector3(0,1,0), 0.8);
  const p = pilot.position.clone(), q = pilot.quaternion.clone();
  follower.set("dragon"); assert.equal(scene.children.length, 1);
  follower.update(1/60, pilot, true); const g = follower.group;
  const at = g.position.clone(), rotation = g.quaternion.clone();
  follower.update(0, pilot, true); assert.ok(g.position.equals(at)); assert.ok(g.quaternion.equals(rotation));
  for (let i=0;i<60;i++) { pilot.position.z -= 0.5; follower.update(1/60, pilot, true); }
  assert.ok(g.position.distanceTo(pilot.position) < 12);
  follower.update(1/60, pilot, false); assert.equal(g.visible, false);
  pilot.position.set(400, 80, -1000); follower.update(1/60, pilot, true);
  assert.equal(g.visible, true); assert.ok(g.position.distanceTo(pilot.position) < 5);
  const unchanged = pilot.position.clone(); follower.update(1/60, pilot, true);
  assert.ok(pilot.position.equals(unchanged)); assert.ok(pilot.quaternion.equals(q));
  follower.set("dragon"); assert.equal(follower.group, g);
  follower.set("owl"); assert.equal(g.parent, null); assert.equal(scene.children.length, 1);
  follower.set("none"); assert.equal(scene.children.length, 0); assert.equal(follower.group, null);
  follower.dispose(); follower.dispose();
  pilot.position.copy(p); pilot.quaternion.copy(q);
});

test("teleports while visible snap instead of dragging a pet through the whole world", () => {
  const scene = new Group(), pilot = new Group(), follower = new Companion(scene);
  follower.set("fox"); follower.update(1/60, pilot, true);
  pilot.position.x = PET_LOOKS.snapDistance * 3;
  follower.update(1/60, pilot, true);
  assert.ok(follower.group.position.distanceTo(pilot.position) < 5);
  assert.ok(follower.group.quaternion.angleTo(new Quaternion()) < 1e-8);
  follower.dispose();
});

test("all existing pets are genuine pets, stay by the pilot and take a rail through every hoop without changing the player", () => {
  assert.deepEqual(PETS.map(p => p.id), ["swallow", "owl", "crane", "phoenix", "dragon", "kirin", "fox", "griffin", "manta", "rabbit", "jelly", "koi"]);
  for (const biome of ["skyIsles", "verdant", "reef", "glacier", "archipelago", "lagoon", "twilight", "ember", "aurora"]) {
    const world = new World(runLevel(7, 1, biome)), course = world.course;
    const scene = new Group(), pilot = new Group(), companion = new Companion(scene);
    companion.set("crane"); let previous = null, onRail = 0, beside = 0;
    const nearest = new Map(course.rings.map(r => [r.index, Infinity]));
    for (let z = course.start.z; z < course.endZ + 3; z += .25) {
      course.pointAt(z, pilot.position); const saved = pilot.position.clone();
      companion.update(1/120, pilot, true, course, 50);
      const at = companion.group.position;
      assert.ok(pilot.position.equals(saved)); assert.ok(pilot.quaternion.equals(new Quaternion()));
      // Always close to the pilot; on the rail only near a hoop, and beside the pilot far from every hoop
      assert.ok(at.distanceTo(pilot.position) < PET_LOOKS.lead + 6);
      const hoop = Math.min(...course.rings.filter(r => r.position.z >= z - 2).map(r => r.position.distanceTo(pilot.position)));
      if (hoop < PET_LOOKS.hoopRange - 10) onRail++;
      const anyHoop = Math.min(...course.rings.map(r => r.position.distanceTo(pilot.position)));
      if (anyHoop > PET_LOOKS.hoopRange + 40) { beside++; assert.ok(at.distanceTo(pilot.position) < 4.5, biome); }
      assert.ok(world.distance(at.x, at.y, at.z) > 6, biome);
      if (previous) for (const ring of course.rings) {
        const span = at.clone().sub(previous), t = Math.max(0, Math.min(1, ring.position.clone().sub(previous).dot(span) / Math.max(1e-12, span.lengthSq())));
        nearest.set(ring.index, Math.min(nearest.get(ring.index), previous.clone().addScaledVector(span, t).distanceTo(ring.position)));
      }
      previous = at.clone();
    }
    assert.ok([...nearest.values()].every(distance => distance < .5), biome);
    assert.ok(onRail > 0 && beside > 0, biome);
    const frozen = companion.group.position.clone(); companion.update(0,pilot,true,course); assert.ok(companion.group.position.equals(frozen));
    companion.update(1/60,pilot,false,course); assert.equal(companion.group.visible,false);
    const replacement = new Course(42); pilot.position.copy(replacement.start);
    // A new course: the pet comes along at once, playing round the pilot (ahead or behind), not on the old rail
    companion.update(1/60,pilot,true,replacement); assert.ok(companion.group.position.distanceTo(pilot.position) < 5);
    companion.dispose();
  }
});

test("far from hoops the pet circles the pilot playfully and smoothly instead of holding one spot", () => {
  const scene = new Group(), pilot = new Group(), companion = new Companion(scene);
  companion.set("fox");
  const sides = new Set(); let previous = null, largestStep = 0, farthest = 0;
  for (let i = 0; i < 60 * 14; i++) {
    pilot.position.z -= 40 / 60; // 40 m/s straight ahead (-z), no course: nothing to guide it
    companion.update(1 / 60, pilot, true);
    const offset = companion.group.position.clone().sub(pilot.position);
    farthest = Math.max(farthest, offset.length());
    // Which quarter round the pilot it is in: right, ahead, left or behind
    sides.add(Math.floor(((Math.atan2(offset.x, -offset.z) + Math.PI * 2.25) % (Math.PI * 2)) / (Math.PI / 2)));
    if (previous) largestStep = Math.max(largestStep, offset.distanceTo(previous));
    previous = offset;
  }
  assert.equal(sides.size, 4, "it goes all the way round");
  assert.ok(farthest < 4.6, `stays close (${farthest.toFixed(2)} m)`);
  assert.ok(largestStep < 0.25, `moves smoothly (${largestStep.toFixed(3)} m per frame)`);
  companion.dispose();
});

test("after a hoop the pet plays around for a few seconds, and never jumps on or off the rail", () => {
  for (const biome of ["verdant", "skyIsles", "ember"]) {
    const world = new World(runLevel(7, 1, biome)), course = world.course;
    const scene = new Group(), pilot = new Group(), companion = new Companion(scene);
    companion.set("fox");
    let roamed = 0, longest = 0, run = 0, previous = null, velocity = null, fastest = 0, sharpest = 0;
    const dt = 1 / 120;
    for (let z = course.start.z; z < course.endZ; z += 40 * dt) {
      course.pointAt(z, pilot.position);
      companion.update(dt, pilot, true, course, 40);
      // Motion relative to the pilot: how fast, and how suddenly that changes (a jump or a fling)
      const offset = companion.group.position.clone().sub(pilot.position);
      if (previous) {
        const v = offset.clone().sub(previous).divideScalar(dt);
        fastest = Math.max(fastest, v.length());
        if (velocity) sharpest = Math.max(sharpest, v.distanceTo(velocity) / dt);
        velocity = v;
      }
      previous = offset;
      if (companion.roam > 0) { roamed++; run++; longest = Math.max(longest, run); } else run = 0;
    }
    assert.ok(roamed > 0, `${biome}: it roams after hoops`);
    assert.ok(longest * dt > 2.5, `${biome}: it takes its time (${(longest * dt).toFixed(1)} s) before orbiting again`);
    assert.ok(fastest < 22, `${biome}: never darts (${fastest.toFixed(1)} m/s relative to the pilot)`);
    assert.ok(sharpest < 300, `${biome}: no jumps or flings (${sharpest.toFixed(0)} m/s² relative to the pilot)`);
    companion.dispose();
  }
});
