import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  acceptVersion,
  bindLiveSync,
  createLiveSync,
  createStore,
  derive,
  pollAction,
  walkIndex,
} from './store.js';

function snapshot(version, extra = {}) {
  return {
    version,
    categories: [{ id: 1, name: 'Produce' }, { id: 2, name: 'Dairy & Eggs' }],
    items: [
      { id: 10, name: 'Milk', category_id: 2, aliases: [], staple: false, use_count: 0, last_used: 0 },
      { id: 11, name: 'Candles', category_id: null, aliases: [], staple: false, use_count: 0, last_used: 0 },
    ],
    recipes: [{ id: 20, name: 'Pancakes', item_ids: [10] }],
    list: {
      entries: [{ item_id: 10, note: '2 gallons', sources: [{ kind: 'manual' }], added_at: 1 }],
      recipe_ids: [20],
    },
    ...extra,
  };
}

/** Manual clock: setTimeout callbacks run when `advance()` passes their due time. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    get count() {
      return pending.size;
    },
    async advance(ms) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          await t.fn();
        }
      }
    },
  };
}

/** A fake server: version + state, with call counters and optional manual gating. */
function fakeServer(initial) {
  const server = {
    snap: initial,
    versionCalls: 0,
    stateCalls: 0,
    down: false,
    gate: null,
    async getVersion() {
      server.versionCalls++;
      if (server.gate) await server.gate;
      if (server.down) throw new Error('offline');
      return { version: server.snap.version };
    },
    async getState() {
      server.stateCalls++;
      if (server.down) throw new Error('offline');
      return server.snap;
    },
  };
  return server;
}

function setup({ visible = true, initial = snapshot(1) } = {}) {
  const timers = fakeTimers();
  const server = fakeServer(initial);
  const store = createStore();
  const statuses = [];
  const visibility = { visible };
  const sync = createLiveSync({
    store,
    getVersion: server.getVersion,
    getState: server.getState,
    timers,
    isVisible: () => visibility.visible,
    onStatus: (s) => statuses.push(s),
  });
  return { timers, server, store, sync, statuses, visibility };
}

describe('derive', () => {
  test('builds lookups by id, walk index and list entries', () => {
    const s = derive(snapshot(7));
    assert.equal(s.version, 7);
    assert.equal(s.itemsById.get(10).name, 'Milk');
    assert.equal(s.categoriesById.get(2).name, 'Dairy & Eggs');
    assert.equal(s.categoryIndex.get(1), 0);
    assert.equal(s.categoryIndex.get(2), 1);
    assert.equal(s.recipesById.get(20).name, 'Pancakes');
    assert.equal(s.entriesByItemId.get(10).note, '2 gallons');
    assert.equal(s.entriesByItemId.has(11), false);
    assert.ok(s.listRecipeIds.has(20));
    assert.ok(Object.isFrozen(s));
  });

  test('walkIndex puts Uncategorized last', () => {
    const s = derive(snapshot(1));
    assert.equal(walkIndex(s, 1), 0);
    assert.equal(walkIndex(s, 2), 1);
    assert.equal(walkIndex(s, null), 2);
    assert.equal(walkIndex(s, 999), 2);
  });

  test('tolerates missing collections', () => {
    const s = derive({ version: 0 });
    assert.deepEqual(s.items, []);
    assert.equal(s.entriesByItemId.size, 0);
  });
});

describe('version rules', () => {
  test('acceptVersion: first, newer, equal, older', () => {
    assert.equal(acceptVersion(null, 0), true);
    assert.equal(acceptVersion(5, 6), true);
    assert.equal(acceptVersion(5, 5), false);
    assert.equal(acceptVersion(5, 5, 5), false);
    assert.equal(acceptVersion(5, 4), false, 'a late mutation response never rolls back');
    assert.equal(acceptVersion(5, 4, 3), false, 'a read sent before we reached 5 is stale');
    assert.equal(acceptVersion(5, 0, 5), true, 'a fresh read below us means the server reset');
  });

  test('pollAction', () => {
    assert.equal(pollAction(5, 5, 5), 'same');
    assert.equal(pollAction(5, 5, 6), 'fetch');
    assert.equal(pollAction(5, 5, 2), 'fetch');
    assert.equal(pollAction(5, 6, 6), 'stale');
    assert.equal(pollAction(null, null, 0), 'fetch');
  });
});

describe('createStore', () => {
  test('notifies subscribers with (state, prev) only for accepted snapshots', () => {
    const store = createStore();
    const calls = [];
    const unsubscribe = store.subscribe((s, prev) => calls.push([s.version, prev?.version ?? null]));
    assert.equal(store.state, null);
    assert.equal(store.version, null);
    assert.equal(store.set(snapshot(3)), true);
    assert.equal(store.set(snapshot(3)), false);
    assert.equal(store.set(snapshot(2)), false);
    assert.equal(store.set(snapshot(4)), true);
    assert.equal(store.set(null), false);
    unsubscribe();
    store.set(snapshot(5));
    assert.deepEqual(calls, [[3, null], [4, 3]]);
    assert.equal(store.version, 5);
    assert.equal(store.state.itemsById.get(10).name, 'Milk');
  });

  test('a throwing subscriber does not stop the others', () => {
    const errors = [];
    const store = createStore({ onError: (err) => errors.push(err.message) });
    let reached = false;
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(() => {
      reached = true;
    });
    store.set(snapshot(1));
    assert.equal(reached, true);
    assert.deepEqual(errors, ['boom']);
  });
});

describe('createLiveSync', () => {
  test('start loads the state, then polls every 3 s and fetches only on change', async () => {
    const { timers, server, store, sync, statuses } = setup();
    await sync.start();
    assert.equal(store.version, 1);
    assert.equal(server.stateCalls, 1);
    assert.deepEqual(statuses, ['live']);

    await timers.advance(2999);
    assert.equal(server.versionCalls, 1, 'not yet');
    await timers.advance(1);
    assert.equal(server.versionCalls, 2);
    assert.equal(server.stateCalls, 1, 'unchanged version: no state fetch');

    server.snap = snapshot(2);
    await timers.advance(3000);
    assert.equal(server.stateCalls, 2);
    assert.equal(store.version, 2);
    assert.equal(timers.count, 1, 'exactly one timer pending');
    sync.stop();
    assert.equal(timers.count, 0);
  });

  test('does not poll while hidden; wake() checks immediately when visible again', async () => {
    const { timers, server, store, sync, visibility } = setup({ visible: false });
    await sync.start();
    assert.equal(server.versionCalls, 0);
    assert.equal(timers.count, 0);

    server.snap = snapshot(9);
    visibility.visible = true;
    await sync.wake();
    assert.equal(store.version, 9);
    assert.equal(timers.count, 1);

    visibility.visible = false;
    await sync.wake();
    assert.equal(timers.count, 0, 'hidden again: polling paused');
  });

  test('ignores a poll that a mutation response overtook', async () => {
    const { server, store, sync } = setup();
    await sync.start();
    let open;
    server.gate = new Promise((r) => (open = r));
    const check = sync.checkNow();
    // A mutation response lands while the poll is in flight...
    store.set(snapshot(3));
    // ...and the server (as seen by the slow poll) reports the older version 2.
    server.snap = snapshot(2);
    server.gate = null;
    open();
    await check;
    assert.equal(store.version, 3);
    assert.equal(server.stateCalls, 1, 'no state fetch for a stale poll');
  });

  test('a state response older than a mutation that landed meanwhile is dropped', async () => {
    const { server, store, sync } = setup();
    await sync.start();
    server.snap = snapshot(2);
    const original = server.getState;
    const sync2 = createLiveSync({
      store,
      getVersion: server.getVersion,
      getState: async () => {
        const s = await original();
        store.set(snapshot(3)); // mutation response arrives before the state response
        return s;
      },
      timers: fakeTimers(),
    });
    await sync2.checkNow();
    assert.equal(store.version, 3);
  });

  test('accepts a lower server version (data restored), with no newer local change', async () => {
    const { server, store, sync } = setup({ initial: snapshot(50) });
    await sync.start();
    assert.equal(store.version, 50);
    server.snap = snapshot(0);
    await sync.checkNow();
    assert.equal(store.version, 0);
  });

  test('reports offline and recovers', async () => {
    const { timers, server, store, sync, statuses } = setup();
    server.down = true;
    await sync.start();
    assert.equal(store.state, null);
    assert.deepEqual(statuses, ['offline']);
    assert.equal(sync.status, 'offline');
    server.down = false;
    await timers.advance(3000);
    assert.equal(store.version, 1);
    assert.deepEqual(statuses, ['offline', 'live']);
  });

  test('concurrent checks share one request', async () => {
    const { server, sync } = setup();
    await Promise.all([sync.checkNow(), sync.checkNow(), sync.checkNow()]);
    assert.equal(server.versionCalls, 1);
  });

  test('bindLiveSync wakes on focus, visibilitychange, online and pageshow', async () => {
    const win = new EventTarget();
    win.document = new EventTarget();
    let wakes = 0;
    const unbind = bindLiveSync({ wake: () => wakes++ }, win);
    win.dispatchEvent(new Event('focus'));
    win.document.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('pageshow'));
    assert.equal(wakes, 4);
    unbind();
    win.dispatchEvent(new Event('focus'));
    assert.equal(wakes, 4);
  });
});
