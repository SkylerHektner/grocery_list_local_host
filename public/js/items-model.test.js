import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { derive } from './store.js';
import {
  cleanAliases,
  deleteMessage,
  draftChanged,
  errorField,
  filterCounts,
  filterItems,
  MERGE_BLANK_LIMIT,
  formatAliases,
  itemBody,
  itemRowLabel,
  itemKeyAction,
  itemRecipes,
  itemsSummary,
  joinNames,
  mergeMessage,
  mergeOptions,
  normalizeName,
  parseAliases,
  usageLabel,
} from './items-model.js';

const item = (id, name, category_id, extra = {}) => ({
  id,
  name,
  category_id,
  aliases: [],
  staple: false,
  use_count: 0,
  last_used: 0,
  ...extra,
});

function state({ entries = [] } = {}) {
  return derive({
    version: 1,
    categories: [
      { id: 1, name: 'Produce' },
      { id: 2, name: 'Deli & Cheese' },
      { id: 3, name: 'Pantry' },
    ],
    items: [
      item(10, 'Parmigiano Reggiano', 2, { aliases: ['Parmesan'], use_count: 4 }),
      item(11, 'limes', 1),
      item(12, 'Salt', 3, { staple: true, aliases: ['Kosher salt'] }),
      item(13, 'Taco seasoning', null),
      item(14, 'Birthday candles', 99), // unknown category: uncategorized
      item(15, 'Pecorino', null, { aliases: ['Romano'], use_count: 2 }),
    ],
    recipes: [
      { id: 20, name: 'Tacos', item_ids: [13, 11, 12] },
      { id: 21, name: 'Carbonara', item_ids: [10, 12, 15] },
      { id: 22, name: 'Cacio e pepe', item_ids: [15] },
    ],
    list: {
      entries: entries.map((id) => ({ item_id: id, note: null, sources: [{ kind: 'manual' }], added_at: 1 })),
      recipe_ids: [],
    },
  });
}

describe('filterItems', () => {
  const s = state();
  const names = (model) => model.results.map((r) => r.item.name);

  test('a blank filter lists every item by name, case-insensitively, with no create row', () => {
    const model = filterItems('   ', s);
    assert.deepEqual(names(model), ['Birthday candles', 'limes', 'Parmigiano Reggiano', 'Pecorino', 'Salt', 'Taco seasoning']);
    assert.equal(model.query, '');
    assert.equal(model.createName, null);
    assert.deepEqual(model.results[0].ranges, []);
  });

  test('fuzzy matches name and aliases; the matched alias is reported', () => {
    const model = filterItems('parmesan', s);
    assert.equal(model.results[0].item.name, 'Parmigiano Reggiano');
    assert.equal(model.results[0].alias, 'Parmesan');
    assert.equal(model.results[0].text, 'Parmesan');
    assert.deepEqual(model.results[0].ranges, [[0, 8]]);
    assert.equal(model.createName, null); // an exact alias: nothing to create
  });

  test('createName is the collapsed text unless it names an item exactly', () => {
    assert.equal(filterItems('  birthday   cake ', s).createName, 'birthday cake');
    assert.equal(filterItems('SALT', s).createName, null);
    assert.equal(filterItems('kosher salt', s).createName, null);
    assert.equal(filterItems('sal', s).createName, 'sal');
  });

  test('the chips keep only uncategorized items and/or staples, also while filtering', () => {
    assert.deepEqual(names(filterItems('', s, { uncategorized: true })), ['Birthday candles', 'Pecorino', 'Taco seasoning']);
    assert.deepEqual(names(filterItems('', s, { staples: true })), ['Salt']);
    assert.deepEqual(names(filterItems('', s, { staples: true, uncategorized: true })), []);
    assert.deepEqual(names(filterItems('t', s, { uncategorized: true })), ['Taco seasoning']);
    // The create row stays available whatever the chips say.
    assert.equal(filterItems('lime pickle', s, { staples: true }).createName, 'lime pickle');
  });
});

test('filterCounts and itemsSummary', () => {
  const s = state();
  assert.deepEqual(filterCounts(s), { uncategorized: 3, staples: 1 });
  assert.equal(itemsSummary(s), '6 items · 3 uncategorized · 1 staple');
  const empty = derive({ version: 1, categories: [], items: [], recipes: [], list: { entries: [], recipe_ids: [] } });
  assert.equal(itemsSummary(empty), 'No items yet');
});

test('usageLabel: nothing for never-added items', () => {
  assert.equal(usageLabel(item(1, 'A', null)), null);
  assert.equal(usageLabel(item(1, 'A', null, { use_count: 4 })), 'added 4×');
});

test('itemRowLabel sums a row up for screen readers', () => {
  const s = state({ entries: [12] });
  assert.equal(itemRowLabel(s.itemsById.get(12), s), 'Salt, Pantry, staple, on the list, also Kosher salt');
  assert.equal(itemRowLabel(s.itemsById.get(10), s), 'Parmigiano Reggiano, Deli & Cheese, also Parmesan, added 4 times');
  assert.equal(itemRowLabel(s.itemsById.get(14), s), 'Birthday candles, Uncategorized');
  assert.equal(itemRowLabel({ ...s.itemsById.get(11), use_count: 1 }, s), 'limes, Produce, added once');
});

describe('editing', () => {
  test('normalizeName mirrors the server: collapse whitespace, uppercase the first character', () => {
    assert.equal(normalizeName('  bBQ   sauce '), 'BBQ sauce');
    assert.equal(normalizeName('   '), '');
    assert.equal(normalizeName('élan'), 'Élan');
  });

  test('parseAliases / formatAliases round trip; blanks are dropped', () => {
    assert.deepEqual(parseAliases(' parmesan ,  parm  reg,, '), ['parmesan', 'parm reg']);
    assert.deepEqual(parseAliases(''), []);
    assert.equal(formatAliases(['Parmesan', 'Parm']), 'Parmesan, Parm');
    assert.equal(formatAliases(undefined), '');
  });

  test('cleanAliases drops duplicates and the own name, case-insensitively', () => {
    assert.deepEqual(cleanAliases(['parmesan', 'PARMESAN', 'parm', 'parmigiano'], 'Parmigiano'), ['Parmesan', 'Parm']);
  });

  test('itemBody is the full PUT body with changes applied', () => {
    const salt = state().itemsById.get(12);
    assert.deepEqual(itemBody(salt, { staple: false }), {
      name: 'Salt',
      category_id: 3,
      aliases: ['Kosher salt'],
      staple: false,
    });
    assert.deepEqual(itemBody(item(1, 'A', undefined)), { name: 'A', category_id: null, aliases: [], staple: false });
  });

  test('draftChanged ignores what the server normalizes away', () => {
    const salt = state().itemsById.get(12);
    const draft = (changes) => ({ ...itemBody(salt), ...changes });
    assert.equal(draftChanged(salt, draft({ name: ' salt ', aliases: ['kosher salt', 'Salt', ''] })), false);
    assert.equal(draftChanged(salt, draft({ name: 'Sea salt' })), true);
    assert.equal(draftChanged(salt, draft({ aliases: ['Kosher salt', 'Fleur de sel'] })), true);
    assert.equal(draftChanged(salt, draft({ aliases: [] })), true);
    assert.equal(draftChanged(salt, draft({ category_id: null })), true);
    assert.equal(draftChanged(salt, draft({ staple: false })), true);
  });

  test('errorField maps a server message to the field it is about', () => {
    assert.equal(errorField('an item named "Milk" already exists'), 'name');
    assert.equal(errorField('"Parmesan" is already an alias of "Parmigiano Reggiano"'), 'name');
    assert.equal(errorField('alias "Milk" is already the name of item "Milk"'), 'aliases');
    assert.equal(errorField('alias is too long (81 characters, max 80)'), 'aliases');
    assert.equal(errorField('category 99 does not exist'), 'category');
    assert.equal(errorField(undefined), 'name');
  });
});

describe('delete & merge messages', () => {
  test('itemRecipes and joinNames', () => {
    assert.deepEqual(itemRecipes(12, state()).map((r) => r.name), ['Carbonara', 'Tacos']);
    assert.equal(joinNames([]), '');
    assert.equal(joinNames(['Tacos']), 'Tacos');
    assert.equal(joinNames(['A', 'B']), 'A and B');
    assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
    assert.equal(joinNames(['A', 'B', 'C', 'D', 'E']), 'A, B, C and 2 more');
  });

  test('deleteMessage names the recipes and the list', () => {
    assert.equal(deleteMessage(state({ entries: [12] }).itemsById.get(12), state({ entries: [12] })), "It comes out of Carbonara and Tacos, and off the list. This can't be undone.");
    assert.equal(deleteMessage(state().itemsById.get(12), state()), "It comes out of Carbonara and Tacos. This can't be undone.");
    const s = state({ entries: [14] });
    assert.equal(deleteMessage(s.itemsById.get(14), s), "It comes off the list too. This can't be undone.");
    assert.equal(deleteMessage(state().itemsById.get(14), state()), "It isn't in any recipe or on the list. This can't be undone.");
  });

  test('mergeMessage explains the alias, recipes, list and category', () => {
    let s = state();
    const pecorino = s.itemsById.get(15);
    const parm = s.itemsById.get(10);
    assert.equal(
      mergeMessage(pecorino, parm, s),
      "Pecorino will become an alias of Parmigiano Reggiano; 2 recipes updated. This can't be undone.",
    );
    s = state({ entries: [10] });
    assert.match(mergeMessage(s.itemsById.get(12), s.itemsById.get(10), s), /^Salt will become .*; 2 recipes updated\. This/);
    s = state({ entries: [10, 15] });
    assert.match(mergeMessage(s.itemsById.get(15), s.itemsById.get(10), s), /Their list entries are combined\./);
    s = state({ entries: [15] });
    assert.match(mergeMessage(s.itemsById.get(15), s.itemsById.get(10), s), /Its list entry becomes Parmigiano Reggiano\./);
    // B is uncategorized: it takes A's category.
    assert.match(mergeMessage(s.itemsById.get(11), s.itemsById.get(13), s), /^limes will become an alias of Taco seasoning; 1 recipe updated\. Taco seasoning moves to Produce\./);
  });

  test('mergeOptions offers every other item, by name or fuzzy', () => {
    const s = state();
    const from = s.itemsById.get(15);
    const all = mergeOptions('', from, s).map((r) => r.item.name);
    assert.equal(all.length, 5);
    assert.ok(!all.includes('Pecorino'));
    assert.equal(all[0], 'Birthday candles');
    const found = mergeOptions('parmesan', from, s);
    assert.equal(found[0].item.name, 'Parmigiano Reggiano');
    assert.equal(found[0].alias, 'Parmesan');
    assert.deepEqual(mergeOptions('romano', from, s), []);
  });

  test('mergeOptions lists only the first MERGE_BLANK_LIMIT items while the filter is blank', () => {
    const items = Array.from({ length: 300 }, (_, i) => item(1000 + i, `Thing ${String(i).padStart(3, '0')}`, 1));
    const s = derive({ version: 1, categories: [{ id: 1, name: 'Produce' }], items, recipes: [], list: { entries: [], recipe_ids: [] } });
    const blank = mergeOptions('', items[0], s);
    assert.equal(blank.length, MERGE_BLANK_LIMIT);
    assert.equal(blank[0].item.name, 'Thing 001');
    assert.equal(mergeOptions('thing 299', items[0], s)[0].item.name, 'Thing 299');
  });
});

describe('itemKeyAction', () => {
  const key = (k, mods = {}) => itemKeyAction({ key: k, ...mods });

  test('navigation, edit and row actions', () => {
    assert.equal(key('ArrowDown'), 'down');
    assert.equal(key('j'), 'down');
    assert.equal(key('ArrowUp'), 'up');
    assert.equal(key('k'), 'up');
    assert.equal(key('Home'), 'first');
    assert.equal(key('End'), 'last');
    assert.equal(key('Enter'), 'edit');
    assert.equal(key('F2'), 'edit');
    assert.equal(key('s'), 'staple');
    assert.equal(key('c'), 'category');
    assert.equal(key('m'), 'merge');
    assert.equal(key('Delete'), 'delete');
    assert.equal(key('Backspace'), 'delete');
    assert.equal(key('Escape'), 'search');
    assert.equal(key('/'), 'search');
  });

  test('modified keys and others are not handled', () => {
    assert.equal(key('s', { ctrlKey: true }), null);
    assert.equal(key('c', { metaKey: true }), null);
    assert.equal(key('ArrowDown', { altKey: true }), null);
    assert.equal(key('S', { shiftKey: true }), null);
    assert.equal(key('q'), null);
  });
});
