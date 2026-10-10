import test from "node:test";
import assert from "node:assert/strict";
import { screenFromSearch, urlFor } from "../src/route.ts";
import { Input } from "../src/game/input.ts";

test("?test opens the test sandbox, however it is added to a URL", () => {
  const screen = (search) => screenFromSearch(search, true);
  assert.deepEqual(screen("?test"), { kind: "test", biome: "skyIsles", seed: 1 });
  assert.deepEqual(screen("?test=verdant&seed=2"), { kind: "test", biome: "verdant", seed: 2 });
  assert.deepEqual(screen("?explore=verdant&seed=2&test"), { kind: "test", biome: "verdant", seed: 2 });
  assert.deepEqual(screen("?test&explore=ember"), { kind: "test", biome: "ember", seed: 1 });
  assert.deepEqual(screen("?seed=42&test"), { kind: "test", biome: "skyIsles", seed: 42 });
  assert.deepEqual(screen("?run=5&test"), { kind: "test", biome: "skyIsles", seed: 5 });
  assert.deepEqual(screen("?test=1"), { kind: "test", biome: "skyIsles", seed: 1 });
  assert.deepEqual(screen("?test=nowhere&explore=lagoon"), { kind: "test", biome: "lagoon", seed: 1 });
  assert.deepEqual(screen("?test=toString"), { kind: "test", biome: "skyIsles", seed: 1 });
  // Multiplayer and the gallery never run in test mode
  assert.deepEqual(screen("?room=ABCD&test"), { kind: "room", code: "ABCD" });
  assert.deepEqual(screen("?gallery&test"), { kind: "gallery" });
  // Without test, nothing changed
  assert.deepEqual(screen("?run=5"), { kind: "run", seed: 5 });
  assert.deepEqual(screen("?explore=ember&seed=3"), { kind: "explore", biome: "ember", seed: 3 });
  assert.deepEqual(screen("?seed=42"), { kind: "solo", seed: 42 });
  assert.deepEqual(screen(""), { kind: "menu" });
  assert.equal(urlFor({ kind: "test", biome: "verdant", seed: 2 }), "/?test=verdant&seed=2");
});

test("test chords are consumed before ordinary bindings, once per press", () => {
  const win = new EventTarget(), doc = new EventTarget();
  doc.body = win; doc.hasFocus = () => true;
  globalThis.window = win; globalThis.document = doc;
  const input = new Input({}, { invertPitch: false, mouseSensitivity: 1 });
  const actions = [], tests = [];
  input.onAction = (a) => actions.push(a);
  const key = (code, { shift = false, repeat = false, type = "keydown" } = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.defineProperties(e, { code: { value: code }, shiftKey: { value: shift }, ctrlKey: { value: false }, altKey: { value: false }, metaKey: { value: false }, repeat: { value: repeat } });
    win.dispatchEvent(e);
    return e;
  };
  try {
    // Without test mode, Shift+P is just P: pause
    key("KeyP", { shift: true }); key("KeyP", { type: "keyup" });
    assert.deepEqual(actions, ["pause"]);
    input.onTestAction = (a) => tests.push(a);
    key("ShiftLeft");
    assert.equal(key("KeyP", { shift: true }).defaultPrevented, true);
    key("KeyO", { shift: true });
    key("KeyS", { shift: true });
    key("KeyS", { shift: true, repeat: true });
    assert.deepEqual(tests, ["portal", "win", "speed"]);
    assert.deepEqual(actions, ["pause"]);
    // The chord drops held Shift boost and never pitches with S
    const sample = input.sample(1 / 60);
    assert.equal(sample.boost, 0);
    assert.equal(sample.pitch, 0);
  } finally {
    input.dispose();
  }
});
