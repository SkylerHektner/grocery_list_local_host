import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SHORTCUT_GROUPS, groupsFor } from './shortcuts.js';

test('every group has items with keys and a label', () => {
  for (const group of SHORTCUT_GROUPS) {
    assert.ok(group.title && group.items.length, group.title);
    for (const item of group.items) assert.ok(item.keys.length && item.label, item.label);
  }
});

test('groupsFor puts Everywhere first, then the view, then the rest', () => {
  const titles = groupsFor('categories', 'Store order').map((g) => g.title);
  assert.equal(titles[0], 'Everywhere');
  assert.equal(titles[1], 'Store order');
  assert.equal(titles.length, SHORTCUT_GROUPS.length);
});

test('the list view lists its own keys: undo, copy, culling, notes', () => {
  const list = groupsFor('list', 'List').find((g) => g.title === 'List');
  const keys = list.items.flatMap((i) => i.keys);
  for (const key of ['Ctrl+Z', 'Ctrl+Shift+C', 'Delete', 'x', 'n', 'j', 'k']) assert.ok(keys.includes(key), key);
});

test('extra view shortcuts join the view group once, without mutating the data', () => {
  const before = JSON.stringify(SHORTCUT_GROUPS);
  const extra = [{ keys: ['n'], label: 'New recipe' }, { keys: ['r'], label: 'Rename' }];
  const recipes = groupsFor('recipes', 'Recipes', extra).find((g) => g.title === 'Recipes');
  assert.deepEqual(recipes.items.map((i) => i.label), ['New recipe', 'Rename']);
  const items = groupsFor('items', 'Items', [{ keys: ['e'], label: 'Edit' }]);
  assert.equal(items[1].title, 'Items');
  assert.equal(JSON.stringify(SHORTCUT_GROUPS), before);
});
