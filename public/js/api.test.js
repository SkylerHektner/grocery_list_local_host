import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, createApi } from './api.js';

/** Fake fetch: records calls and answers with `respond(path, init)` (a Response or a throw). */
function fakeFetch(respond) {
  const calls = [];
  const fetch = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers });
    return respond(path, init);
  };
  return { fetch, calls };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const STATE = { version: 7, categories: [], items: [], recipes: [], list: { entries: [], recipe_ids: [] } };

describe('reads', () => {
  test('GET endpoints parse JSON and do not touch the store', async () => {
    const states = [];
    const { fetch, calls } = fakeFetch((path) =>
      path === '/api/version' ? json({ version: 3 }) : json(STATE),
    );
    const api = createApi({ fetch, onState: (s) => states.push(s) });
    assert.deepEqual(await api.getVersion(), { version: 3 });
    assert.deepEqual(await api.getState(), STATE);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /api/version', 'GET /api/state']);
    assert.equal(calls[0].body, undefined);
    assert.deepEqual(states, []);
  });

  test('exportText returns the plain text', async () => {
    const { fetch } = fakeFetch(() => new Response('PRODUCE\nBananas', { status: 200 }));
    assert.equal(await createApi({ fetch }).exportText(), 'PRODUCE\nBananas');
  });
});

describe('errors', () => {
  test('non-2xx rejects with the server message and status', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'an item named "Milk" already exists' }, 409));
    const api = createApi({ fetch });
    await assert.rejects(api.quiet.createItem({ name: 'milk' }), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.message, 'an item named "Milk" already exists');
      assert.equal(err.status, 409);
      assert.equal(err.method, 'POST');
      assert.equal(err.path, '/api/items');
      return true;
    });
  });

  test('a non-JSON error body falls back to the status', async () => {
    const { fetch } = fakeFetch(() => new Response('<h1>Bad gateway</h1>', { status: 502, statusText: 'Bad Gateway' }));
    await assert.rejects(createApi({ fetch }).getState(), { status: 502, message: 'Request failed (502 Bad Gateway)' });
  });

  test('a network failure is an ApiError with status 0', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await assert.rejects(createApi({ fetch }).getVersion(), (err) => err instanceof ApiError && err.status === 0);
  });

  test('a 2xx that is not JSON is an ApiError', async () => {
    const { fetch } = fakeFetch(() => new Response('oops', { status: 200 }));
    await assert.rejects(createApi({ fetch }).getState(), ApiError);
  });

  test('mutation failures reach onError listeners (not reads, not quiet)', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'nothing to undo' }, 409));
    const api = createApi({ fetch });
    const seen = [];
    const off = api.onError((err) => seen.push(err.message));
    await assert.rejects(api.undo());
    await assert.rejects(api.quiet.undo());
    await assert.rejects(api.getState());
    off();
    await assert.rejects(api.undo());
    assert.deepEqual(seen, ['nothing to undo']);
  });
});

describe('mutations', () => {
  test('push the new state via onState and resolve to {state, id}', async () => {
    const states = [];
    const { fetch } = fakeFetch(() => json({ state: STATE, id: 121 }));
    const api = createApi({ fetch, onState: (s) => states.push(s) });
    assert.deepEqual(await api.createItem({ name: 'Candles' }), { state: STATE, id: 121 });
    assert.deepEqual(await api.quiet.clearList(), { state: STATE, id: 121 });
    assert.deepEqual(states, [STATE, STATE]);
  });

  test('every endpoint sends the documented method, path and body', async () => {
    const { fetch, calls } = fakeFetch(() => json({ state: STATE, id: null }));
    const api = createApi({ fetch });
    const item = { id: 32, name: 'Whole milk', category_id: null, aliases: ['Milk'], staple: false, use_count: 3, last_used: 9 };
    const cases = [
      [() => api.createCategory('Garden'), 'POST', '/api/categories', { name: 'Garden' }],
      [() => api.renameCategory(5, 'Dairy'), 'PUT', '/api/categories/5', { name: 'Dairy' }],
      [() => api.deleteCategory(5), 'DELETE', '/api/categories/5', undefined],
      [() => api.reorderCategories([2, 1]), 'PUT', '/api/categories/order', { ids: [2, 1] }],
      [() => api.createItem({ name: 'Candles', extra: 1 }), 'POST', '/api/items', { name: 'Candles' }],
      [() => api.createItem({ name: 'Candles', category_id: null, aliases: [], staple: true }), 'POST', '/api/items',
        { name: 'Candles', category_id: null, aliases: [], staple: true }],
      [() => api.updateItem(32, item), 'PUT', '/api/items/32',
        { name: 'Whole milk', category_id: null, aliases: ['Milk'], staple: false }],
      [() => api.deleteItem(32), 'DELETE', '/api/items/32', undefined],
      [() => api.mergeItem(60, 26), 'POST', '/api/items/60/merge', { into_id: 26 }],
      [() => api.createRecipe({ name: 'Pancakes' }), 'POST', '/api/recipes', { name: 'Pancakes' }],
      [() => api.updateRecipe(55, { id: 55, name: 'Tacos', ingredients: [{ item_id: 1, note: '2' }] }), 'PUT', '/api/recipes/55',
        { name: 'Tacos', ingredients: [{ item_id: 1, note: '2' }] }],
      [() => api.deleteRecipe(55), 'DELETE', '/api/recipes/55', undefined],
      [() => api.addToList(31), 'POST', '/api/list/items', { item_id: 31 }],
      [() => api.addToList(31, '2 dozen'), 'POST', '/api/list/items', { item_id: 31, note: '2 dozen' }],
      [() => api.setNote(31, 'brown'), 'PUT', '/api/list/items/31', { note: 'brown' }],
      [() => api.setNote(31, null), 'PUT', '/api/list/items/31', { note: null }],
      [() => api.removeFromList(31), 'DELETE', '/api/list/items/31', undefined],
      [() => api.addRecipeToList(55, []), 'POST', '/api/list/recipes', { recipe_id: 55, item_ids: [] }],
      [() => api.removeRecipeFromList(55), 'DELETE', '/api/list/recipes/55', undefined],
      [() => api.clearList(), 'DELETE', '/api/list', undefined],
      [() => api.undo(), 'POST', '/api/list/undo', undefined],
    ];
    for (const [call, method, path, body] of cases) {
      calls.length = 0;
      await call();
      assert.equal(calls.length, 1);
      assert.deepEqual({ method: calls[0].method, path: calls[0].path, body: calls[0].body }, { method, path, body }, `${method} ${path}`);
      if (body !== undefined) assert.equal(calls[0].headers['Content-Type'], 'application/json');
    }
    // Every mutation also exists on api.quiet.
    for (const key of Object.keys(api.quiet)) assert.equal(typeof api[key], 'function', key);
  });
});
