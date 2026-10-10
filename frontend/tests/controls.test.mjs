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


test("signed tilt separates both sides of flat and keeps landscape wheel turns independent of pitch", async () => {
  const { tiltAngles } = await import("../src/game/tilt.ts");
  const out = { roll: 0, lean: 0 }, rad = Math.PI / 180;
  for (const [screenAngle, sign] of [[0, 1], [90, -1], [270, 1]]) {
    for (const degrees of [-60, -15, 0, 15, 60]) {
      const beta = screenAngle === 0 ? degrees : 0;
      const gamma = screenAngle === 0 ? 0 : degrees * sign;
      tiltAngles(beta, gamma, screenAngle, out);
      assert.ok(Math.abs(out.lean - degrees * rad) < 1e-9, `signed lean at ${screenAngle} / ${degrees}`);
    }
  }
  tiltAngles(0, -50, 90, out);
  const lean = out.lean;
  for (const beta of [-30, 30]) {
    tiltAngles(beta, -50, 90, out);
    assert.ok(Math.abs(out.lean - lean) < 1e-9, "banking alone does not pitch");
  }
});

test("tutorial observes merged input and real one-off actions, and unsubscribes cleanly", () => {
  const win = new EventTarget(), doc = new EventTarget();
  doc.hasFocus = () => true;
  globalThis.window = win; globalThis.document = doc;
  const input = new Input({}, { invertPitch: false, mouseSensitivity: 1 });
  const samples = [], observed = [], actions = [];
  input.onAction = action => actions.push(action);
  const stop = input.observe({ sample: value => samples.push(value), action: action => observed.push(action) });
  try {
    input.touchY = -0.8; input.touchX = 0.7; input.touchBoost = true;
    const sample = input.sample(0);
    assert.equal(samples[0], sample, "coach sees exactly the input sent to flight");
    input.settings.invertTouch = true;
    assert.equal(input.sample(0).pitch, 0.8, "coach sees inverted pitch too");
    for (const action of ["barrelLeft", "plunge", "burst"]) input.dispatchAction(action);
    assert.deepEqual(observed, actions);
    doc.querySelector = () => ({ open: true });
    input.dispatchAction("barrelRight"); input.sample(0);
    assert.equal(observed.length, 3, "dialogs cannot advance tutorial or fire actions");
    assert.equal(samples.length, 2);
    doc.querySelector = () => null;
    stop(); input.sample(0); input.dispatchAction("hover");
    assert.equal(samples.length, 2); assert.equal(observed.length, 3);
    assert.equal(actions.at(-1), "hover", "removing coach leaves gameplay intact");
  } finally {
    stop(); input.dispose(); delete globalThis.window; delete globalThis.document;
  }
});

test("tilt calibrates both axes, reads flat-hold pitch both ways, and recenters on rotation", async () => {
  const { tilt } = await import("../src/game/tilt.ts");
  const win = new EventTarget(); win.DeviceOrientationEvent = class {};
  const saved = Object.fromEntries(["window", "DeviceOrientationEvent", "screen", "localStorage"].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  globalThis.window = win; globalThis.DeviceOrientationEvent = win.DeviceOrientationEvent;
  globalThis.screen = { orientation: { angle: 90 } };
  globalThis.localStorage = { setItem() {}, getItem() { return "0"; } };
  const reading = (beta, gamma) => {
    const e = new Event("deviceorientation"); Object.assign(e, { beta, gamma }); win.dispatchEvent(e);
  };
  try {
    assert.equal(await tilt.enable(), true);
    reading(12, 0);
    assert.equal(tilt.roll, 0); assert.equal(tilt.pitch, 0, "initial bank and pitch are neutral");
    reading(12, -20); assert.ok(tilt.pitch > 0, "top towards you climbs from flat");
    tilt.recenter(); reading(0, 0); reading(0, 20);
    assert.ok(tilt.pitch < 0, "top away dives from flat");
    tilt.recenter(); reading(10, -50);
    assert.equal(tilt.pitch, 0); assert.equal(tilt.roll, 0);
    screen.orientation.angle = 270; reading(-10, 50);
    assert.equal(tilt.pitch, 0); assert.equal(tilt.roll, 0, "rotation recalibrates the new hold");
  } finally {
    tilt.disable();
    for (const [k, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k];
    }
  }
});
