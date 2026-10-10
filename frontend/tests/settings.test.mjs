import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, normalizeSettings, loadSettings, saveSettings } from "../src/storage.ts";
import { bindingLabel, defaultBindings } from "../src/game/bindings.ts";

test("settings migrate old inversion and preserve chosen sensitivity", () => {
  assert.equal(defaultSettings().mouseSensitivity, 2);
  const s = normalizeSettings({nickname:"Pilot", invertPitch:true, mouseSensitivity:1.4});
  assert.equal(s.invertMouse,true); assert.equal(s.invertGamepad,true);
  assert.equal(s.mouseSensitivity,1.4); assert.equal(s.nickname,"Pilot");
  assert.equal(normalizeSettings({...s,invertMouse:false}).invertMouse,false);
});
test("malformed settings fall back safely and binding conflicts cannot persist", () => {
  for (const value of [null, [], "oops", 7]) assert.deepEqual(normalizeSettings(value),defaultSettings());
  const bindings=defaultBindings(); bindings.boost=["KeyP"];
  const s=normalizeSettings({mouseSensitivity:999,deadZone:-1,quality:"ultra",bindings});
  assert.equal(s.mouseSensitivity,6); assert.equal(s.deadZone,0); assert.equal(s.quality,"auto");
  assert.deepEqual(s.bindings,defaultBindings());
  assert.equal(normalizeSettings({mouseSensitivity:NaN}).mouseSensitivity,2);
});
test("bindings and preferences survive save/reload without sharing default arrays", () => {
  const old=globalThis.localStorage; let data;
  globalThis.localStorage={getItem:()=>data,setItem:(_key,value)=>{data=value;}};
  try {
    const s=defaultSettings(); s.bindings.boost=["KeyG"]; s.invertMouse=true;
    saveSettings(s); const loaded=loadSettings();
    assert.deepEqual(loaded,s); assert.equal(bindingLabel(loaded.bindings,"boost"),"G");
    assert.deepEqual(defaultSettings().bindings.boost,["ShiftLeft","ShiftRight"]);
    data="{bad json"; assert.deepEqual(loadSettings(),defaultSettings());
    globalThis.localStorage={getItem:()=>{throw Error();},setItem:()=>{throw Error();}};
    assert.doesNotThrow(()=>saveSettings(s)); assert.deepEqual(loadSettings(),defaultSettings());
  } finally { if(old===undefined) delete globalThis.localStorage; else globalThis.localStorage=old; }
});


test("reduced camera motion suppresses speed and gate field-of-view effects", async () => {
  const { CameraRig } = await import("../src/game/camera.ts");
  const { CAMERA } = await import("../src/game/tuning.ts");
  const { Vector3 } = await import("three");
  const camera=new CameraRig(1); camera.reducedMotion=true;
  const position=new Vector3(), forward=new Vector3(0,0,-1), up=new Vector3(0,1,0);
  camera.snap(position,forward,up,120); camera.kick(10);
  for(let i=0;i<120;i++) camera.update(1/60,position,forward,up,120,1,null,undefined,1);
  assert.equal(camera.camera.fov,CAMERA.fov);
});
