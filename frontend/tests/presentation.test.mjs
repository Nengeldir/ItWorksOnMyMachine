import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { Trail } from "../src/game/trail.ts";
import { GhostRecorder, ghostSamples } from "../src/game/ghost.ts";
import { CameraRig } from "../src/game/camera.ts";
import { CAMERA } from "../src/game/tuning.ts";

test("slow frame-to-frame movement still produces a trail", () => {
  const trail = new Trail("#ffffff"), point = new Vector3(), side = new Vector3(1,0,0);
  for (let i=0; i<60; i++) { point.z -= 0.25; trail.push(point, side); }
  trail.opacity = 1;
  assert.equal(trail.mesh.visible, true);
  const positions = trail.mesh.geometry.getAttribute("position").array;
  assert.ok(Math.abs(positions[2] - positions[positions.length-1]) > 10);
  trail.dispose();
});

test("new ghosts retain controls and old ghosts decode with neutral controls", () => {
  const recorder = new GhostRecorder(), pos = new Vector3(), q = new Quaternion();
  recorder.record(0, pos, q, 0.8, 0);
  const data = recorder.finish(100, pos, q, 0, 0.6);
  assert.equal(ghostSamples(data)[0].boost, 0.8);
  assert.equal(ghostSamples(data)[1].brake, 0.6);
  const legacy = ghostSamples({hz:15, samples:[[0,0,0,0,0,0,0,1]]});
  assert.equal(legacy[0].boost, 0); assert.equal(legacy[0].brake, 0);
});

test("boost plus gate FOV is bounded and respawn removes the kick", () => {
  const rig = new CameraRig(1), pos = new Vector3(), fwd = new Vector3(0,0,-1), up = new Vector3(0,1,0);
  rig.snap(pos,fwd,up,150); rig.kick(30);
  rig.update(1/60,pos,fwd,up,150,0,null,fwd,1);
  assert.ok(rig.camera.fov <= CAMERA.fov + CAMERA.fovMax);
  rig.snap(pos,fwd,up,30); assert.equal(rig.camera.fov, CAMERA.fov);
});
