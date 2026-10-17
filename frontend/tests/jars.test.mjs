import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { JARS } from "../src/game/cosmetics/catalog.ts";
import { JAR_RECIPES, JarMotes, buildJar, jarLook } from "../src/game/cosmetics/jars.ts";
import { Kind } from "../src/game/particles.ts";
import { PilotFx } from "../src/game/pilotfx.ts";
import { loadJars } from "../src/game/cosmetics/jarLoader.ts";

// Its own chunk in the game: loaded here up front
await loadJars();

test("every jar holds a particle of its own, glowing from rare up", () => {
  const kinds = new Set(Object.values(Kind));
  const looks = new Set();
  for (const jar of JARS) {
    const recipe = JAR_RECIPES[jar.id];
    assert.ok(recipe, `${jar.id} has a recipe`);
    assert.ok(kinds.has(recipe.kind), `${jar.id}: a real particle kind`);
    assert.ok(recipe.colors.length > 0 && recipe.trail.rate > 0 && recipe.size > 0);
    // One type each: no two jars hold the same particle in the same colors
    const look = `${recipe.kind}:${recipe.colors[0]}`;
    assert.ok(!looks.has(look), `${jar.id} repeats another jar's particle`);
    looks.add(look);
    assert.equal(jarLook(jar.id).glow, jar.rarity >= 2, `${jar.id}: glows only when rare or legendary`);
  }
  assert.equal(Object.keys(JAR_RECIPES).length, JARS.length);
  // Rarer jars are richer
  assert.ok(jarLook("hearts").auraCount < jarLook("honey").auraCount && jarLook("flame").auraCount < jarLook("portal").auraCount);
});

test("a worn jar shows an aura round the pilot and streams a trail: solid when plain, added light when glowing", () => {
  for (const [jar, glowing] of [["hearts", false], ["portal", true]]) {
    const group = new Group();
    const avatar = {
      group, rigMatrix: group.matrixWorld, wingStyle: "classic", jarStyle: jar, dying: false, barrelProgress: -1, boost: 0, brake: 0,
      wingtips(left, right) { left.copy(group.position).x -= 2; right.copy(group.position).x += 2; },
      span(out) { out.set(1, 0, 0); },
      capeTip(out) { out.copy(group.position); },
    };
    const added = [], solid = [];
    const particles = { budget: 1, emit(position, velocity, spec) { added.push(spec.kind); } };
    const soft = { budget: 1, emit(position, velocity, spec) { solid.push({ kind: spec.kind, intensity: spec.intensity }); } };
    const effects = new PilotFx(avatar, "#ffaa66", particles, { solid: soft });
    const velocity = new Vector3(0, 0, -50);
    for (let frame = 0; frame < 120; frame++) {
      group.position.addScaledVector(velocity, 1 / 60);
      effects.update(1 / 60, 50, velocity, 0);
    }
    const kind = JAR_RECIPES[jar].kind;
    const aura = group.children.find((child) => child.isPoints);
    assert.ok(aura?.visible, `${jar}: its aura rides with the pilot`);
    assert.equal(aura.geometry.drawRange.count, jarLook(jar).auraCount);
    if (glowing) {
      assert.ok(added.filter((k) => k === kind).length > 20, "a glowing trail adds light");
      assert.ok(!solid.some((p) => p.kind === kind));
    } else {
      assert.ok(solid.filter((p) => p.kind === kind).length > 10, "a plain trail is drawn solid");
      assert.ok(solid.every((p) => p.intensity <= 1), "plain shapes never bloom");
      assert.ok(!added.includes(kind));
    }
    // Put away, the aura fades and the trail stops
    avatar.jarStyle = "none";
    const before = added.length + solid.length;
    effects.update(1 / 60, 50, velocity, 0);
    assert.equal(aura.visible, false);
    assert.ok(added.length + solid.length - before < 40, "only the wings' own particles");
    effects.dispose();
  }
});

test("a jar model holds its particles inside the glass and cleans up", () => {
  for (const jar of JARS) {
    const model = buildJar(jar.id);
    model.animate(0.5);
    const motes = model.group.children.find((child) => child.isPoints);
    assert.ok(motes?.visible, `${jar.id}: its particles show`);
    model.dispose();
    assert.equal(model.group.parent, null);
  }
  const empty = new JarMotes(4, new Vector3(1, 1, 1));
  empty.set("none");
  empty.update(0.1);
  assert.equal(empty.points.visible, false);
  empty.dispose();
});
