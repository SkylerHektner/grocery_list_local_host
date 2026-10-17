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
  const labels = recipes.items.map((i) => i.label);
  assert.equal(labels.filter((l) => l === 'New recipe').length, 1);
  assert.equal(labels.at(-1), 'Rename');
  const items = groupsFor('items', 'Items', [{ keys: ['e'], label: 'Edit' }]);
  assert.equal(items[1].title, 'Items');
  assert.equal(JSON.stringify(SHORTCUT_GROUPS), before);
});

test('the items and store order views list their row keys', () => {
  const items = groupsFor('items', 'Items');
  assert.deepEqual(items.slice(1, 3).map((g) => g.title), ['Items', 'Pick a category']);
  const itemKeys = items[1].items.flatMap((i) => i.keys);
  for (const key of ['s', 'c', 'm', 'Delete', 'F2', 'Enter']) assert.ok(itemKeys.includes(key), key);
  const store = groupsFor('categories', 'Store order')[1];
  const storeKeys = store.items.flatMap((i) => i.keys);
  for (const key of ['Alt+↑', 'Alt+↓', 'F2', 'Delete', 'n']) assert.ok(storeKeys.includes(key), key);
});

test('the recipes view lists its index, editor and cull keys', () => {
  const groups = groupsFor('recipes', 'Recipes');
  assert.deepEqual(groups.slice(1, 6).map((g) => g.title), [
    'Search box',
    'New item: pick a category',
    'Adding a recipe',
    'Recipes',
    'Recipe editor',
  ]);
  const keys = groups.flatMap((g) => (g.views?.includes('recipes') ? g.items.flatMap((i) => i.keys) : []));
  for (const key of ['a', 'n', 'F2', 'Delete', 'Space', 'Enter', 'Esc']) assert.ok(keys.includes(key), key);
});
