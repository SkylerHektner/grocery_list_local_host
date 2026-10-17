// The cull dialog's logic (SPEC §3.4): which ingredients start checked, toggling, the live
// count, what to send and what to say afterwards. Pure; no DOM. The component is
// components/cull-dialog.js.
//
//   const groups = cullGroups(recipe, state);            // walk order, like the list
//   let checked = defaultChecked(groups);                // all but staples (unless on the list)
//   countLabel(checked.size, ingredientOrder(groups).length)   // "Adding 9 of 11"
//   api.addRecipeToList(recipe.id, chosenIds(recipe, checked))

import { ingredientGroups, ingredientOrder } from './recipes-model.js';
import { plural } from './list-model.js';

export { ingredientOrder };

/**
 * The dialog's rows: the recipe's ingredients grouped by category in walk order, sorted by name
 * (see ingredientGroups()), each with its `staple` and `onList` tags.
 * @param {{item_ids: number[]}} recipe
 * @param {object} state  derived store state
 */
export function cullGroups(recipe, state) {
  return ingredientGroups(recipe, state);
}

const rowsOf = (groups) => groups.flatMap((g) => g.rows);

/**
 * Ingredients checked when the dialog opens: everything except staples. A staple that is on the
 * list already stays checked (confirming only adds the recipe as a source there).
 * @param {import('./recipes-model.js').IngredientGroup[]} groups
 * @returns {Set<number>}
 */
export function defaultChecked(groups) {
  return new Set(rowsOf(groups).filter((r) => !r.staple || r.onList).map((r) => r.item.id));
}

/**
 * Keeps the user's choices across a live-sync update: rows seen before keep their state, new
 * rows get the default, rows that left the recipe are dropped.
 * @param {Set<number>} checked  current choices
 * @param {Set<number>} seen     item ids the user has seen (the rows before the update)
 * @param {import('./recipes-model.js').IngredientGroup[]} groups  the rows now
 * @returns {Set<number>}
 */
export function reconcileChecked(checked, seen, groups) {
  const defaults = defaultChecked(groups);
  const next = new Set();
  for (const { item } of rowsOf(groups)) {
    if (seen.has(item.id) ? checked.has(item.id) : defaults.has(item.id)) next.add(item.id);
  }
  return next;
}

/**
 * `a`: checks everything, or unchecks everything when all are checked already.
 * @param {Set<number>} checked
 * @param {number[]} ids  every row's item id
 * @returns {Set<number>}
 */
export function toggleAll(checked, ids) {
  return ids.every((id) => checked.has(id)) ? new Set() : new Set(ids);
}

/** Flips one row. */
export function toggleOne(checked, id) {
  const next = new Set(checked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The live count: "Adding 9 of 11". */
export function countLabel(n, total) {
  return `Adding ${n} of ${total}`;
}

/**
 * What to send as `item_ids`: the checked ingredients, in the recipe's own order.
 * @param {{item_ids: number[]}} recipe
 * @param {Set<number>} checked
 */
export function chosenIds(recipe, checked) {
  return recipe.item_ids.filter((id) => checked.has(id));
}

/**
 * The toast after confirming. `changed`: whether the list changed at all (re-adding a recipe
 * that is fully on the list already changes nothing, so there is nothing to undo either).
 * @param {string} name   recipe name
 * @param {number} count  ingredients kept
 * @param {boolean} changed
 */
export function addedMessage(name, count, changed) {
  if (!changed) return `${name} is already on the list`;
  if (!count) return `Added ${name} without any items`;
  return `Added ${plural(count, 'item')} from ${name}`;
}

/**
 * True when the list differs between two derived states (entries, sources, notes or chips).
 * @param {object|null} before
 * @param {object} after
 */
export function listChanged(before, after) {
  if (!before) return true;
  return JSON.stringify(before.list) !== JSON.stringify(after.list);
}

/**
 * What a keydown on an ingredient row does: ↓/j 'down', ↑/k 'up', Home 'first', End 'last',
 * `a` 'toggle-all'. Space (toggle), Enter (confirm) and Esc (cancel) are handled by the
 * checkbox and the dialog themselves. Keys with modifiers are never handled.
 * @param {{key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean}} e
 * @returns {null|'down'|'up'|'first'|'last'|'toggle-all'}
 */
export function cullKeyAction(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  switch (e.key) {
    case 'ArrowDown':
    case 'j':
      return 'down';
    case 'ArrowUp':
    case 'k':
      return 'up';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'a':
    case 'A':
      return 'toggle-all';
    default:
      return null;
  }
}
