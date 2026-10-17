import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_INVENTORY, predict, project } from '../src/game/inventory/model.ts';
import { InventoryClient } from '../src/game/inventory/outbox.ts';

// The inventory on the client (plan F3): predictions, the outbox and reconciling with the server.
// backend/tests/test_inventory.py tests the server's side (the real rules, idempotency, limits).

/** A server that applies actions with the same rules, answers each action_id once, and can lose answers */
function fakeServer(start = EMPTY_INVENTORY) {
  const server = { state: start, answers: new Map(), loseNext: false, sent: 0 };
  server.transport = {
    load: async () => server.state,
    send: async (actions) => {
      server.sent++;
      const results = actions.map((action) => {
        if (server.answers.has(action.action_id)) return { ...server.answers.get(action.action_id), replayed: true };
        const { state, error } = predict(server.state, action);
        const result = error ? { action_id: action.action_id, ok: false, error } : { action_id: action.action_id, ok: true };
        if (!error) server.state = { ...state, rev: server.state.rev + 1 };
        server.answers.set(action.action_id, result);
        return result;
      });
      if (server.loseNext) {
        server.loseNext = false;
        throw new Error('connection lost');
      }
      return { results, inventory: server.state };
    },
  };
  return server;
}

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
}

const withBag = (items) => ({ ...EMPTY_INVENTORY, rev: 1, bag: { items, gear: [] }, slots: { ...EMPTY_INVENTORY.slots, bag: { size: 36, used: 1 } } });

test('an action shows at once, then the server confirms it', async () => {
  const server = fakeServer(withBag({ moonwheat: 30 }));
  const client = new InventoryClient(server.transport, memoryStorage(), 'test');
  await client.start();
  assert.ok('id' in client.act({ kind: 'move', item: 'moonwheat', count: 10, from: 'bag', to: 'storage' }));
  const view = client.store.get();
  assert.equal(view.pending, 1);
  assert.deepEqual(view.inventory.storage.items, { moonwheat: 10 });
  assert.equal(server.sent, 0);
  await client.flush();
  assert.equal(client.store.get().pending, 0);
  assert.deepEqual(client.store.get().inventory, server.state);
});

test('the server wins when it disagrees', async () => {
  const server = fakeServer(withBag({ sunberry: 5 }));
  const client = new InventoryClient(server.transport, memoryStorage(), 'test');
  await client.start();
  // Another device sold three meanwhile
  server.state = withBag({ sunberry: 2 });
  client.act({ kind: 'sell', item: 'sunberry', count: 5, from: 'bag' });
  assert.equal(client.store.get().inventory.wallet.crystal, 15);
  await client.flush();
  const view = client.store.get();
  assert.equal(view.refused.error, 'Not enough Sunberry in your bag');
  assert.deepEqual(view.inventory, server.state);
  assert.equal(view.inventory.wallet.crystal, undefined);
});

test('the outbox survives a reload and a lost answer is never applied twice', async () => {
  const server = fakeServer(withBag({ glowcap: 20 }));
  const storage = memoryStorage();
  const first = new InventoryClient(server.transport, storage, 'test');
  await first.start();
  first.act({ kind: 'sell', item: 'glowcap', count: 4, from: 'bag' });
  first.act({ kind: 'move', item: 'glowcap', count: 6, from: 'bag', to: 'storage' });
  // The page closes before the flush: the actions wait in storage
  assert.equal(JSON.parse(storage.data.get('test')).length, 2);
  const second = new InventoryClient(server.transport, storage, 'test');
  assert.equal(second.store.get().pending, 2);
  // The server applies the batch but the answer is lost on the way back
  server.loseNext = true;
  await second.start();
  assert.equal(second.store.get().pending, 2);
  assert.deepEqual(server.state.bag.items, { glowcap: 10 });
  // Sent again: the server answers from its record, nothing happens twice
  await second.flush();
  assert.equal(second.store.get().pending, 0);
  assert.deepEqual(server.state.bag.items, { glowcap: 10 });
  assert.deepEqual(server.state.storage.items, { glowcap: 6 });
  assert.equal(server.state.wallet.crystal, 32);
  assert.deepEqual(second.store.get().inventory, server.state);
  assert.equal(storage.data.has('test'), false);
});

test('an older answer never rolls the view back', () => {
  const server = fakeServer();
  const client = new InventoryClient(server.transport, null, 'test');
  client.reconcile({ results: [], inventory: withBag({ moonwheat: 3 }) });
  client.reconcile({ results: [], inventory: { ...withBag({ moonwheat: 9 }), rev: 0 } });
  assert.deepEqual(client.store.get().inventory.bag.items, { moonwheat: 3 });
});

test('impossible actions are refused before they are queued', async () => {
  const client = new InventoryClient(fakeServer(withBag({ moonwheat: 1 })).transport, null, 'test');
  await client.start();
  assert.deepEqual(client.act({ kind: 'sell', item: 'moonwheat', count: 2, from: 'bag' }), { error: 'Not enough Moonwheat in your bag' });
  assert.deepEqual(client.act({ kind: 'move', item: 'crystal', count: 1, from: 'bag', to: 'storage' }), { error: 'Crystals stay in your purse' });
  assert.equal(client.store.get().pending, 0);
});

test('equipping swaps the piece in that slot, and slots are counted by stack', () => {
  const blades = (uuid) => ({ uuid, item: 'wing_blades', data: {} });
  let state = { ...EMPTY_INVENTORY, bag: { items: { moonwheat: 513 }, gear: [blades('a')] }, equipped: { weapon: blades('b') } };
  state = predict(state, { action_id: 'x1234567', kind: 'move', gear: 'a', to: 'equipped' }).state;
  assert.equal(state.equipped.weapon.uuid, 'a');
  assert.deepEqual(state.bag.gear.map((g) => g.uuid), ['b']);
  assert.equal(state.slots.bag.used, 3);
  assert.equal(predict(state, { action_id: 'x1234568', kind: 'sell', gear: 'a' }).error, 'Take Wing blades off first');
  assert.deepEqual(project(state, []), state);
});
