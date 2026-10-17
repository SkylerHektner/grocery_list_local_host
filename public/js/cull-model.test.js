import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { derive } from './store.js';
import {
  addedMessage,
  chosenIds,
  countLabel,
  cullGroups,
  cullKeyAction,
  defaultChecked,
  ingredientOrder,
  listChanged,
  reconcileChecked,
  toggleAll,
  toggleOne,
} from './cull-model.js';

const ings = (...ids) => ids.map((item_id) => ({ item_id, note: null }));

const item = (id, name, category_id, staple = false) => ({
  id,
  name,
  category_id,
  aliases: [],
  staple,
  use_count: 0,
  last_used: 0,
});

function state(onList = [], items = []) {
  return derive({
    version: 1,
    categories: [
      { id: 1, name: 'Produce' },
      { id: 2, name: 'Bakery' },
      { id: 3, name: 'Pantry' },
    ],
    items: [
      item(10, 'Ground beef', null),
      item(11, 'Corn tortillas', 2),
      item(12, 'Limes', 1),
      item(13, 'Salt', 3, true),
      item(14, 'Garlic', 1, true),
      ...items,
    ],
    recipes: [{ id: 20, name: 'Tacos', ingredients: ings(10, 11, 12, 13, 14) }],
    list: {
      entries: onList.map((id) => ({ item_id: id, note: null, sources: [{ kind: 'manual' }], added_at: 1 })),
      recipe_ids: [],
    },
  });
}

const ids = (set) => [...set].sort((a, b) => a - b);

describe('rows and defaults', () => {
  test('rows come in list order: walk order, then name; Uncategorized last', () => {
    const s = state();
    const groups = cullGroups(s.recipesById.get(20), s);
    assert.deepEqual(groups.map((g) => g.name), ['Produce', 'Bakery', 'Pantry', 'Uncategorized']);
    assert.deepEqual(ingredientOrder(groups), [14, 12, 11, 13, 10]);
  });

  test('rows carry the recipe note for each ingredient', () => {
    const s = state();
    s.recipesById.get(20).ingredients[2].note = '2';
    const rows = cullGroups(s.recipesById.get(20), s).flatMap((g) => g.rows);
    assert.deepEqual(
      rows.filter((r) => r.note).map((r) => [r.item.name, r.note]),
      [['Limes', '2']],
    );
  });

  test('everything starts checked except staples', () => {
    const s = state();
    assert.deepEqual(ids(defaultChecked(cullGroups(s.recipesById.get(20), s))), [10, 11, 12]);
  });

  test('a staple already on the list starts checked (it only gains the recipe source)', () => {
    const s = state([13, 12]);
    const groups = cullGroups(s.recipesById.get(20), s);
    const salt = groups.flatMap((g) => g.rows).find((r) => r.item.id === 13);
    assert.equal(salt.onList, true);
    assert.equal(salt.staple, true);
    assert.deepEqual(ids(defaultChecked(groups)), [10, 11, 12, 13]);
  });
});

describe('toggling and counting', () => {
  test('toggleAll checks all, or none when all are checked', () => {
    assert.deepEqual(ids(toggleAll(new Set([1]), [1, 2, 3])), [1, 2, 3]);
    assert.deepEqual(ids(toggleAll(new Set([1, 2, 3]), [1, 2, 3])), []);
    assert.deepEqual(ids(toggleAll(new Set(), [1, 2])), [1, 2]);
    assert.deepEqual(ids(toggleAll(new Set(), [])), []);
  });

  test('toggleOne flips one id without mutating the input', () => {
    const before = new Set([1, 2]);
    assert.deepEqual(ids(toggleOne(before, 2)), [1]);
    assert.deepEqual(ids(toggleOne(before, 3)), [1, 2, 3]);
    assert.deepEqual(ids(before), [1, 2]);
  });

  test('countLabel', () => {
    assert.equal(countLabel(9, 11), 'Adding 9 of 11');
    assert.equal(countLabel(0, 3), 'Adding 0 of 3');
  });

  test('chosenIds keeps the recipe order', () => {
    assert.deepEqual(chosenIds({ ingredients: ings(5, 3, 9, 1) }, new Set([1, 9, 5])), [5, 9, 1]);
    assert.deepEqual(chosenIds({ ingredients: ings(5) }, new Set([7])), []);
  });
});

describe('reconcileChecked (live sync while the dialog is open)', () => {
  test('keeps the choices for rows seen, defaults new rows, drops rows that left', () => {
    const s1 = state();
    const g1 = cullGroups(s1.recipesById.get(20), s1);
    const seen = new Set(ingredientOrder(g1));
    const choices = new Set([10, 13]); // user unchecked 11, 12 and checked the staple Salt

    const s2 = state([], [item(15, 'Cilantro', 1), item(16, 'Pepper', 3, true)]);
    const recipe = { id: 20, ingredients: ings(10, 11, 13, 14, 15, 16) }; // Limes left; 15, 16 new
    const next = reconcileChecked(choices, seen, cullGroups(recipe, s2));
    assert.deepEqual(ids(next), [10, 13, 15]);
  });
});

describe('after confirming', () => {
  test('addedMessage', () => {
    assert.equal(addedMessage('Tacos', 8, true), 'Added 8 items from Tacos');
    assert.equal(addedMessage('Tacos', 1, true), 'Added 1 item from Tacos');
    assert.equal(addedMessage('Tacos', 0, true), 'Added Tacos without any items');
    assert.equal(addedMessage('Tacos', 3, false), 'Tacos is already on the list');
  });

  test('listChanged compares entries, sources, notes and chips', () => {
    const a = state([10]);
    assert.equal(listChanged(a, state([10])), false);
    assert.equal(listChanged(a, state([10, 11])), true);
    assert.equal(listChanged(null, a), true);
    const chip = derive({ ...a.snapshot, list: { ...a.list, recipe_ids: [20] } });
    assert.equal(listChanged(a, chip), true);
  });
});

describe('cullKeyAction', () => {
  const key = (k, extra = {}) => cullKeyAction({ key: k, ...extra });

  test('maps movement and toggle-all keys', () => {
    assert.equal(key('ArrowDown'), 'down');
    assert.equal(key('j'), 'down');
    assert.equal(key('ArrowUp'), 'up');
    assert.equal(key('k'), 'up');
    assert.equal(key('Home'), 'first');
    assert.equal(key('End'), 'last');
    assert.equal(key('a'), 'toggle-all');
    assert.equal(key('A'), 'toggle-all', 'Caps Lock');
  });

  test('leaves Space, Enter, Esc to the checkbox and the dialog; ignores modifiers', () => {
    for (const k of [' ', 'Enter', 'Escape', 'Tab', 'x']) assert.equal(key(k), null, k);
    assert.equal(key('a', { ctrlKey: true }), null);
    assert.equal(key('ArrowDown', { shiftKey: true }), null);
    assert.equal(key('a', { metaKey: true }), null);
    assert.equal(key('j', { altKey: true }), null);
  });
});
