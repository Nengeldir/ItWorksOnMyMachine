import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Items, ITEM, RUN_ITEMS } from '../src/game/run/items.ts';
import { placePickups, pickupHeight, pickupClear } from '../src/game/run/pickups.ts';
import { Flight, plainMods } from '../src/game/flight.ts';
import { Course } from '../src/game/world/course.ts';
import { World } from '../src/game/world/World.ts';
import { runLevel } from '../src/game/world/biomes/index.ts';
const setup=(distance=()=>100)=>{
 const items=new Items(),course=new Course(7);items.setLevel({seed:7,course,distance});
 const flight=new Flight();flight.reset(course.start,course.startDirection,40);return {items,flight};
};
const use=(items,flight,id)=>{items.give(id);assert.equal(items.use(flight),id);};
const step=(items,flight,dt=1/120,input={},near=0)=>{const mods=plainMods();items.step(dt,{pitch:0,roll:0,...input},near,flight,mods);return mods;};
test('kite lift, timer freeze, nectar refill and phase expire independently',()=>{
 const {items,flight}=setup();use(items,flight,'stormKite');use(items,flight,'glacialPrism');use(items,flight,'mothCape');
 assert.equal(step(items,flight).lift,ITEM.kiteLift);assert.ok(items.frozenCombo && items.phasing);
 step(items,flight,3.1);assert.equal(items.phasing,false);assert.equal(items.frozenCombo,true);
 step(items,flight,2);assert.equal(items.frozenCombo,false);assert.equal(step(items,flight).lift,0);
 flight.boostCharge=0;use(items,flight,'sunNectar');assert.equal(flight.boostCharge,1);assert.equal(items.restore,ITEM.nectarStamina);
});
test('tether rejects blocked anchors without consuming a charge, then swings without teleporting',()=>{
 const {items,flight}=setup(()=>0);flight.position.copy(items.world.course.rings[0].position).add(new Vector3(25,0,0));items.give('windTether');assert.equal(items.use(flight),null);assert.equal(items.current.charges,1);
 items.world.distance=()=>100;assert.equal(items.use(flight),'windTether');const before=flight.position.clone(),direction=flight.forward.clone();step(items,flight,0.2);assert.ok(flight.position.distanceTo(before)<1e-9);assert.ok(flight.forward.distanceTo(direction)>0.01);
});
test('chimes widen only the next gate and an updraft pad bounces once before collision',()=>{
 const {items,flight}=setup((x,y)=>y+40);use(items,flight,'resonantChimes');items.gate(2);assert.equal(items.widening(3),ITEM.chimeWiden);assert.equal(items.widening(2),0);
 use(items,flight,'crystalUpdraft');assert.ok(Math.abs(items.pad.y+39.8)<0.02);flight.position.copy(items.pad).add(new Vector3(0,4,0));flight.velocity.y=-20;items.beforeFlight(flight);assert.ok(flight.forward.y>0.99);assert.equal(flight.speed,ITEM.padSpeed);assert.equal(items.cue.bounce,1);items.beforeFlight(flight);assert.equal(items.cue.bounce,1);
});
test('hourglass leaves pilot step time normal; lightning is rate limited; held tear releases',()=>{
 const {items,flight}=setup();use(items,flight,'duskHourglass');assert.equal(items.worldRate,ITEM.worldSlow);step(items,flight,1);assert.equal(items.time('duskHourglass'),1);
 use(items,flight,'electroPrism');step(items,flight,0.01,{},0.9);assert.equal(items.cue.lightning,1);const points=items.points;step(items,flight,0.2,{},0.9);assert.equal(items.points,points);step(items,flight,1.6,{},0.9);assert.equal(items.cue.lightning,2);
 use(items,flight,'dragonTear');let mods=step(items,flight,0.2,{use:1});assert.equal(mods.diveAngle,Math.PI/2);assert.ok(mods.thrust>=ITEM.tearThrust);mods=step(items,flight,0.1,{use:0});assert.equal(mods.dive,0);assert.equal(items.time('dragonTear'),-1);
 step(items,flight,5);assert.equal(items.worldRate,1);
});
test('seeded terrain pickups have rarity heights and approach clearance',()=>{
 const course=new Course(7),rock={distance:(x,y,z)=>y-course.y(z)+12};const world={seed:7,course,rock,distance:rock.distance};
 const placements=placePickups(world,RUN_ITEMS);assert.ok(placements.length>=12);
 const snapshot=p=>p.map(i=>[i.id,...i.position.toArray()]);assert.deepEqual(snapshot(placements),snapshot(placePickups(world,RUN_ITEMS)));
 assert.notDeepEqual(snapshot(placements),snapshot(placePickups({...world,seed:8},RUN_ITEMS)));
 for(const p of placements){assert.ok(p.normal.y>0.8);assert.ok(pickupClear(world,p.position));assert.ok(Math.abs(p.position.y-p.floor.y-pickupHeight(RUN_ITEMS.find(i=>i.id===p.id).rarity))<1e-9);}
 for(let i=0;i<3;i++)assert.ok(pickupHeight(i)<pickupHeight(i+1));
});
test('actual run islands support clear pickups without changing course generation',()=>{
 for(const biome of ['skyIsles','verdant','archipelago']){
  const world=new World(runLevel(7,1,biome));const before=world.course.rings.map(r=>r.position.toArray());const placements=placePickups(world,RUN_ITEMS);
  assert.ok(placements.length>=3,`${biome}: ${placements.length}`);
  for(const p of placements){assert.ok(pickupClear(world,p.position));assert.ok(Math.abs(world.rock.distance(...p.floor.toArray()))<0.05);}
  assert.deepEqual(world.course.rings.map(r=>r.position.toArray()),before);
 }
});
test('swept pickup, full bag retention, and respawn do not lose or duplicate items',()=>{
 const {items,flight}=setup();const position=flight.position.clone().add(new Vector3(0,0,10));
 const p={id:'sunNectar',position,floor:position.clone(),normal:new Vector3(0,1,0),collected:false,blocked:false,touching:false};items.pickups.push(p);
 for(const id of ['anemoCatcher','echoConch','gliderWax'])items.give(id);
 step(items,flight);flight.position.z+=20;step(items,flight);assert.equal(p.collected,false);assert.equal(items.cue.full,1);
 flight.position.copy(position);step(items,flight);assert.equal(items.cue.full,1);items.use(flight);step(items,flight);assert.ok(p.collected);assert.equal(items.bag.at(-1).id,'sunNectar');
 items.reset();step(items,flight);assert.equal(items.bag.filter(i=>i.id==='sunNectar').length,1);
 const second={...p,id:'silkRibbon',position:position.clone().add(new Vector3(0,0,10)),collected:false,touching:false};items.pickups.push(second);
 items.bag.length=0;items.reset();flight.position.z+=20;step(items,flight);assert.equal(second.collected,false,'respawn does not sweep across pickups');
 flight.position.z-=20;step(items,flight);assert.ok(second.collected,'fast fly-through sweeps the entire segment');
});
test('blocked air never grants a pickup',()=>{
 const {items,flight}=setup(()=>0);items.pickups.push({id:'anemoCatcher',position:flight.position.clone(),floor:flight.position.clone(),normal:new Vector3(0,1,0),collected:false,blocked:false,touching:false});step(items,flight);assert.equal(items.bag.length,0);assert.ok(items.pickups[0].blocked);
});

test('adventure vegetation leaves the pickup and both approaches clear',async()=>{
 const {placeFlora}=await import('../src/game/world/flora/placement.ts');
 const {Plant}=await import('../src/game/world/trees.ts');
 const {kindInfo}=await import('../src/game/world/structures/kinds.ts');
 const {clearOfItems}=await import('../src/game/world/itemClearance.ts');
 assert.ok(clearOfItems({level:{key:{index:0}}},0,0,0,100,100),'race levels bypass every reservation');
 const world=new World(runLevel(2,1,'verdant')),sites=placePickups(world,RUN_ITEMS);let plants=0;
 for(const [index,site] of sites.entries()){
  const p=site.position;const {plants:placed}=placeFlora(world,{x0:p.x-45,x1:p.x+45,y0:site.floor.y-60,y1:p.y+90,z0:p.z-45,z1:p.z+45},false);
  const colliders=[];
  for(let i=0;i<placed.length;i+=8){const [kind,x,y,z,h,r,yaw]=placed.slice(i,i+8);colliders.push(new Plant(x,y,z,h,r,yaw,kindInfo(world.biome,kind).collider));}
  plants+=colliders.length;world.trees.add(index,colliders);
 }
 assert.ok(plants>0,'trees and structures still grow outside the groves');
 for(const site of sites)assert.ok(pickupClear(world,site.position),site.id);
});

test('held Dragon Tear drives the real flight downward and release returns pitch control',()=>{
 const {items,flight}=setup();use(items,flight,'dragonTear');
 for(let i=0;i<360;i++){const input={pitch:0,roll:0,use:1};const mods=step(items,flight,1/120,input);flight.step(1/120,input,0,undefined,mods);}
 assert.ok(flight.forward.y<-0.98,'vertical dive reached');assert.ok(flight.velocity.y<-30);
 const divingY=flight.forward.y;
 for(let i=0;i<120;i++){const input={pitch:1,roll:0,use:0};const mods=step(items,flight,1/120,input);flight.step(1/120,input,0,undefined,mods);}
 assert.ok(flight.forward.y>divingY+0.2,'ordinary pitch works after release');assert.ok(flight.position.toArray().every(Number.isFinite));
});
