// The Store order view's logic (SPEC §3.9): moving a category in the walk, reconciling a locally
// pending order with the server's, item counts and messages. Pure; no DOM.
//
//   moveId([1, 2, 3], 1, +1)          // -> [2, 1, 3]   (null when it can't move)
//   reconcileOrder([2, 1, 3], [1, 2, 3, 4])   // -> [2, 1, 3, 4]

import { plural } from './list-model.js';

/**
 * `order` with `id` moved `delta` places (−1 = earlier in the walk); null when `id` is not in
 * it or the move would leave the list.
 * @param {number[]} order
 * @param {number} id
 * @param {number} delta
 * @returns {number[] | null}
 */
export function moveId(order, id, delta) {
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || delta === 0 || to < 0 || to >= order.length) return null;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * A full permutation of `current` (the server's category ids) that follows `desired` (a local
 * order that may predate categories added or deleted since): ids gone from `current` are
 * dropped, ids missing from `desired` keep their place at the end, in `current` order.
 * @param {number[]} desired
 * @param {number[]} current
 */
export function reconcileOrder(desired, current) {
  const known = new Set(current);
  const seen = new Set();
  const out = [];
  for (const id of [...desired, ...current]) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Same ids in the same order. */
export function sameOrder(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Items per category, and how many are Uncategorized (no or an unknown category).
 * @param {object} state  derived store state
 * @returns {{byId: Map<number, number>, uncategorized: number}}
 */
export function categoryCounts(state) {
  const byId = new Map(state.categories.map((c) => [c.id, 0]));
  let uncategorized = 0;
  for (const item of state.items) {
    if (byId.has(item.category_id)) byId.set(item.category_id, byId.get(item.category_id) + 1);
    else uncategorized += 1;
  }
  return { byId, uncategorized };
}

/** "12 items" / "1 item" / "No items". */
export function countLabel(n) {
  return n ? plural(n, 'item') : 'No items';
}

/** The delete confirmation: how many items become Uncategorized. */
export function deleteCategoryMessage(count) {
  if (!count) return "No items use it. This can't be undone.";
  const verb = count === 1 ? 'becomes' : 'become';
  const pronoun = count === 1 ? 'it' : 'them';
  return `Its ${plural(count, 'item')} ${verb} Uncategorized (last on the list) until you pick a new category for ${pronoun}. This can't be undone.`;
}

/**
 * What a keydown on a focused category row does: 'up', 'down', 'first', 'last' (focus),
 * 'move-up', 'move-down' (Alt+↑/↓: reorder), 'rename', 'delete', or null.
 * @param {{key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean}} e
 */
export function categoryKeyAction(e) {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.altKey) {
    if (e.key === 'ArrowUp') return 'move-up';
    if (e.key === 'ArrowDown') return 'move-down';
    return null;
  }
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
    case 'Enter':
    case 'F2':
      return 'rename';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    default:
      return null;
  }
}
