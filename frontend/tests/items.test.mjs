import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Items, ITEM, RUN_ITEMS } from '../src/game/run/items.ts';
import { Flight, plainMods } from '../src/game/flight.ts';
import { Course } from '../src/game/world/course.ts';
import { buildItem, disposeItem } from '../src/game/items/models.ts';
const flight=()=>{const f=new Flight();f.reset(new Vector3(0,50,0),new Vector3(0,0,1),40);return f;};
const setup=()=>{const items=new Items();items.setLevel({seed:7,course:new Course(7),distance:()=>100});return items;};
const advance=(items,f,t)=>{let m;for(let i=0;i<t*120;i++){m=plainMods();items.step(1/120,{pitch:0,roll:0},0,f,m);}return m;};
test('bag bounds, cycling, boots charges, and rejected repeated jumps',()=>{
 const items=setup(),f=flight();for(const id of ['aeroBoots','anemoCatcher','gliderWax'])items.give(id);assert.equal(items.give('echoConch'),false);
 assert.equal(items.use(f),'aeroBoots');assert.equal(items.use(f),null);assert.equal(items.current.charges,2);
 advance(items,f,0.5);items.use(f);advance(items,f,0.5);items.use(f);assert.equal(items.bag.length,2);items.cycle();assert.equal(items.current.id,'gliderWax');
});
test('distinct timed buffs expire and an empty bag gives neutral mods',()=>{
 const items=setup(),f=flight();assert.deepEqual(advance(items,f,0.1),plainMods());
 items.give('gliderWax');items.use(f);const wax=advance(items,f,1);assert.equal(wax.drag,0);assert.equal(wax.sink,0);assert.deepEqual(advance(items,f,ITEM.waxTime+0.1),plainMods());
 items.give('silkRibbon');items.use(f);assert.equal(advance(items,f,0.1).turn,ITEM.ribbonTurn);items.reset();assert.equal(advance(items,f,0.1).turn,1);
 items.give('cometFirework');items.use(f);const fire=advance(items,f,1);assert.ok(fire.thrust>30 && fire.turn<0.5);assert.notEqual(items.steer({pitch:0,roll:0}).roll,0);
});
test('one-hit shield and automatic one-use phoenix revive',()=>{
 const items=setup(),f=flight(),n=new Vector3(1,0,0);items.give('starflakeShield');items.use(f);
 assert.equal(items.save('body',n,n),'starflake');items.saved('starflake',f.position,n);assert.equal(items.save('body',n,n),null);
 items.give('phoenixFeather');assert.equal(items.use(f),null);f.position.y=-500;assert.ok(items.revive(f));assert.ok(items.invulnerable);assert.equal(items.bag.length,0);assert.ok(f.position.distanceTo(items.world.course.pointAt(f.position.z))<1e-9);
 assert.equal(items.revive(f),false);advance(items,f,ITEM.phoenixGrace+0.1);assert.equal(items.invulnerable,false);
});
test('revealed ghost gates score only on swept crossings and conch shows three gates',()=>{
 const items=setup(),f=flight(),gate=items.ghostGates[0];f.position.copy(gate.position).addScaledVector(gate.normal,-10);advance(items,f,1/120);f.position.copy(gate.position).addScaledVector(gate.normal,10);advance(items,f,1/120);assert.equal(gate.collected,false);
 items.give('spiritLantern');items.use(f);f.position.copy(gate.position).addScaledVector(gate.normal,-10);advance(items,f,1/120);f.position.copy(gate.position).addScaledVector(gate.normal,10);advance(items,f,1/120);assert.ok(gate.collected);assert.ok(items.points>=ITEM.ghostBonus);
 f.position.z=0;items.give('echoConch');items.use(f);assert.equal(items.path.length,3);
});
test('vortex attracts light and swept collection refills energy',()=>{
 const items=setup(),f=flight();items.lights.length=0;items.lights.push({position:f.position.clone().add(new Vector3(12,0,0)),energy:false,collected:false});items.give('vortexGeode');items.use(f);advance(items,f,1);assert.ok(items.lights[0].collected);assert.ok(items.points>=ITEM.lightBonus);
 f.boostCharge=0;items.lights.push({position:f.position.clone().add(new Vector3(0,0,5)),energy:true,collected:false});advance(items,f,1/120);f.position.z+=10;advance(items,f,1/120);assert.ok(f.boostCharge>0);
});
test('all registered item models have finite toon geometry',()=>{
 assert.equal(RUN_ITEMS.length,26);assert.equal(new Set(RUN_ITEMS.map(i=>i.id)).size,RUN_ITEMS.length);
 for(const item of RUN_ITEMS){const model=buildItem(item.model);const mesh=model.children[0];assert.ok(mesh.geometry.boundingSphere.radius>0,item.id);assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite),item.id);disposeItem(model);}
});
test('test mode makes room: the oldest item leaves a full bag so every item stays reachable',()=>{
 const items=setup();for(const id of ['anemoCatcher','starflakeShield','gliderWax'])items.give(id);
 assert.equal(items.give('cometFirework'),false);items.selected=2;items.makeRoom();
 assert.deepEqual(items.bag.map(c=>c.id),['starflakeShield','gliderWax']);assert.equal(items.current.id,'gliderWax');
 assert.ok(items.give('cometFirework'));assert.equal(items.bag.length,3);items.makeRoom();items.makeRoom();items.makeRoom();items.makeRoom();assert.equal(items.bag.length,2);
});
