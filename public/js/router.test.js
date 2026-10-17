import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VIEWS, parseHash, hashFor } from './router.js';

test('known routes', () => {
  assert.deepEqual(parseHash('#/list'), { view: 'list', params: [], known: true });
  assert.deepEqual(parseHash('#/recipes'), { view: 'recipes', params: [], known: true });
  assert.deepEqual(parseHash('#/items'), { view: 'items', params: [], known: true });
  assert.deepEqual(parseHash('#/categories'), { view: 'categories', params: [], known: true });
  assert.deepEqual(parseHash('#recipes'), { view: 'recipes', params: [], known: true });
});

test('params are decoded; empty segments ignored', () => {
  assert.deepEqual(parseHash('#/recipes/12'), { view: 'recipes', params: ['12'], known: true });
  assert.deepEqual(parseHash('#/recipes/a%20b//'), { view: 'recipes', params: ['a b'], known: true });
  assert.deepEqual(parseHash('#/recipes/%E0%A4%A'), { view: 'recipes', params: ['%E0%A4%A'], known: true });
});

test('empty or unknown hashes fall back to the list', () => {
  for (const hash of ['', '#', '#/', '#/nope', '#/List', undefined]) {
    assert.deepEqual(parseHash(hash), { view: 'list', params: [], known: false }, String(hash));
  }
});

test('hashFor round-trips', () => {
  assert.equal(hashFor('items'), '#/items');
  assert.equal(hashFor('recipes', 12), '#/recipes/12');
  assert.deepEqual(parseHash(hashFor('recipes', 'a/b')).params, ['a/b']);
  assert.deepEqual(VIEWS.map((v) => v.id), ['list', 'recipes', 'items', 'categories']);
});
