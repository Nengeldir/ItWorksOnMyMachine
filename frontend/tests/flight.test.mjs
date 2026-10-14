import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Flight, FLIGHT, plainMods } from "../src/game/flight.ts";
import { CameraRig } from "../src/game/camera.ts";

const make = (speed = 40) => { const f = new Flight(); f.reset(new Vector3(), new Vector3(0, 0, -1), speed); return f; };
const fly = (f, seconds, input = {}, params = FLIGHT, mods = null) => {
  for (let i = 0; i < seconds * 120; i++) f.step(1 / 120, {pitch: 0, roll: 0, ...input}, 0, params, mods);
};

test("gravity and drag are integrated once, including upgrade modifiers", () => {
  const f = make();
  const p = {...FLIGHT, gravity: 0, sink: 0, glideDrag: 0};
  fly(f, 1, {}, p);
  const analytical = 40 / (1 + p.drag * 40);
  assert.ok(Math.abs(f.speed - analytical) < 0.001);
  const normal = make(), upgraded = make();
  fly(normal, 2); fly(upgraded, 2, {}, FLIGHT, plainMods());
  assert.ok(normal.position.distanceTo(upgraded.position) < 1e-8);
});

test("boost accelerates, exhausts without pulsing, and recharges after release", () => {
  const normal = make(), boosted = make();
  fly(normal, 1); fly(boosted, 1, {boost: 1});
  assert.ok(boosted.speed > normal.speed + 15);
  fly(boosted, 4, {boost: 1});
  assert.equal(boosted.boostCharge, 0); assert.equal(boosted.boost, 0);
  fly(boosted, 1); assert.ok(boosted.boostCharge > 0.2);
  fly(boosted, 0.2, {boost: 1}); assert.ok(boosted.boost > 0.5);
});

test("brake wins, slows smoothly, retains steering and tapers at low speed", () => {
  const f = make(60); fly(f, 1, {boost: 1, brake: 1, roll: 0.2});
  assert.equal(f.boost, 0); assert.equal(f.boostCharge, 1);
  assert.ok(f.speed < 40 && f.speed > 20); assert.ok(Math.abs(f.bank) > 0.1);
  const low = make(20), coast = make(20);
  const p = {...FLIGHT, gravity: 0, drag: 0, sink: 0};
  fly(low, 2, {brake: 1}, p); fly(coast, 2, {}, p);
  assert.equal(low.speed, coast.speed);
});

test("respawn clears controls and restores reserve", () => {
  const f = make(); fly(f, 1, {boost: 1});
  f.reset(new Vector3(), new Vector3(0, 0, -1), 35);
  assert.equal(f.boost, 0); assert.equal(f.brake, 0); assert.equal(f.boostCharge, 1);
});

test("camera detects a wall between clear endpoints and eases out", () => {
  const rig = new CameraRig(1), pos = new Vector3(), forward = new Vector3(0, 0, -1), up = new Vector3(0, 1, 0);
  rig.snap(pos, forward, up, 40);
  rig.update(1/60, pos, forward, up, 40, 0, (x,y,z) => Math.abs(z - 5) - 0.5);
  assert.ok(rig.camera.position.z < 4.5);
  const before = rig.camera.position.z;
  rig.update(1/60, pos, forward, up, 40, 0, () => 100);
  assert.ok(rig.camera.position.z > before && rig.camera.position.z < 6);
});


test("dive, inverted turn and low-speed recovery stay finite", () => {
  const f = make(10);
  for (let i = 0; i < 3600; i++) {
    f.step(1/120, {pitch: Math.sin(i/90), roll: Math.cos(i/110), brake: i%600 < 120 ? 1 : 0, boost: i%600 > 400 ? 1 : 0}, 0.5);
    assert.ok(Number.isFinite(f.speed) && f.speed >= 0);
    assert.ok(f.position.toArray().every(Number.isFinite));
    assert.ok(Math.abs(f.quaternion.length() - 1) < 1e-8);
  }
});

test("overspeed is dissipated rather than clamped instantly", () => {
  const f = make(150); f.step(1/120, {pitch:0, roll:0}, 0);
  assert.ok(f.speed > FLIGHT.maxSpeed && f.speed < 150);
});


test("held steering never exceeds 80 degrees, turns continuously, and levels on release", () => {
  for (const dir of [-1,1]) {
    const f = make();
    for (let i=0;i<1200;i++) {
      f.step(1/120, {pitch:0, roll:dir}, 0);
      assert.ok(Math.abs(f.bank) <= 80 * Math.PI/180 + 1e-10);
      assert.ok(f.up.y > 0);
    }
    assert.ok(Math.abs(f.forward.x) > 0.1);
    fly(f,2); assert.ok(Math.abs(f.bank) < 0.01);
  }
});

test("Q/E dodge moves exactly its 8 metres at different speeds and step sizes without changing heading", () => {
  for (const dir of [-1,1]) for (const speed of [20,80]) for (const dt of [1/120,1/60,0.013]) {
    const f=make(speed), normal=make(speed);
    assert.equal(f.dodge(dir), true); assert.equal(f.dodge(-dir), false);
    for (let t=0;t<0.8;t+=dt) {
      f.step(dt,{pitch:0,roll:0},0); normal.step(dt,{pitch:0,roll:0},0);
    }
    const displacement=f.position.clone().sub(normal.position);
    assert.ok(Math.abs(displacement.x-dir*FLIGHT.dodgeDistance)<1e-9);
    assert.equal(FLIGHT.dodgeDistance, 8);
    assert.ok(Math.abs(displacement.y)+Math.abs(displacement.z)<1e-9);
    assert.ok(f.quaternion.angleTo(normal.quaternion)<1e-7);
    assert.equal(f.dodgePhase,0); assert.equal(f.dodge(dir),false);
    fly(f,0.3); assert.equal(f.dodge(dir),true);
  }
});

test("dodge displacement passes through obstacles incrementally and resets on respawn", () => {
  const f=make(); f.dodge(1); let crossedWall=false; let before=0;
  for(let i=0;i<72;i++) {
    f.step(1/120,{pitch:0,roll:0},0);
    if(before<2.5 && f.position.x>=2.5) crossedWall=true;
    // Never a teleport: at most its peak speed (1.5 × length / duration) times one step
    assert.ok(f.position.x-before < 0.21); before=f.position.x;
  }
  assert.equal(crossedWall,true);
  f.reset(new Vector3(),new Vector3(0,0,-1),40);
  assert.equal(f.dodgePhase,0); assert.equal(f.dodge(-1),true);
});


test("released pitch recovers from a half loop smoothly without changing the nose direction", () => {
  const p = {...FLIGHT, gravity: 0, drag: 0, sink: 0};
  for (const direction of [-1, 1]) for (const dt of [1/30, 1/60, 1/120]) {
    const f = make();
    const steps = 120;
    for (let i=0; i<steps; i++) f.step(Math.PI / p.pitchRate / steps, {pitch:direction, roll:0}, 0, p);
    assert.ok(f.up.y < -0.999, "held pitch must permit a half loop");
    const nose = f.forward.clone();
    for (let i=0; i<5/dt; i++) {
      const before = f.quaternion.clone();
      f.step(dt, {pitch:0, roll:0}, 0, p);
      assert.ok(before.angleTo(f.quaternion) <= p.rollRate * dt + 1e-7, "no instant upright flip");
      assert.ok(f.forward.distanceTo(nose) < 1e-8, "recovery preserves heading and pitch");
    }
    assert.ok(f.up.y > 0.999, "pilot must finish right side up");
  }
});

test("upright recovery stays finite and continuous at both vertical poles", () => {
  const p = {...FLIGHT, gravity:0, drag:0, sink:0};
  for (const direction of [-1, 1]) {
    const f = make();
    f.step(Math.PI / (2*p.pitchRate), {pitch:direction, roll:0}, 0, p);
    const before = f.quaternion.clone();
    fly(f, 2, {}, p);
    assert.ok(f.quaternion.toArray().every(Number.isFinite));
    assert.ok(before.angleTo(f.quaternion) < 1e-7);
  }
});
