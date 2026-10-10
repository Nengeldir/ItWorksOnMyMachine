import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "../src/storage.ts";
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
    assert.ok(input.sample(1/60).boost > 0.3); assert.equal(actions.filter(a => a === "hover").length, 1);
    assert.ok(input.sample(1/60).boost > 0.3); assert.equal(actions.filter(a => a === "hover").length, 1, "B hover-stalls once per press");
    pads = []; assert.equal(input.sample(1/60).boost, 0);
    key("KeyP"); key("KeyP", "keydown", true);
    assert.equal(actions.filter(action => action === "pause").length, 1);
    input.reset();
    assert.equal(input.sample(1/60).brake, 0);
    key("KeyX"); key("KeyZ"); key("KeyF");
    assert.deepEqual(actions.slice(-3), ["plunge", "burst", "hover"]);
    key("ShiftLeft"); focused = false; assert.equal(input.sample(1/60).boost, 0);
    focused = true; assert.equal(input.sample(1/60).boost, 0);

    input.settings = defaultSettings();
    input.settings.bindings.boost = ["KeyG"];
    input.settings.bindings.pause = ["KeyO"];
    input.reset(); key("ShiftLeft"); assert.equal(input.sample(0).boost, 0);
    key("KeyG"); assert.equal(input.sample(0).boost, 1);
    const pausedBefore=actions.filter(a=>a==="pause").length;
    key("KeyP"); key("KeyO"); assert.equal(actions.filter(a=>a==="pause").length,pausedBefore+1);
    input.reset(); input.settings.invertMouse=true;
    key("KeyW"); assert.equal(input.sample(0).pitch,-1, "mouse inversion leaves keyboard alone");
    input.reset(); input.locked=true;
    const move=new Event("mousemove"); Object.defineProperties(move,{movementX:{value:0},movementY:{value:10}});
    doc.dispatchEvent(move); assert.ok(Math.abs(input.sample(0).pitch + 0.09)<1e-9, "default mouse gain is doubled and inverted");
    input.reset(); input.settings.invertGamepad=true;
    pads=[{connected:true,axes:[0,0.5],buttons:[]}]; assert.ok(input.sample(0).pitch<0);
    pads=[{connected:true,axes:[0.1,0.1],buttons:[]}]; assert.equal(input.sample(0).pitch,0);
    doc.querySelector=()=>({open:true});
    const before=actions.length; key("KeyO"); key("KeyG");
    pads=[{connected:true,axes:[1,1],buttons:Array.from({length:8},()=>({pressed:true,value:1}))}];
    assert.deepEqual(input.sample(0),{pitch:0,roll:0,boost:0,brake:0});
    assert.equal(actions.length,before,"a settings dialog blocks keyboard and gamepad actions");
  } finally {
    input.dispose(); delete globalThis.window; delete globalThis.document;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  }
});

test("touch stick and buttons, and tilt angles from the direction of gravity", async () => {
  const { tiltAngles } = await import("../src/game/tilt.ts");
  const win = new EventTarget(), doc = new EventTarget();
  doc.body = win; doc.hasFocus = () => true;
  globalThis.window = win; globalThis.document = doc;
  const input = new Input({}, {invertPitch:false, mouseSensitivity:1});
  try {
    input.touchX = 0.5; input.touchY = -1; input.touchBoost = true;
    assert.deepEqual(input.sample(0), {pitch:-1, roll:0.5, boost:1, brake:0}, "thumb up dives, like a stick pushed forward");
    input.settings.invertTouch = true;
    assert.equal(input.sample(0).pitch, 1);
    input.reset();
    assert.deepEqual(input.sample(0), {pitch:0, roll:0, boost:0, brake:0});
  } finally {
    input.dispose(); delete globalThis.window; delete globalThis.document;
  }

  const deg = radians => radians * 180 / Math.PI, out = {roll:0, lean:0};
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);
  // Portrait, flat on a table, then stood upright
  tiltAngles(0, 0, 0, out); near(deg(out.lean), 0, "flat"); near(deg(out.roll), 0, "flat roll");
  tiltAngles(90, 0, 0, out); near(deg(out.lean), 90, "upright");
  // Landscape (turned anticlockwise, angle 90), leaning back 50° from flat: no roll
  tiltAngles(0, -50, 90, out); near(deg(out.lean), 50, "landscape lean"); near(deg(out.roll), 0, "landscape roll");
  // ...then its right edge dipped: beta is the wheel there, and turns right
  tiltAngles(20, -50, 90, out); assert.ok(out.roll > 0.1, "right edge down turns right");
  tiltAngles(-20, -50, 90, out); assert.ok(out.roll < -0.1);
  // The other landscape mirrors both sensor axes; the screen's own angles agree
  tiltAngles(0, 50, 270, out); near(deg(out.lean), 50, "other landscape lean");
  tiltAngles(-20, 50, 270, out); assert.ok(out.roll > 0.1, "other landscape, right edge down");
  // Past upright (gamma flips sign and beta jumps by 180 there): the lean carries on smoothly
  tiltAngles(180, 80, 90, out); near(deg(out.lean), 100, "past upright");
});
