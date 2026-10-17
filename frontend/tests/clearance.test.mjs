import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from "three";

// The avatar paints glow textures on canvases: a stub 2D context is all it needs outside a browser
const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => ({ addColorStop() {} }), set: (target, key, value) => { target[key] = value; return true; } });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };

const { Avatar, loadClearance } = await import("../src/game/avatar.ts");
// Its own chunk in the game: loaded here up front
await loadClearance();
const { Equipment } = await import("../src/game/items/equip.ts");
const { Clearance } = await import("../src/game/items/clearance.ts");

test("a carried item's clearance is solid inside, empty outside, and grows by its margin", () => {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(0.4, 0.2, 0.2), new MeshBasicMaterial()));
  const exact = Clearance.of(group, 0.01, 0), padded = Clearance.of(group, 0.01, 2);
  assert.ok(exact.inside(new Vector3(0, 0, 0)), "the middle of a closed shape is filled in");
  assert.ok(exact.inside(new Vector3(0.18, 0.08, -0.08)));
  assert.ok(!exact.inside(new Vector3(0.23, 0, 0)));
  assert.ok(padded.inside(new Vector3(0.215, 0, 0)), "the margin keeps things off its surface");
  assert.ok(!padded.inside(new Vector3(0.26, 0, 0)));
  assert.ok(exact.near(new Vector3(0.5, 0, 0), 0.31) && !exact.near(new Vector3(0.5, 0, 0), 0.2));
});

/** Vertices of `root` (wings, cape) inside the exact solid of what's worn on the back */
function inside(avatar, shape, roots) {
  const item = avatar.slots.back.children[0];
  item.updateWorldMatrix(true, true);
  const toItem = new Matrix4().copy(item.matrixWorld).invert(), v = new Vector3();
  let count = 0;
  for (const root of roots) root.traverse((o) => {
    if (!o.isMesh || o.parent?.isMesh) return;
    for (let n = o; n; n = n.parent) if (!n.visible) return;
    const position = o.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
      if (shape.inside(v.applyMatrix4(o.matrixWorld).applyMatrix4(toItem))) count++;
    }
  });
  return count;
}

test("wings, cape and scarf keep out of the firework on the back through flaps, dives and folds", () => {
  for (const wings of ["classic", "seraph", "butterfly"]) {
    for (const pose of ["glide", "dive", "stand", "brake"]) {
      const avatar = new Avatar("#4aa3ff");
      avatar.setAppearance({ cape: "royal", hat: "none", shoes: "classic", wings, pet: "none", jar: "none" });
      const equipment = new Equipment(avatar, null);
      equipment.equip("firework", true);
      let shape = null, touching = 0;
      for (let frame = 0; frame < 150; frame++) {
        if (pose === "dive") avatar.group.rotation.set(-0.8, 0, 0);
        if (pose === "stand") avatar.stance.stand = 1;
        avatar.setSpeedControls(0, pose === "brake" ? 1 : 0);
        avatar.group.updateMatrixWorld(true);
        avatar.update(1 / 60, 70, 0);
        equipment.update(1 / 60);
        if (frame < 60) continue;
        if (!shape) {
          // The rocket's exact shape, measured off the pilot
          const item = avatar.slots.back.children[0], parent = item.parent, at = item.position.clone();
          parent.remove(item); item.position.set(0, 0, 0);
          shape = Clearance.of(item, 0.008, 0);
          item.position.copy(at); parent.add(item);
        }
        avatar.group.updateMatrixWorld(true);
        touching += inside(avatar, shape, [avatar.right.wing, avatar.left.wing, avatar.cape.mesh, ...avatar.scarf.map((s) => s.mesh)]);
      }
      assert.equal(touching, 0, `${wings} wings ${pose}: ${touching} vertices inside the rocket`);
    }
  }
});

test("putting the item away frees the wings and the cape again", () => {
  const avatar = new Avatar("#4aa3ff");
  const equipment = new Equipment(avatar, null);
  equipment.equip("firework", true);
  for (let frame = 0; frame < 60; frame++) { avatar.group.updateMatrixWorld(true); avatar.update(1 / 60, 40, 0); equipment.update(1 / 60); }
  assert.ok(avatar.carried.back && avatar.backFront, "settled on the back");
  equipment.unequip("back");
  equipment.update(1 / 60);
  assert.equal(avatar.carried.back, null);
  assert.equal(avatar.backFront, null);
});
