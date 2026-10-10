import test from "node:test";
import assert from "node:assert/strict";
import { Input } from "../src/game/input.ts";

test("held controls, repeat handling, focus loss and gamepad disconnect", () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const win = new EventTarget(), doc = new EventTarget();
  let focused = true, pads = [];
  doc.body = win; doc.hasFocus = () => focused;
  globalThis.window = win; globalThis.document = doc;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {getGamepads: () => pads} });
  const element = {}, input = new Input(element, {invertPitch:false, mouseSensitivity:1});
  const actions = []; input.onAction = action => actions.push(action);
  const key = (code, type = "keydown", repeat = false) => {
    const e = new Event(type, {cancelable:true});
    Object.defineProperties(e, {code:{value:code}, repeat:{value:repeat}});
    win.dispatchEvent(e); return e;
  };
  try {
    key("ShiftLeft"); assert.equal(input.sample(1/60).boost, 1);
    key("Space"); assert.equal(input.sample(1/60).brake, 1);
    assert.equal(key("Space", "keydown", true).defaultPrevented, true);
    assert.deepEqual(actions, []);
    key("KeyC"); assert.deepEqual(actions, ["flap"]);
    key("KeyA"); key("KeyA", "keyup"); key("KeyA");
    assert.deepEqual(actions, ["flap"]);
    win.dispatchEvent(new Event("blur"));
    key("ShiftLeft", "keydown", true); assert.equal(input.sample(1/60).boost, 0);
    pads = [{connected:true, axes:[0,0], buttons:Array.from({length:8}, (_, i) => ({pressed:i===1, value:i===7?0.5:0}))}];
    assert.ok(input.sample(1/60).boost > 0.3); assert.equal(input.hovering, true);
    pads = []; assert.equal(input.sample(1/60).boost, 0); assert.equal(input.hovering, false);
    key("KeyP"); key("KeyP", "keydown", true);
    assert.equal(actions.filter(action => action === "pause").length, 1);
    input.reset();
    assert.equal(input.sample(1/60).brake, 0);
    assert.equal(input.hovering, false);
    key("ShiftLeft"); focused = false; assert.equal(input.sample(1/60).boost, 0);
    focused = true; assert.equal(input.sample(1/60).boost, 0);
  } finally {
    input.dispose(); delete globalThis.window; delete globalThis.document;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  }
});
