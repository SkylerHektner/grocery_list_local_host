// The List view's data shaping (SPEC §3.5). Pure; no DOM. Works on the derived state from
// store.js (`itemsById`, `categoriesById`, `recipesById`, `list`, ...).

/**
 * Name order inside a group, the same as the export (src/export.rs): lowercase first, then the
 * name as written.
 */
export function compareNames(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @typedef {object} ListRow
 * @property {object} entry     the list entry (`item_id`, `note`, `sources`)
 * @property {object} item      the catalog item
 * @property {object[]} recipes recipes among the entry's sources, in source order
 */

/**
 * @typedef {object} ListGroup
 * @property {string} key             `cat-<id>`, or `cat-none` for Uncategorized
 * @property {object|null} category   null for Uncategorized
 * @property {string} name            category name, or "Uncategorized"
 * @property {ListRow[]} rows         sorted by name
 */

/**
 * Groups the list's entries by category in walk order, Uncategorized last, sorted by name
 * within a group. Empty groups are left out; entries naming an unknown item are skipped.
 * @param {object} state     derived store state
 * @param {object} [options]
 * @param {Set<number>} [options.hidden]  item ids to leave out (removals in flight)
 * @param {Map<number, string|null>} [options.notes]  note overrides (edits in flight)
 * @returns {ListGroup[]}
 */
export function groupEntries(state, { hidden, notes } = {}) {
  const byCategory = new Map();
  for (const entry of state.list.entries) {
    if (hidden?.has(entry.item_id)) continue;
    const item = state.itemsById.get(entry.item_id);
    if (!item) continue;
    const categoryId = state.categoriesById.has(item.category_id) ? item.category_id : null;
    const recipes = [];
    for (const source of entry.sources ?? []) {
      if (source.kind !== 'recipe') continue;
      const recipe = state.recipesById.get(source.recipe_id);
      if (recipe) recipes.push(recipe);
    }
    const shown = notes?.has(entry.item_id) ? { ...entry, note: notes.get(entry.item_id) } : entry;
    if (!byCategory.has(categoryId)) byCategory.set(categoryId, []);
    byCategory.get(categoryId).push({ entry: shown, item, recipes });
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
  const uncategorized = byCategory.get(null);
  if (uncategorized) push(null, uncategorized);
  return groups;
}

/** Item ids in display order (top to bottom). */
export function displayOrder(groups) {
  return groups.flatMap((g) => g.rows.map((r) => r.item.id));
}

/**
 * Where focus goes when `id` leaves the list: the next row, else the previous one, else null.
 * @param {number[]} order  display order before the removal
 * @param {number} id
 */
export function neighborAfterRemoval(order, id) {
  const index = order.indexOf(id);
  if (index < 0) return order[0] ?? null;
  return order[index + 1] ?? order[index - 1] ?? null;
}

/**
 * The row to focus after a re-render dropped the focused row (removed on another device): the
 * one now at its old position, else the last one, else null.
 * @param {number[]} before  display order before
 * @param {number[]} after   display order after
 * @param {number} id        the row that had focus
 */
export function fallbackFocus(before, after, id) {
  if (after.includes(id)) return id;
  if (!after.length) return null;
  const index = before.indexOf(id);
  // The first row after the old position that is still on the list, else the closest before.
  for (let i = index + 1; i < before.length; i++) if (after.includes(before[i])) return before[i];
  for (let i = index - 1; i >= 0; i--) if (after.includes(before[i])) return before[i];
  return after[Math.min(Math.max(index, 0), after.length - 1)];
}

/**
 * Item ids on the list in `next` but not in `prev` (for the "just added" highlight).
 * @param {object|null} prev  derived state
 * @param {object} next
 * @returns {number[]}
 */
export function addedEntries(prev, next) {
  if (!prev) return [];
  return next.list.entries.map((e) => e.item_id).filter((id) => !prev.entriesByItemId.has(id));
}

/** `plural(1, 'item')` -> "1 item", `plural(3, 'item')` -> "3 items". */
export function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

/**
 * The line under the title: "12 items · 2 recipes", or "Nothing on it yet".
 * @param {object} state
 */
export function summary(state) {
  const items = state.list.entries.length;
  const recipes = state.list.recipe_ids.length;
  if (!items && !recipes) return 'Nothing on it yet';
  return [plural(items, 'item'), recipes && plural(recipes, 'recipe')].filter(Boolean).join(' · ');
}
