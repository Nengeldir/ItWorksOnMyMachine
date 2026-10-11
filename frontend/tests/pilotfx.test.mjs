import test from "node:test";
import assert from "node:assert/strict";
import { Color, Group, Vector3 } from "three";
import { PilotFx } from "../src/game/pilotfx.ts";
import { Particles, fx, fxTime, Kind } from "../src/game/particles.ts";

function emitter() {
  const group = new Group();
  const avatar = {
    group, wingStyle: "classic", barrelProgress: -1, boost: 0, brake: 0,
    wingtips(left, right) { left.copy(group.position).x -= 2; right.copy(group.position).x += 2; },
    span(out) { out.set(1, 0, 0); },
    capeTip(out) { out.copy(group.position); },
  };
  const emitted = [];
  const particles = { budget: 1, emit(position, velocity, spec, age = 0) {
    emitted.push({ position: position.clone(), size: spec.size, kind: spec.kind, age });
  } };
  return { avatar, emitted, effects: new PilotFx(avatar, "#ffaa66", particles) };
}

test("wing grains follow the swept wingtip instead of batching at a frame endpoint", () => {
  const random = Math.random;
  Math.random = () => .5;
  try {
    for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
      const { avatar, emitted, effects } = emitter();
      const velocity = new Vector3(0, 0, 60);
      effects.update(0, 60, velocity, 0);
      // A second of flight at every step size (Sky's motes are sparse: a fixed frame count would starve the fast steps)
      for (let frame = 0; frame < Math.round(1 / dt); frame++) {
        avatar.group.position.addScaledVector(velocity, dt);
        effects.update(dt, 60, velocity, 0);
      }
      const left = emitted.filter(p => p.position.x < 0);
      assert.ok(left.length > 5);
      for (let i = 1; i < left.length; i++) {
        assert.ok(left[i].position.z - left[i - 1].position.z > .3, `cluster at ${dt}s`);
      }
      assert.ok(emitted.every(p => p.size <= .85), "wing motes stay small (Sky's winged light: under a metre)");
      assert.ok(emitted.every(p => p.age >= 0 && p.age <= dt));
      effects.dispose();
    }
  } finally { Math.random = random; }
});

test("subframe emission preserves birth time in the GPU particle buffer", () => {
  const particles = new Particles(4);
  fxTime.value = 10;
  particles.emit(new Vector3(), new Vector3(), fx(1, .1, new Color("white"), Kind.Glow), .025);
  const birth = particles.points.geometry.getAttribute("timing").getX(0);
  assert.ok(Math.abs(birth - 9.975) < .00001);
  particles.dispose();
  fxTime.value = 0;
});

test("decorated wings also distribute their accent grains across the frame", () => {
  const random = Math.random;
  Math.random = () => .5;
  try {
    const { avatar, emitted, effects } = emitter();
    avatar.wingStyle = "astral";
    const velocity = new Vector3(0, 0, 60);
    effects.update(0, 60, velocity, 0);
    avatar.group.position.z = 6;
    effects.update(.1, 60, velocity, 0);
    const accents = emitted.filter(p => p.kind === Kind.Star);
    assert.ok(accents.length >= 3);
    assert.ok(new Set(accents.map(p => p.position.z)).size === accents.length);
    assert.ok(accents.every(p => p.size <= .2 && p.age >= 0 && p.age <= .1));
    effects.dispose();
  } finally { Math.random = random; }
});

test("stopping emission and resetting do not draw a particle bridge after a teleport", () => {
  const { avatar, emitted, effects } = emitter();
  const velocity = new Vector3(0, 0, 60);
  effects.update(.1, 60, velocity, 0);
  emitted.length = 0;
  avatar.group.position.z = 500;
  effects.update(.1, 60, velocity, 0, false);
  assert.equal(emitted.length, 0);
  effects.reset();
  effects.update(.1, 60, velocity, 0);
  assert.ok(emitted.length > 0);
  assert.ok(emitted.every(p => Math.abs(p.position.z - 500) <= .16));
  emitted.length = 0;
  avatar.onDownstroke(1);
  assert.ok(emitted.length > 0);
  assert.ok(emitted.every(p => p.size <= .42), "downstroke should leave compact air puffs");
  effects.dispose();
});
