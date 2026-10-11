import test from "node:test";
import assert from "node:assert/strict";
import { Scene } from "three";

// ItemFx paints glow textures on canvases: a stub 2D context is all it needs outside a browser
const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => ({ addColorStop() {} }), set: (target, key, value) => { target[key] = value; return true; } });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };

const { Avatar } = await import("../src/game/avatar.ts");
const { Equipment } = await import("../src/game/items/equip.ts");
const { ItemFx } = await import("../src/game/items/fx.ts");
const { Items } = await import("../src/game/run/items.ts");
const { Flight } = await import("../src/game/flight.ts");
const { Course } = await import("../src/game/world/course.ts");

function setup() {
  const scene = new Scene(), avatar = new Avatar("#4aa3ff");
  const particles = { budget: 1, emit() {} };
  const equipment = new Equipment(avatar, particles);
  const fx = new ItemFx(scene, avatar, equipment, particles, { kick() {}, sound() {} });
  const items = new Items();
  items.setLevel({ seed: 7, course: new Course(7), distance: () => 100 });
  const flight = new Flight();
  return { equipment, fx, items, flight };
}

test("a firework put on outside the Comet Tail item stays on the back and keeps its own thrust", () => {
  const { equipment, fx, items, flight } = setup();
  equipment.equip("firework", true);
  equipment.setThrust(0.9);
  for (let i = 0; i < 120; i++) { fx.update(1 / 60, items, flight, true); equipment.update(1 / 60); }
  assert.equal(equipment.wearing("back"), "firework", "ItemFx must not take off a rocket it didn't strap on");
});
