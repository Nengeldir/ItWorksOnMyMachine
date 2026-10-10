import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { Flight, touching } from "../src/game/flight.ts";
import { CameraRig } from "../src/game/camera.ts";
import { GlideIn } from "../src/game/glidein.ts";

test("body and wing collision probes follow the flight orientation", () => {
  const p = new Vector3(), local = new Vector3(), q = new Quaternion();
  assert.equal(touching(() => 10, p, q, 10, local), null);
  assert.equal(touching((x,y,z) => z + 0.6, p, q, 0.6, local), "body");
  assert.equal(touching(x => 2 - x, p, q, 2, local), "right");
  assert.equal(touching(x => 2 + x, p, q, 2, local), "left");
  q.setFromAxisAngle(new Vector3(0,0,1), Math.PI);
  assert.equal(touching(x => 2 - x, p, q, 2, local), "left");
});

test("crash camera recovers to the normal chase camera on respawn", () => {
  const rig = new CameraRig(1), p = new Vector3(), forward = new Vector3(0,0,-1), up = new Vector3(0,1,0);
  rig.snap(p, forward, up, 40);
  rig.startFall(p);
  for (let i=0;i<120;i++) {
    p.y -= 0.1;
    rig.fall(p, 1/60, () => 100);
    assert.ok(rig.camera.quaternion.toArray().every(Number.isFinite));
  }
  assert.ok(rig.camera.position.y > p.y + 5);
  rig.snap(new Vector3(), forward, up, 40);
  const fresh = new CameraRig(1); fresh.snap(new Vector3(), forward, up, 40);
  assert.ok(rig.camera.position.distanceTo(fresh.camera.position) < 1e-8);
  assert.ok(rig.camera.quaternion.angleTo(fresh.camera.quaternion) < 1e-7);
});

test("loading glide stops before a gate and hands over to reset flight controls", () => {
  const f = new Flight(), glide = new GlideIn();
  f.reset(new Vector3(), new Vector3(0,0,-1), 40);
  glide.start(f, [{position:new Vector3(0,0,-50)}]);
  for (let i=0;i<600;i++) glide.update(1/60, f, () => 100);
  assert.ok(glide.travelled <= 20 && glide.travelled > 15);
  glide.stop(); f.reset(f.position, glide.heading, 35);
  f.step(1/120, {pitch:0, roll:0, boost:1}, 0);
  assert.ok(f.boost > 0 && f.boostCharge < 1);
  assert.ok(f.dodge(1));
  assert.ok(f.position.toArray().every(Number.isFinite));
});
