// The Recipes view's data shaping (SPEC §3.7): the filterable index, ingredient order and the
// ingredient edits the editor sends. Pure; no DOM. Works on the derived state from store.js.
//
//   filterRecipes('tac', state.recipes)   // -> {query, results: [{recipe, text, ranges}], createName}
//   ingredientGroups(recipe, state)       // -> [{key, name, rows: [{item, note, staple, onList}]}]
//
// A recipe's `ingredients` are `[{item_id, note}]` in recipe order; the edit helpers return the
// new array to send as `ingredients` (notes travel with their items).

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
 * @property {string|null} note  the note the recipe gives the item's list entry
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
 * @param {{ingredients: Array<{item_id: number, note: string|null}>}} recipe
 * @param {object} state  derived store state
 * @param {{hidden?: Set<number>, notes?: Map<number, string|null>}} [overrides]
 *   pending local edits: ingredients to leave out, notes to show instead of the recipe's
 * @returns {IngredientGroup[]}
 */
export function ingredientGroups(recipe, state, { hidden, notes } = {}) {
  const byCategory = new Map();
  for (const { item_id: id, note } of recipe.ingredients) {
    const item = state.itemsById.get(id);
    if (!item || hidden?.has(id)) continue;
    const categoryId = state.categoriesById.has(item.category_id) ? item.category_id : null;
    if (!byCategory.has(categoryId)) byCategory.set(categoryId, []);
    byCategory.get(categoryId).push({
      item,
      note: (notes?.has(id) ? notes.get(id) : note) ?? null,
      staple: !!item.staple,
      onList: state.entriesByItemId.has(id),
    });
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

/** The recipe's ingredient item ids, in recipe order. */
export function ingredientIds(recipe) {
  return recipe.ingredients.map((i) => i.item_id);
}

/** Whether `itemId` is an ingredient of `recipe`. */
export function hasIngredient(recipe, itemId) {
  return recipe.ingredients.some((i) => i.item_id === itemId);
}

/** A note as the server stores it: whitespace collapsed, blank = null. */
export function normalizeNote(note) {
  return collapse(note) || null;
}

/**
 * The recipe's ingredients with `itemId` appended (with `note`), or null when it is already an
 * ingredient.
 * @param {{ingredients: object[]}} recipe
 * @param {number} itemId
 * @param {string|null} [note]
 */
export function withIngredient(recipe, itemId, note = null) {
  if (hasIngredient(recipe, itemId)) return null;
  return [...recipe.ingredients, { item_id: itemId, note: normalizeNote(note) }];
}

/** The recipe's ingredients without `itemId`. */
export function withoutIngredient(recipe, itemId) {
  return recipe.ingredients.filter((i) => i.item_id !== itemId);
}

/**
 * The recipe's ingredients with `itemId`'s note set to `note` (blank clears it), or null when it
 * is not an ingredient or already has that note.
 * @param {{ingredients: object[]}} recipe
 * @param {number} itemId
 * @param {string|null} note
 */
export function withIngredientNote(recipe, itemId, note) {
  const next = normalizeNote(note);
  const current = recipe.ingredients.find((i) => i.item_id === itemId);
  if (!current || (current.note ?? null) === next) return null;
  return recipe.ingredients.map((i) => (i.item_id === itemId ? { ...i, note: next } : i));
}

/**
 * Undo of a removal: the removed `ingredient` (note included) back at `index` (clamped), or
 * null when its item is an ingredient again.
 * @param {{ingredients: object[]}} recipe
 * @param {{item_id: number, note: string|null}} ingredient
 * @param {number} index
 */
export function restoreIngredient(recipe, ingredient, index) {
  if (hasIngredient(recipe, ingredient.item_id)) return null;
  const next = [...recipe.ingredients];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, ingredient);
  return next;
}

/**
 * Ingredient names in recipe order, for the one-line preview under a recipe in the index.
 * @param {{ingredients: object[]}} recipe
 * @param {object} state
 */
export function ingredientNames(recipe, state) {
  return recipe.ingredients
    .map((i) => state.itemsById.get(i.item_id)?.name)
    .filter(Boolean)
    .join(', ');
}

/** "11 ingredients" / "1 ingredient" / "No ingredients yet". */
export function ingredientCount(recipe) {
  const n = recipe.ingredients.length;
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
