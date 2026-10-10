import test from "node:test";
import assert from "node:assert/strict";
import { WINGS } from "../src/game/cosmetics/catalog.ts";
import { wingToken, buildWing } from "../src/game/cosmetics/wings.ts";
import { SANDBOX_COLLECTION } from "../src/game/cosmetics/sandbox.ts";
import { disposeModel } from "../src/game/cosmetics/models.ts";

test("decorated wings have distinct bounded geometry, mirrored fans and finite toon attributes", () => {
  const signatures = new Set();
  for (const spec of WINGS) {
    const model = wingToken(spec.id), positions = [], geometries = new Set();
    model.updateMatrixWorld(true);
    let vertices = 0;
    model.traverse(o => {
      if (!o.isMesh || geometries.has(o.geometry)) return;
      geometries.add(o.geometry);
      for (const name of ["position", "normal", "color", "glow"]) assert.ok(o.geometry.attributes[name].array.every(Number.isFinite));
      vertices += o.geometry.attributes.position.count;
      positions.push(...o.geometry.attributes.position.array);
    });
    assert.ok(vertices > 1000 && vertices < 20000);
    signatures.add(JSON.stringify(positions));
    const left = buildWing(spec.id,-1), right = buildWing(spec.id,1);
    const lp=left.outer.children[0].geometry.attributes.position, rp=right.outer.children[0].geometry.attributes.position;
    assert.equal(lp.count,rp.count);
    let lx=0, rx=0; for(let i=0;i<lp.count;i++) { lx+=lp.getX(i)*left.outer.scale.x; rx+=rp.getX(i)*right.outer.scale.x; }
    assert.ok(Math.abs(lx + rx) < 1e-3, spec.id);
    let disposed=0; for(const geometry of geometries) geometry.addEventListener("dispose",()=>disposed++);
    disposeModel(model); assert.equal(disposed,geometries.size); left.dispose();right.dispose();
  }
  assert.ok(signatures.size >= 6);
});

test("the offline sandbox exposes every item, cosmetic and existing pet without a solo-flight entry", async () => {
  assert.equal(SANDBOX_COLLECTION.length,46);
  assert.equal(new Set(SANDBOX_COLLECTION.map(e=>e.key)).size,46);
  assert.equal(SANDBOX_COLLECTION.filter(e=>e.kind==="pet").length,8);
  assert.ok(!SANDBOX_COLLECTION.some(e=>e.key==="pet:none"));
  assert.ok(SANDBOX_COLLECTION.every(e=>e.xp===0));
  const {ExploreSession}=await import("../src/session/ExploreSession.ts");
  const calls=[];
  const session=Object.create(ExploreSession.prototype);
  session.game={testAppearance:look=>calls.push(["look",look]),equip:id=>calls.push(["item",id]),useItem:()=>calls.push(["use"]),setThrust:()=>{}};
  session.testMode=false;
  session.previewAppearance({wings:"astral"}); session.previewItem("firework");session.previewUseItem();
  assert.deepEqual(calls,[]);
  session.testMode=true;
  session.previewAppearance({wings:"astral"});session.previewItem("firework");session.previewUseItem();
  assert.deepEqual(calls,[["look",{wings:"astral"}],["item","firework"],["use"]]);
});
