// The Recipes view's data shaping (SPEC §3.7): the filterable index, ingredient order and the
// ingredient edits the editor sends. Pure; no DOM. Works on the derived state from store.js.
//
//   filterRecipes('tac', state.recipes)   // -> {query, results: [{recipe, text, ranges}], createName}
//   ingredientGroups(recipe, state)       // -> [{key, name, rows: [{item, staple, onList}]}]

import { normalize, search } from './fuzzy.js';
import { compareNames, plural } from './list-model.js';

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * @typedef {object} RecipeResult
 * @property {object} recipe
 * @property {string} text                     the recipe name (what `ranges` index into)
 * @property {Array<[number, number]>} ranges  matched characters to highlight
 */

/**
 * The index for a filter text: every recipe by name when the filter is blank, else the fuzzy
 * matches, best first. `createName` is the name a `+ New recipe "…"` row would create: the
 * collapsed filter text, or null when it is blank or already names a recipe exactly.
 * @param {string} query
 * @param {object[]} recipes
 * @returns {{query: string, results: RecipeResult[], createName: string|null}}
 */
export function filterRecipes(query, recipes) {
  const text = collapse(query);
  const norm = normalize(text);
  if (!norm) {
    const results = [...recipes]
      .sort((a, b) => compareNames(a.name, b.name))
      .map((recipe) => ({ recipe, text: recipe.name, ranges: [] }));
    return { query: '', results, createName: null };
  }
  const results = search(text, recipes).map((r) => ({ recipe: r.item, text: r.text, ranges: r.ranges }));
  const exact = recipes.some((r) => normalize(r.name) === norm);
  return { query: text, results, createName: exact ? null : text };
}

/**
 * @typedef {object} IngredientRow
 * @property {object} item
 * @property {boolean} staple   the item is a staple ("usually have it")
 * @property {boolean} onList   the item is on the list already
 */

/**
 * @typedef {object} IngredientGroup
 * @property {string} key            `cat-<id>`, or `cat-none` for Uncategorized
 * @property {object|null} category
 * @property {string} name           category name, or "Uncategorized"
 * @property {IngredientRow[]} rows  sorted by name
 */

/**
 * A recipe's ingredients the way the list shows items: grouped by category in walk order,
 * Uncategorized last, sorted by name inside a group. Unknown item ids are skipped.
 * @param {{item_ids: number[]}} recipe
 * @param {object} state  derived store state
 * @returns {IngredientGroup[]}
 */
export function ingredientGroups(recipe, state) {
  const byCategory = new Map();
  for (const id of recipe.item_ids) {
    const item = state.itemsById.get(id);
    if (!item) continue;
    const categoryId = state.categoriesById.has(item.category_id) ? item.category_id : null;
    if (!byCategory.has(categoryId)) byCategory.set(categoryId, []);
    byCategory.get(categoryId).push({ item, staple: !!item.staple, onList: state.entriesByItemId.has(id) });
  }
  const groups = [];
  const push = (category, rows) => {
    rows.sort((a, b) => compareNames(a.item.name, b.item.name));
    groups.push({
      key: category ? `cat-${category.id}` : 'cat-none',
      category,
      name: category ? category.name : 'Uncategorized',
      rows,
    });
  };
  for (const category of state.categories) {
    const rows = byCategory.get(category.id);
    if (rows) push(category, rows);
  }
  if (byCategory.has(null)) push(null, byCategory.get(null));
  return groups;
}

/** Item ids of `ingredientGroups()` in display order (top to bottom). */
export function ingredientOrder(groups) {
  return groups.flatMap((g) => g.rows.map((r) => r.item.id));
}

/**
 * The recipe's `item_ids` with `itemId` appended, or null when it is already an ingredient.
 * @param {{item_ids: number[]}} recipe
 * @param {number} itemId
 */
export function withIngredient(recipe, itemId) {
  return recipe.item_ids.includes(itemId) ? null : [...recipe.item_ids, itemId];
}

/** The recipe's `item_ids` without `itemId`. */
export function withoutIngredient(recipe, itemId) {
  return recipe.item_ids.filter((id) => id !== itemId);
}

/**
 * Undo of a removal: `itemId` back at `index` (clamped), or null when it is an ingredient again.
 * @param {{item_ids: number[]}} recipe
 * @param {number} itemId
 * @param {number} index
 */
export function restoreIngredient(recipe, itemId, index) {
  if (recipe.item_ids.includes(itemId)) return null;
  const ids = [...recipe.item_ids];
  ids.splice(Math.min(Math.max(index, 0), ids.length), 0, itemId);
  return ids;
}

/**
 * Ingredient names in recipe order, for the one-line preview under a recipe in the index.
 * @param {{item_ids: number[]}} recipe
 * @param {object} state
 */
export function ingredientNames(recipe, state) {
  return recipe.item_ids
    .map((id) => state.itemsById.get(id)?.name)
    .filter(Boolean)
    .join(', ');
}

/** "11 ingredients" / "1 ingredient" / "No ingredients yet". */
export function ingredientCount(recipe) {
  const n = recipe.item_ids.length;
  return n ? plural(n, 'ingredient') : 'No ingredients yet';
}

/**
 * The line under the index title: "4 recipes · 1 on the list", or "No recipes yet".
 * @param {object} state
 */
export function recipesSummary(state) {
  const n = state.recipes.length;
  if (!n) return 'No recipes yet';
  const onList = state.recipes.filter((r) => state.listRecipeIds.has(r.id)).length;
  return [plural(n, 'recipe'), onList && `${onList} on the list`].filter(Boolean).join(' · ');
}

/**
 * The recipe id in a `#/recipes/<id>` route param, or null when it is not a positive integer.
 * @param {string|undefined} param
 */
export function recipeIdParam(param) {
  return /^[1-9][0-9]{0,15}$/.test(String(param ?? '')) ? Number(param) : null;
}
