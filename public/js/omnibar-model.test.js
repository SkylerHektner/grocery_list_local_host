import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  RESULT_LIMIT,
  UNCATEGORIZED,
  categoryForDigit,
  categoryOptions,
  keyAction,
  moveIndex,
  parseEntry,
  searchModel,
} from './omnibar-model.js';

const item = (id, name, extra = {}) => ({
  id,
  name,
  category_id: null,
  aliases: [],
  staple: false,
  use_count: 0,
  last_used: 0,
  ...extra,
});

const state = {
  items: [
    item(1, 'Eggs'),
    item(2, 'Milk'),
    item(3, 'Parmigiano Reggiano', { aliases: ['Parmesan'] }),
    item(4, 'Taco seasoning'),
    item(5, 'Half-and-half'),
  ],
  recipes: [
    { id: 10, name: 'Tacos', item_ids: [4] },
    { id: 11, name: 'Pancakes', item_ids: [1, 2] },
  ],
};

const keys = (model) => model.options.map((o) => o.key);

describe('parseEntry', () => {
  test('text before the first comma is the query, the rest the note', () => {
    assert.deepEqual(parseEntry('eggs, 2 dozen'), { query: 'eggs', note: '2 dozen' });
    assert.deepEqual(parseEntry('eggs,large, brown'), { query: 'eggs', note: 'large, brown' });
  });

  test('whitespace is collapsed and trimmed; an empty note is null', () => {
    assert.deepEqual(parseEntry('  greek   yogurt  '), { query: 'greek yogurt', note: null });
    assert.deepEqual(parseEntry('eggs,'), { query: 'eggs', note: null });
    assert.deepEqual(parseEntry('eggs,   '), { query: 'eggs', note: null });
    assert.deepEqual(parseEntry(' , ripe'), { query: '', note: 'ripe' });
    assert.deepEqual(parseEntry(''), { query: '', note: null });
    assert.deepEqual(parseEntry(undefined), { query: '', note: null });
  });
});

describe('searchModel', () => {
  test('an empty or blank query has no options at all (dropdown closed)', () => {
    assert.deepEqual(searchModel('', state).options, []);
    assert.deepEqual(searchModel('   ', state).options, []);
    assert.deepEqual(searchModel(', a note', state, { createRecipe: true }).options, []);
  });

  test('items only by default; recipes when asked, labeled by kind', () => {
    assert.deepEqual(keys(searchModel('tac', state)), ['item-4', 'create-item']);
    const model = searchModel('tac', state, { recipes: true });
    assert.deepEqual(keys(model), ['recipe-10', 'item-4', 'create-item']);
    assert.equal(model.options[0].kind, 'recipe');
    assert.equal(model.options[0].value.name, 'Tacos');
    assert.equal(model.options[1].kind, 'item');
  });

  test('the note is parsed off and only the query is searched', () => {
    const model = searchModel('eggs, 2 dozen', state);
    assert.equal(model.query, 'eggs');
    assert.equal(model.note, '2 dozen');
    assert.equal(model.raw, 'eggs, 2 dozen');
    assert.deepEqual(keys(model), ['item-1']);
  });

  test('an exact name or alias match hides the create rows and is reported', () => {
    assert.equal(searchModel('milk', state).exactItem.id, 2);
    assert.deepEqual(keys(searchModel('MILK', state, { recipes: true, createRecipe: true })), ['item-2']);
    const alias = searchModel('parmesan', state);
    assert.equal(alias.exactItem.id, 3);
    assert.deepEqual(keys(alias), ['item-3']);
    assert.equal(alias.options[0].match.alias, 'Parmesan');
    // Normalized: punctuation and case don't matter.
    assert.equal(searchModel('half and half', state).exactItem.id, 5);
  });

  test('create rows come last; create-recipe only when asked and no recipe has the name', () => {
    const model = searchModel('mil', state, { recipes: true, createRecipe: true });
    assert.deepEqual(keys(model), ['item-2', 'create-item', 'create-recipe']);
    assert.equal(model.options[1].name, 'mil');
    assert.equal(model.exactItem, null);
    const recipe = searchModel('pancakes', state, { recipes: true, createRecipe: true });
    assert.deepEqual(keys(recipe), ['recipe-11', 'create-item']);
  });

  test('no fuzzy matches: the create row is the first (default-highlighted) option', () => {
    const model = searchModel('birthday candles, 3', state, { createRecipe: true });
    assert.deepEqual(keys(model), ['create-item', 'create-recipe']);
    assert.equal(model.options[0].name, 'birthday candles');
  });

  test('the item create row can be turned off', () => {
    assert.deepEqual(keys(searchModel('zzz', state, { createItem: false })), []);
  });

  test('fuzzy typos still match, and results are capped', () => {
    assert.equal(searchModel('parmesian', state).options[0].value.id, 3);
    const many = { items: Array.from({ length: 30 }, (_, i) => item(100 + i, `Apple ${i}`)), recipes: [] };
    const model = searchModel('apple', many);
    assert.equal(model.options.filter((o) => o.kind === 'item').length, RESULT_LIMIT);
    assert.equal(model.options.at(-1).kind, 'create-item');
  });
});

describe('categoryOptions', () => {
  const categories = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `Aisle ${i + 1}` }));
  categories[0] = { id: 1, name: 'Produce' };
  categories[4] = { id: 5, name: 'Dairy & Eggs' };

  test('walk order numbered 1-9, then unnumbered, then Uncategorized as 0', () => {
    const options = categoryOptions('', categories);
    assert.equal(options.length, 12);
    assert.deepEqual(
      options.map((o) => o.number),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, 0],
    );
    assert.equal(options[0].key, 'cat-1');
    assert.equal(options.at(-1).key, UNCATEGORIZED);
    assert.equal(options.at(-1).category, null);
    assert.equal(options.at(-1).kind, 'uncategorized');
  });

  test('a filter fuzzy-ranks categories, keeps their numbers and highlight ranges', () => {
    const options = categoryOptions('dairy', categories);
    assert.equal(options[0].category.name, 'Dairy & Eggs');
    assert.equal(options[0].number, 5);
    assert.deepEqual(options[0].ranges, [[0, 5]]);
    assert.equal(options.at(-1).key, UNCATEGORIZED);
  });

  test('a filter that matches nothing leaves only Uncategorized', () => {
    assert.deepEqual(categoryOptions('xyzzy', categories).map((o) => o.key), [UNCATEGORIZED]);
  });
});

describe('categoryForDigit', () => {
  const categories = [{ id: 7, name: 'Produce' }, { id: 8, name: 'Bakery' }];

  test('1-9 pick by walk position, 0 is Uncategorized', () => {
    assert.deepEqual(categoryForDigit('1', categories), { category: categories[0] });
    assert.deepEqual(categoryForDigit('2', categories), { category: categories[1] });
    assert.deepEqual(categoryForDigit('0', categories), { category: null });
  });

  test('missing positions and non-digits pick nothing', () => {
    assert.equal(categoryForDigit('3', categories), undefined);
    assert.equal(categoryForDigit('a', categories), undefined);
    assert.equal(categoryForDigit('12', categories), undefined);
  });
});

describe('keyAction', () => {
  const search = (key, ctx = {}, mods = {}) => keyAction({ key, ...mods }, { mode: 'search', open: true, empty: false, ...ctx });
  const picker = (key, ctx = {}, mods = {}) => keyAction({ key, ...mods }, { mode: 'picker', open: true, empty: true, ...ctx });

  test('search: arrows move while open; ↓ hands focus on when closed', () => {
    assert.equal(search('ArrowDown'), 'down');
    assert.equal(search('ArrowUp'), 'up');
    assert.equal(search('ArrowDown', { open: false, empty: true }), 'exit-down');
    assert.equal(search('ArrowUp', { open: false }), null);
    assert.equal(search('ArrowDown', {}, { shiftKey: true }), null);
  });

  test('search: Enter picks, Shift+Enter creates, Esc clears then leaves', () => {
    assert.equal(search('Enter'), 'pick');
    assert.equal(search('Enter', {}, { shiftKey: true }), 'create');
    assert.equal(search('Escape'), 'clear');
    assert.equal(search('Escape', { empty: true, open: false }), 'leave');
    assert.equal(search('a'), null);
    assert.equal(search('1'), null);
    assert.equal(search('Tab'), null);
  });

  test('modifier combos are never handled (Ctrl+Shift+C, Alt+1, Ctrl+Z)', () => {
    assert.equal(search('C', {}, { ctrlKey: true, shiftKey: true }), null);
    assert.equal(search('Enter', {}, { altKey: true }), null);
    assert.equal(picker('1', {}, { altKey: true }), null);
    assert.equal(picker('z', {}, { metaKey: true }), null);
  });

  test('picker: digits only on an empty filter; Tab = Uncategorized; Esc/Backspace go back', () => {
    assert.equal(picker('3'), 'digit');
    assert.equal(picker('0'), 'digit');
    assert.equal(picker('3', { empty: false }), null);
    assert.equal(picker('Tab'), 'uncategorized');
    assert.equal(picker('Tab', {}, { shiftKey: true }), null);
    assert.equal(picker('Escape'), 'back');
    assert.equal(picker('Backspace'), 'back');
    assert.equal(picker('Backspace', { empty: false }), null);
    assert.equal(picker('Enter'), 'pick');
    assert.equal(picker('ArrowDown'), 'down');
    assert.equal(picker('ArrowUp'), 'up');
    assert.equal(picker('d'), null);
  });
});

describe('moveIndex', () => {
  test('clamps at both ends (no wrapping)', () => {
    assert.equal(moveIndex(0, 1, 3), 1);
    assert.equal(moveIndex(2, 1, 3), 2);
    assert.equal(moveIndex(0, -1, 3), 0);
    assert.equal(moveIndex(1, -1, 3), 0);
  });

  test('nothing highlighted starts at the top; an empty list has no highlight', () => {
    assert.equal(moveIndex(-1, 1, 3), 0);
    assert.equal(moveIndex(-1, -1, 3), 0);
    assert.equal(moveIndex(0, 1, 0), -1);
  });
});
