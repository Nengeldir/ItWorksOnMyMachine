import test from "node:test";
import assert from "node:assert/strict";
import { ProfileClient } from "../src/profile/client.ts";

const saved = new Map();
globalThis.localStorage = {
  getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key,value), removeItem:key=>saved.delete(key),
  get length() { return saved.size; }, key:i=>[...saved.keys()][i] ?? null,
};
globalThis.window = new EventTarget();
const profile = (revision=0, xp=0, equipped={cape:"classic",hat:"none",shoes:"classic",pet:"none"}) => ({
  user_id:"test-account",name:"Pilot",version:1,revision,xp,crystals:xp,level:1,level_xp:xp,next_level_xp:100,
  equipped,inventory:{"cape:classic":1},catalog:[],
});
const response = data => ({ok:true,status:200,json:async()=>data});
const settled = async () => { for(let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve)); };

test("a lost claim response survives reload and retries the same issued reward without optimistic XP", async () => {
  saved.clear();
  let ledger=profile(), claims=0, fail=true;
  globalThis.fetch = async (url, options) => {
    if(url.startsWith("/api/profile?")) return response(ledger);
    if(url === "/api/profile/claim") {
      const body=JSON.parse(options.body); assert.deepEqual(body.pickups,["1:c0"]);
      claims++;
      if(claims===1) ledger=profile(1,3);
      if(fail) throw Error("response lost after commit");
      return response({profile:ledger,accepted:[],xp:0,crystals:0,levels:0});
    }
    throw Error(url);
  };
  const timers=[]; const realTimer=globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay) => { if(delay===5000) { timers.push(callback); return 0; } return realTimer(callback,delay); };
  try {
    const first=new ProfileClient(); await first.initialize();
    first.collect("journey", "1:c0"); await settled();
    assert.equal(first.store.get().profile.xp,0);
    assert.equal(first.store.get().pending,1);
    assert.ok([...saved.keys()].some(key=>key.includes("journey:1:c0")));
    fail=false;
    const second=new ProfileClient(); await second.initialize(); await settled();
    assert.equal(second.store.get().profile.xp,3);
    assert.equal(second.store.get().pending,0);
    assert.equal(second.store.get().notice,null,"an acknowledged replay must not repeat the reward announcement");
    assert.equal(claims,2);
    assert.equal([...saved.keys()].filter(k=>k.startsWith("windrider.profile.outbox")).length,0);
  } finally { globalThis.setTimeout=realTimer; }
});

test("a slow refresh cannot replace a newer claim or an equipped pet, and unrelated accounts' outboxes stay separate", async () => {
  saved.clear();
  let slow;
  globalThis.fetch = async(url,options) => {
    if(url.startsWith("/api/profile?")) return response(profile());
    if(url==="/api/profile/equip") return response(profile(2,3,{cape:"classic",hat:"none",shoes:"classic",pet:"owl"}));
    if(url==="/api/profile/claim") { assert.equal(JSON.parse(options.body).token,"new-journey"); return response({profile:profile(1,3),accepted:[{id:"1:c0",name:"Crystals"}],xp:3,crystals:3,levels:0}); }
    throw Error(url);
  };
  saved.set("windrider.profile.outbox.v1:another-account:private:1:c0",JSON.stringify({token:"private",pickup:"1:c0"}));
  const client=new ProfileClient(); await client.initialize();
  globalThis.fetch = async(url,options) => {
    if(url.startsWith("/api/profile?")) return new Promise(resolve=>{slow=()=>resolve(response(profile()));});
    if(url==="/api/profile/equip") return response(profile(2,3,{cape:"classic",hat:"none",shoes:"classic",pet:"owl"}));
    if(url==="/api/profile/claim") return response({profile:profile(1,3),accepted:[{id:"1:c0",name:"Crystals"}],xp:3,crystals:3,levels:0});
    throw Error(url);
  };
  const refresh=client.refresh();
  client.collect("new-journey","1:c0"); await settled();
  await client.equip("pet","owl");
  slow(); await refresh;
  assert.equal(client.store.get().profile.revision,2);
  assert.equal(client.appearance().pet,"owl");
  assert.equal(client.store.get().profile.xp,3);
  assert.ok(saved.has("windrider.profile.outbox.v1:another-account:private:1:c0"));
});

test("storage-disabled sessions still save real rewards and failed initialization can be retried", async () => {
  const storage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>{throw Error("blocked");},setItem:()=>{throw Error("blocked");},removeItem:()=>{throw Error("blocked");},get length(){throw Error("blocked");}};
  let fail=true;
  globalThis.fetch=async(url)=> {
    if(url.startsWith("/api/profile?")) { if(fail) throw Error("offline"); return response(profile()); }
    if(url==="/api/profile/adventures") return response({token:"fresh",seed:7,rewards:[]});
    if(url==="/api/profile/claim") return response({profile:profile(1,3),accepted:[{id:"1:c0",name:"Crystals"}],xp:3,crystals:3,levels:0});
    throw Error(url);
  };
  try {
    const client=new ProfileClient(); await client.initialize();
    assert.equal(client.store.get().profile,null);
    await assert.rejects(()=>client.start(7));
    fail=false; assert.equal((await client.start(7)).token,"fresh");
    client.collect("fresh","1:c0"); await settled();
    assert.equal(client.store.get().profile.xp,3); assert.equal(client.store.get().pending,0);
  } finally { globalThis.localStorage=storage; }
});
