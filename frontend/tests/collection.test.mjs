import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Scene } from "three";
import { COLLECTION_DISTANCE, Collection, collectionModel, placeCollection, sweptPickup } from "../src/game/run/collection.ts";
import { World } from "../src/game/world/World.ts";
import { runLevel } from "../src/game/world/biomes/index.ts";
import { CAPES, HATS, SHOES, WINGS } from "../src/game/cosmetics/catalog.ts";
import { PETS } from "../src/game/pets/catalog.ts";
import { ITEMS } from "../src/game/items/models.ts";

const reward = (rarity, slot = 0, kind = "item", asset = "goldenFeather") => ({
  id: `1:t${slot}`, level: 1, anchor: (slot + .5) / 6, angle: slot * 1.4, key: `${kind}:${asset}`, kind, asset, name: asset, rarity, xp: 55, crystals: 0,
});

test("fast passes collect with a segment test, misses and zero-length steps do not", () => {
  const point = new Vector3(0, 0, 0);
  assert.equal(sweptPickup(new Vector3(-5,0,0), new Vector3(5,0,0), point), true);
  assert.equal(sweptPickup(new Vector3(-5,4,0), new Vector3(5,4,0), point), false);
  assert.equal(sweptPickup(new Vector3(1,0,0), new Vector3(1,0,0), point), true);
  assert.equal(sweptPickup(new Vector3(7,0,0), new Vector3(7,0,0), point), false);
});

test("rarity controls distance to hoops, placement is reproducible and stays out of terrain in every biome", () => {
  for (const biome of ["skyIsles", "verdant", "glacier", "archipelago", "lagoon", "twilight", "ember", "aurora", "reef"]) {
    for (const seed of [2,7,42]) {
      const world = new World(runLevel(seed, 1, biome));
      const rewards = Array.from({length: 18}, (_,i) => reward(["common", "uncommon", "rare", "legendary"][i%4], i%6));
      const before = world.course.rings.map(r => r.position.toArray());
      const pickups = placeCollection(world, rewards);
      assert.ok(pickups.length >= 4, `${biome} ${seed}: ${pickups.length}`);
      assert.deepEqual(pickups.map(p=>p.position.toArray()), placeCollection(world, rewards).map(p=>p.position.toArray()));
      assert.deepEqual(world.course.rings.map(r=>r.position.toArray()), before);
      for (const p of pickups) {
        const d = Math.min(...world.course.rings.filter(r=>!r.finish).map(r=>r.position.distanceTo(p.position)));
        const [min,max] = COLLECTION_DISTANCE[p.reward.rarity];
        assert.ok(d >= min && d < max, `${biome}: ${d}`);
        assert.ok(world.distance(p.position.x, p.position.y, p.position.z) >= 5);
        assert.equal(world.lost(p.position.y,p.position.z), false);
      }
    }
  }
});

test("each pickup collects once, respawn teleports do not collect and hidden transitions do not draw", () => {
  const world = new World(runLevel(42, 1, "skyIsles")), scene = new Scene();
  const collection = new Collection(world, Array.from({length: 6}, (_, i) => reward("uncommon", i)), scene);
  assert.ok(collection.pickups.length);
  const p = collection.pickups[0].position;
  const collected = [], particles = {budget: 1, emit: () => {}};
  collection.step(p.clone().add(new Vector3(-30,0,0)),p.clone().add(new Vector3(30,0,0)),r=>collected.push(r),particles);
  assert.equal(collected.length,0);
  collection.step(p.clone().add(new Vector3(-5,0,0)),p.clone().add(new Vector3(5,0,0)),r=>collected.push(r),particles);
  collection.step(p,p,r=>collected.push(r),particles);
  assert.equal(collected.length,1);
  collection.frame(1/60,p,false); assert.equal(collection.group.visible,false);
  collection.dispose(); assert.equal(scene.children.length,0);
});

test("every catalog entry has finite pickup geometry, including the new crystal cluster and cape tokens", () => {
  const entries = [{kind:"crystal",asset:"crystal"}, ...CAPES.map(e=>({kind:"cape",asset:e.id})), ...WINGS.map(e=>({kind:"wings",asset:e.id})),
    ...HATS.filter(e=>e.id!=="none").map(e=>({kind:"hat",asset:e.id})),
    ...SHOES.filter(e=>e.id!=="classic").map(e=>({kind:"shoes",asset:e.id})),
    ...PETS.filter(e=>e.id!=="none").map(e=>({kind:"pet",asset:e.id})), ...ITEMS.map(e=>({kind:"item",asset:e.id}))];
  for (const entry of entries) {
    const model = collectionModel({...entry,rarity:"rare"});
    let count=0;
    model.group.traverse(o=>{ if(o.isMesh) { count++; assert.ok(o.geometry.attributes.position.array.every(Number.isFinite)); } });
    assert.ok(count>0); model.animate?.(1/60); model.dispose();
  }
});

test("newly streamed obstacles hide unsafe pickups and prevent collection", () => {
  const world = new World(runLevel(7,1,"verdant")), scene = new Scene();
  const collection = new Collection(world, Array.from({length:6},(_,i)=>reward("uncommon",i)),scene);
  assert.ok(collection.pickups.length);
  const p=collection.pickups[0].position;
  const distance=world.distance.bind(world);
  world.distance=(x,y,z)=>Math.min(distance(x,y,z),Math.hypot(x-p.x,y-p.y,z-p.z)-2);
  const collected=[];
  collection.step(p,p,r=>collected.push(r),{budget:1,emit:()=>{}});
  collection.frame(1/60,p,true);
  assert.equal(collected.length,0);
  assert.equal(collection.group.children[0].visible,false);
  assert.equal(collection.pickups[0].collected,false);
  collection.dispose();
});

test("only manifest-bearing adventures collect; crashes keep claims and portal phases stop collection", async () => {
  const {RunController}=await import("../src/game/run/controller.ts");
  const {Flight}=await import("../src/game/flight.ts");
  const {PerspectiveCamera}=await import("three");
  const world=new World(runLevel(7,1,"verdant")), rewards=Array.from({length:6},(_,i)=>reward("uncommon",i));
  const host={scene:new Scene(),flight:new Flight(),prevPosition:new Vector3(),camera:new PerspectiveCamera(),world,
    view:{setRings:()=>{}},style:0,particles:{budget:1,emit:()=>{}},setLevel:()=>{},
    freeze:()=>{},veil:()=>{},insideWormhole:()=>{},whiteOut:()=>{},stinger:()=>{},portalHum:()=>{},pixelHeight:720};
  const unsaved=new RunController(7,host,{}); unsaved.start(world.level);
  assert.equal(unsaved.collection,null,"the test/explore controller has no persistent pickups"); unsaved.dispose();
  const found=[];
  const run=new RunController(7,host,{rewards,collected:r=>found.push(r.id)});run.start(world.level);
  assert.ok(run.collection.pickups.length);
  const p=run.collection.pickups[0].position;
  host.flight.position.copy(p); host.prevPosition.copy(p);
  run.phase="pick";run.step(1/120);assert.equal(found.length,0);
  run.phase="explore";run.step(1/120);assert.equal(found.length,1);
  run.crashed();run.step(1/120);assert.equal(found.length,1);
  run.dispose();
});
