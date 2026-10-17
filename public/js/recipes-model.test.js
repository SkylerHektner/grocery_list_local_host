import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { derive } from './store.js';
import {
  filterRecipes,
  hasIngredient,
  ingredientCount,
  ingredientGroups,
  ingredientIds,
  ingredientNames,
  ingredientOrder,
  recipeIdParam,
  recipesSummary,
  restoreIngredient,
  withIngredient,
  withIngredientNote,
  withoutIngredient,
} from './recipes-model.js';

const ings = (...ids) => ids.map((id) => ({ item_id: id, note: null }));

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

function state({ entries = [], recipeIds = [] } = {}) {
  return derive({
    version: 1,
    categories: [
      { id: 1, name: 'Produce' },
      { id: 2, name: 'Dairy' },
      { id: 3, name: 'Pantry' },
    ],
    items: [
      item(10, 'Milk', 2),
      item(11, 'limes', 1),
      item(12, 'Avocados', 1),
      item(13, 'Salt', 3, { staple: true }),
      item(14, 'Taco seasoning', null),
      item(15, 'Butter', 2, { staple: true }),
    ],
    recipes: [
      { id: 20, name: 'Tacos', ingredients: [...ings(14, 13), { item_id: 11, note: '2' }, ...ings(12, 10)] },
      { id: 21, name: 'guacamole', ingredients: ings(12, 11, 13) },
      { id: 22, name: 'Banana bread', ingredients: [] },
    ],
    list: {
      entries: entries.map((id) => ({ item_id: id, note: null, sources: [{ kind: 'manual' }], added_at: 1 })),
      recipe_ids: recipeIds,
    },
  });
}

describe('filterRecipes', () => {
  const s = state();

  test('a blank filter lists every recipe by name, case-insensitively, with no create row', () => {
    const { query, results, createName } = filterRecipes('   ', s.recipes);
    assert.equal(query, '');
    assert.deepEqual(results.map((r) => r.recipe.name), ['Banana bread', 'guacamole', 'Tacos']);
    assert.deepEqual(results[0].ranges, []);
    assert.equal(createName, null);
  });

  test('a filter ranks fuzzy matches with ranges and offers to create the typed name', () => {
    const { results, createName } = filterRecipes('ta', s.recipes);
    assert.equal(results[0].recipe.name, 'Tacos');
    assert.deepEqual(results[0].ranges, [[0, 2]]);
    assert.equal(createName, 'ta');
  });

  test('no create row when the filter names a recipe exactly (any case, extra spaces)', () => {
    assert.equal(filterRecipes('  TACOS ', s.recipes).createName, null);
    assert.equal(filterRecipes('banana  bread', s.recipes).createName, null);
  });

  test('the create name is the collapsed filter text', () => {
    const { results, createName } = filterRecipes('  Fish   tacos ', s.recipes);
    assert.equal(createName, 'Fish tacos');
    assert.ok(results.every((r) => r.recipe.name !== 'Fish tacos'));
  });

  test('typos still find the recipe', () => {
    assert.equal(filterRecipes('guacamloe', s.recipes).results[0]?.recipe.name, 'guacamole');
  });
});

describe('ingredientGroups', () => {
  test('groups by category in walk order, Uncategorized last, names sorted inside a group', () => {
    const s = state();
    const groups = ingredientGroups(s.recipesById.get(20), s);
    assert.deepEqual(
      groups.map((g) => [g.key, g.name, g.rows.map((r) => r.item.name)]),
      [
        ['cat-1', 'Produce', ['Avocados', 'limes']],
        ['cat-2', 'Dairy', ['Milk']],
        ['cat-3', 'Pantry', ['Salt']],
        ['cat-none', 'Uncategorized', ['Taco seasoning']],
      ],
    );
    assert.deepEqual(ingredientOrder(groups), [12, 11, 10, 13, 14]);
  });

  test('tags staples and items already on the list; skips unknown ids', () => {
    const s = state({ entries: [11] });
    const rows = ingredientGroups({ ingredients: ings(11, 13, 999) }, s).flatMap((g) => g.rows);
    assert.deepEqual(
      rows.map((r) => [r.item.name, r.staple, r.onList]),
      [
        ['limes', false, true],
        ['Salt', true, false],
      ],
    );
  });

  test('rows carry the recipe notes; pending edits hide rows and override notes', () => {
    const s = state();
    const notes = (groups) => groups.flatMap((g) => g.rows).map((r) => [r.item.name, r.note]);
    assert.deepEqual(notes(ingredientGroups(s.recipesById.get(20), s)).slice(0, 2), [
      ['Avocados', null],
      ['limes', '2'],
    ]);
    const overridden = ingredientGroups(s.recipesById.get(20), s, {
      hidden: new Set([10, 14]),
      notes: new Map([[11, null], [13, 'flaky']]),
    });
    assert.deepEqual(notes(overridden), [
      ['Avocados', null],
      ['limes', null],
      ['Salt', 'flaky'],
    ]);
  });

  test('an empty recipe has no groups', () => {
    const s = state();
    assert.deepEqual(ingredientGroups(s.recipesById.get(22), s), []);
  });
});

describe('ingredient edits', () => {
  const recipe = { ingredients: [...ings(1), { item_id: 2, note: '1 cup' }, ...ings(3)] };
  const ids = (ingredients) => ingredients.map((i) => i.item_id);

  test('ingredientIds and hasIngredient', () => {
    assert.deepEqual(ingredientIds(recipe), [1, 2, 3]);
    assert.ok(hasIngredient(recipe, 2));
    assert.ok(!hasIngredient(recipe, 4));
  });

  test('withIngredient appends (with a normalized note), or returns null when already there', () => {
    assert.deepEqual(withIngredient(recipe, 4).at(-1), { item_id: 4, note: null });
    assert.deepEqual(withIngredient(recipe, 4, '  2   dozen ').at(-1), { item_id: 4, note: '2 dozen' });
    assert.deepEqual(ids(withIngredient(recipe, 4)), [1, 2, 3, 4]);
    assert.equal(withIngredient(recipe, 2), null);
    assert.deepEqual(ids(recipe.ingredients), [1, 2, 3], 'not mutated');
  });

  test('withoutIngredient removes it; the other notes stay', () => {
    assert.deepEqual(withoutIngredient(recipe, 1), [{ item_id: 2, note: '1 cup' }, { item_id: 3, note: null }]);
    assert.deepEqual(ids(withoutIngredient(recipe, 9)), [1, 2, 3]);
  });

  test('withIngredientNote sets, normalizes and clears; null when nothing changes', () => {
    assert.deepEqual(withIngredientNote(recipe, 3, ' 4  cloves ')[2], { item_id: 3, note: '4 cloves' });
    assert.deepEqual(withIngredientNote(recipe, 2, '  ')[1], { item_id: 2, note: null });
    assert.equal(withIngredientNote(recipe, 2, '1 cup'), null);
    assert.equal(withIngredientNote(recipe, 1, ''), null);
    assert.equal(withIngredientNote(recipe, 9, 'x'), null);
    assert.equal(recipe.ingredients[1].note, '1 cup', 'not mutated');
  });

  test('restoreIngredient puts it back where it was (clamped, note kept), unless it is back already', () => {
    const two = { item_id: 2, note: '1 cup' };
    assert.deepEqual(restoreIngredient({ ingredients: ings(1, 3) }, two, 1), [...ings(1), two, ...ings(3)]);
    assert.deepEqual(ids(restoreIngredient({ ingredients: ings(1) }, two, 5)), [1, 2]);
    assert.deepEqual(ids(restoreIngredient({ ingredients: ings(1) }, two, -1)), [2, 1]);
    assert.equal(restoreIngredient(recipe, two, 0), null);
  });
});

describe('labels', () => {
  test('ingredientNames joins names in recipe order', () => {
    const s = state();
    assert.equal(ingredientNames(s.recipesById.get(21), s), 'Avocados, limes, Salt');
    assert.equal(ingredientNames(s.recipesById.get(22), s), '');
  });

  test('ingredientCount', () => {
    assert.equal(ingredientCount({ ingredients: ings(1) }), '1 ingredient');
    assert.equal(ingredientCount({ ingredients: ings(1, 2) }), '2 ingredients');
    assert.equal(ingredientCount({ ingredients: [] }), 'No ingredients yet');
  });

  test('recipesSummary counts recipes and chips on the list', () => {
    assert.equal(recipesSummary(state()), '3 recipes');
    assert.equal(recipesSummary(state({ recipeIds: [20] })), '3 recipes · 1 on the list');
    assert.equal(recipesSummary(derive({ version: 1, recipes: [] })), 'No recipes yet');
  });

  test('recipeIdParam accepts positive integers only', () => {
    assert.equal(recipeIdParam('12'), 12);
    for (const bad of ['0', '-1', '1.5', 'abc', '', undefined, '12abc', '1e3', '01']) {
      assert.equal(recipeIdParam(bad), null, String(bad));
    }
  });
});
