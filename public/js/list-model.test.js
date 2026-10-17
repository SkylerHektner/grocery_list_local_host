import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { derive } from './store.js';
import {
  addedEntries,
  compareNames,
  displayOrder,
  fallbackFocus,
  gridNeighbor,
  groupEntries,
  neighborAfterRemoval,
  plural,
  summary,
} from './list-model.js';

const item = (id, name, category_id) => ({
  id,
  name,
  category_id,
  aliases: [],
  staple: false,
  use_count: 0,
  last_used: 0,
});
const manual = (item_id, note = null) => ({ item_id, note, sources: [{ kind: 'manual' }], added_at: 1 });

function state(entries, recipeIds = []) {
  return derive({
    version: 1,
    categories: [
      { id: 1, name: 'Produce' },
      { id: 2, name: 'Bakery' },
      { id: 3, name: 'Dairy & Eggs' },
    ],
    items: [
      item(10, 'milk', 3),
      item(11, 'Eggs', 3),
      item(12, 'Bananas', 1),
      item(13, 'apples', 1),
      item(14, 'Candles', null),
      item(15, 'Ghost', 99), // category no longer exists
      item(16, 'Butter', 3),
    ],
    recipes: [
      { id: 20, name: 'Pancakes', item_ids: [10, 11] },
      { id: 21, name: 'Cake', item_ids: [11, 16] },
    ],
    list: { entries, recipe_ids: recipeIds },
  });
}

describe('groupEntries', () => {
  test('groups in walk order, Uncategorized (incl. unknown categories) last, names sorted', () => {
    const s = state([manual(10), manual(14), manual(11), manual(12), manual(15), manual(13)]);
    const groups = groupEntries(s);
    assert.deepEqual(
      groups.map((g) => [g.key, g.name, g.rows.map((r) => r.item.name)]),
      [
        ['cat-1', 'Produce', ['apples', 'Bananas']],
        ['cat-3', 'Dairy & Eggs', ['Eggs', 'milk']],
        ['cat-none', 'Uncategorized', ['Candles', 'Ghost']],
      ],
    );
    assert.equal(groups[2].category, null);
    assert.equal(groups[0].category.id, 1);
  });

  test('rows carry the entry and their recipe sources; unknown items are skipped', () => {
    const s = state(
      [
        { item_id: 11, note: '1 dozen', sources: [{ kind: 'manual' }, { kind: 'recipe', recipe_id: 21 }, { kind: 'recipe', recipe_id: 20 }], added_at: 1 },
        manual(999),
      ],
      [20, 21],
    );
    const [group] = groupEntries(s);
    assert.equal(group.rows.length, 1);
    assert.equal(group.rows[0].entry.note, '1 dozen');
    assert.deepEqual(group.rows[0].recipes.map((r) => r.name), ['Cake', 'Pancakes']);
  });

  test('hidden ids are left out and note overrides are shown', () => {
    const s = state([manual(10, 'old'), manual(11), manual(12)]);
    const groups = groupEntries(s, { hidden: new Set([12]), notes: new Map([[10, 'new']]) });
    assert.deepEqual(displayOrder(groups), [11, 10]);
    assert.equal(groups[0].rows[1].entry.note, 'new');
    // The store's own entry is untouched.
    assert.equal(s.entriesByItemId.get(10).note, 'old');
  });

  test('an empty list has no groups', () => {
    assert.deepEqual(groupEntries(state([])), []);
  });
});

test('compareNames sorts case-insensitively, then by the raw name', () => {
  assert.deepEqual(['milk', 'Eggs', 'butter', 'Butter'].sort(compareNames), ['Butter', 'butter', 'Eggs', 'milk']);
});

describe('neighborAfterRemoval', () => {
  test('next row, else previous, else null', () => {
    assert.equal(neighborAfterRemoval([1, 2, 3], 1), 2);
    assert.equal(neighborAfterRemoval([1, 2, 3], 2), 3);
    assert.equal(neighborAfterRemoval([1, 2, 3], 3), 2);
    assert.equal(neighborAfterRemoval([1], 1), null);
    assert.equal(neighborAfterRemoval([4, 5], 9), 4);
  });
});

describe('fallbackFocus', () => {
  test('keeps the row when it is still there', () => {
    assert.equal(fallbackFocus([1, 2, 3], [3, 2, 1], 2), 2);
  });

  test('takes the next surviving row, else the previous, else null', () => {
    assert.equal(fallbackFocus([1, 2, 3, 4], [1, 4], 2), 4);
    assert.equal(fallbackFocus([1, 2, 3], [1], 3), 1);
    assert.equal(fallbackFocus([1, 2], [], 1), null);
    assert.equal(fallbackFocus([1, 2], [7, 8], 2), 8);
  });
});

test('addedEntries lists ids new since the previous state (none on the first render)', () => {
  const before = state([manual(10)]);
  const after = state([manual(10), manual(12), manual(11)]);
  assert.deepEqual(addedEntries(before, after), [12, 11]);
  assert.deepEqual(addedEntries(null, after), []);
  assert.deepEqual(addedEntries(after, before), []);
});

test('plural and summary', () => {
  assert.equal(plural(1, 'item'), '1 item');
  assert.equal(plural(0, 'item'), '0 items');
  assert.equal(summary(state([])), 'Nothing on it yet');
  assert.equal(summary(state([manual(10)])), '1 item');
  assert.equal(summary(state([manual(10), manual(11)], [20])), '2 items · 1 recipe');
  assert.equal(summary(state([], [20, 21])), '0 items · 2 recipes');
});

describe('gridNeighbor', () => {
  // Two groups: A has 3 tiles over 2 columns (a1 a2 / a3), B has 2 (b1 b2), 100 px tiles.
  const box = (top, left) => ({ top, left, width: 100 });
  const boxes = [box(0, 0), box(0, 110), box(50, 0), box(150, 0), box(150, 110)];

  test('down goes to the next line, nearest column, across groups', () => {
    assert.equal(gridNeighbor(boxes, 0, 1), 2); // a1 -> a3
    assert.equal(gridNeighbor(boxes, 1, 1), 2); // a2 -> a3 (the only tile on that line)
    assert.equal(gridNeighbor(boxes, 2, 1), 3); // a3 -> b1
    assert.equal(gridNeighbor(boxes, 4, 1), null); // bottom line
  });

  test('up goes to the line above, nearest column; null on the top line', () => {
    assert.equal(gridNeighbor(boxes, 4, -1), 2); // b2 -> a3
    assert.equal(gridNeighbor(boxes, 2, -1), 0); // a3 -> a1
    assert.equal(gridNeighbor(boxes, 1, -1), null);
  });

  test('sub-pixel differences count as the same line; a single column is plain next/previous', () => {
    const wobbly = [box(0, 0), box(0.6, 110), box(50.4, 110)];
    assert.equal(gridNeighbor(wobbly, 0, 1), 2);
    const column = [box(0, 0), box(40, 0), box(80, 0)];
    assert.equal(gridNeighbor(column, 0, 1), 1);
    assert.equal(gridNeighbor(column, 2, -1), 1);
    assert.equal(gridNeighbor(column, 5, 1), null);
  });
});
