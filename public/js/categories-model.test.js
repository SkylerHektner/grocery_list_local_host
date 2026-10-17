import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { derive } from './store.js';
import {
  categoryCounts,
  categoryKeyAction,
  countLabel,
  deleteCategoryMessage,
  moveId,
  reconcileOrder,
  sameOrder,
} from './categories-model.js';

describe('moveId', () => {
  test('moves an id up or down by one, or further', () => {
    assert.deepEqual(moveId([1, 2, 3], 1, 1), [2, 1, 3]);
    assert.deepEqual(moveId([1, 2, 3], 3, -1), [1, 3, 2]);
    assert.deepEqual(moveId([1, 2, 3, 4], 1, 3), [2, 3, 4, 1]);
  });

  test('null at the ends, for unknown ids and for no move; the input is untouched', () => {
    const order = [1, 2, 3];
    assert.equal(moveId(order, 1, -1), null);
    assert.equal(moveId(order, 3, 1), null);
    assert.equal(moveId(order, 9, 1), null);
    assert.equal(moveId(order, 2, 0), null);
    assert.deepEqual(order, [1, 2, 3]);
  });

  test('repeated moves walk an id to the end (holding Alt+↓)', () => {
    let order = [1, 2, 3, 4];
    for (let i = 0; i < 5; i++) order = moveId(order, 1, 1) ?? order;
    assert.deepEqual(order, [2, 3, 4, 1]);
  });
});

describe('reconcileOrder', () => {
  test('keeps the desired order when nothing changed', () => {
    assert.deepEqual(reconcileOrder([3, 1, 2], [1, 2, 3]), [3, 1, 2]);
  });

  test('drops deleted ids and appends new ones in server order', () => {
    assert.deepEqual(reconcileOrder([3, 1, 2], [1, 3, 5, 4]), [3, 1, 5, 4]);
    assert.deepEqual(reconcileOrder([], [1, 2]), [1, 2]);
  });

  test('always returns a permutation of the server ids', () => {
    const out = reconcileOrder([9, 2, 2, 1], [1, 2, 3]);
    assert.deepEqual([...out].sort(), [1, 2, 3]);
  });
});

test('sameOrder', () => {
  assert.equal(sameOrder([1, 2], [1, 2]), true);
  assert.equal(sameOrder([1, 2], [2, 1]), false);
  assert.equal(sameOrder([1], [1, 2]), false);
});

test('categoryCounts counts items per category; unknown and null categories are uncategorized', () => {
  const state = derive({
    version: 1,
    categories: [
      { id: 1, name: 'Produce' },
      { id: 2, name: 'Bakery' },
    ],
    items: [
      { id: 10, name: 'Limes', category_id: 1, aliases: [] },
      { id: 11, name: 'Lemons', category_id: 1, aliases: [] },
      { id: 12, name: 'Candles', category_id: null, aliases: [] },
      { id: 13, name: 'Ghost', category_id: 99, aliases: [] },
    ],
    recipes: [],
    list: { entries: [], recipe_ids: [] },
  });
  const { byId, uncategorized } = categoryCounts(state);
  assert.deepEqual([...byId], [
    [1, 2],
    [2, 0],
  ]);
  assert.equal(uncategorized, 2);
});

test('countLabel and deleteCategoryMessage', () => {
  assert.equal(countLabel(0), 'No items');
  assert.equal(countLabel(1), '1 item');
  assert.equal(countLabel(12), '12 items');
  assert.match(deleteCategoryMessage(0), /^No items use it\./);
  assert.match(deleteCategoryMessage(1), /^Its 1 item becomes Uncategorized .* for it\./);
  assert.match(deleteCategoryMessage(3), /^Its 3 items become Uncategorized .* for them\./);
  assert.match(deleteCategoryMessage(3), /can't be undone\.$/);
});

describe('categoryKeyAction', () => {
  const key = (k, mods = {}) => categoryKeyAction({ key: k, ...mods });

  test('arrows and j/k move focus; Alt+arrows move the category', () => {
    assert.equal(key('ArrowDown'), 'down');
    assert.equal(key('j'), 'down');
    assert.equal(key('ArrowUp'), 'up');
    assert.equal(key('k'), 'up');
    assert.equal(key('Home'), 'first');
    assert.equal(key('End'), 'last');
    assert.equal(key('ArrowDown', { altKey: true }), 'move-down');
    assert.equal(key('ArrowUp', { altKey: true }), 'move-up');
    assert.equal(key('j', { altKey: true }), null);
  });

  test('Enter/F2 rename, Delete/Backspace delete; other modifiers are ignored', () => {
    assert.equal(key('Enter'), 'rename');
    assert.equal(key('F2'), 'rename');
    assert.equal(key('Delete'), 'delete');
    assert.equal(key('Backspace'), 'delete');
    assert.equal(key('ArrowDown', { ctrlKey: true }), null);
    assert.equal(key('ArrowDown', { shiftKey: true }), null);
    assert.equal(key('ArrowDown', { altKey: true, metaKey: true }), null);
    assert.equal(key('x'), null);
  });
});
