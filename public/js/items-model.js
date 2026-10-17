// The Items view's data shaping (SPEC §3.8): the filterable catalog, the inline editor's draft
// and the confirm-dialog messages for delete and merge. Pure; no DOM. Works on the derived state
// from store.js.
//
//   filterItems('parm', state, { staples: false, uncategorized: false })
//   // -> {query: 'parm', results: [{item, text, ranges, alias}], createName: 'Parm'}

import { normalize, search } from './fuzzy.js';
import { compareNames, plural } from './list-model.js';

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Max fuzzy matches in the merge picker. */
export const MERGE_LIMIT = 30;

/** True when the item has no (existing) category. */
export function isUncategorized(item, state) {
  return !state.categoriesById.has(item.category_id);
}

/** True when `norm` (normalized text) is exactly the item's name or one of its aliases. */
function namesExactly(item, norm) {
  return normalize(item.name) === norm || (item.aliases ?? []).some((a) => normalize(a) === norm);
}

/**
 * @typedef {object} ItemResult
 * @property {object} item
 * @property {string} text         the text that matched: the name, or `alias`
 * @property {Array<[number, number]>} ranges  matched characters in `text`
 * @property {string|null} alias   the alias that matched (null: the name did, or no filter)
 */

/**
 * The catalog for a filter text and the quick-filter chips: every item by name when the text
 * is blank, else the fuzzy matches (name and aliases), best first. `createName` is the name a
 * `+ New item "…"` row would create: the collapsed text, or null when it is blank or already
 * names an item (or an alias) exactly. The chips never hide the create row.
 * @param {string} query
 * @param {object} state  derived store state
 * @param {{uncategorized?: boolean, staples?: boolean}} [filters]
 * @returns {{query: string, results: ItemResult[], createName: string|null}}
 */
export function filterItems(query, state, filters = {}) {
  const text = collapse(query);
  const norm = normalize(text);
  const keep = (item) =>
    (!filters.uncategorized || isUncategorized(item, state)) && (!filters.staples || item.staple);
  if (!norm) {
    const results = state.items
      .filter(keep)
      .sort((a, b) => compareNames(a.name, b.name))
      .map((item) => ({ item, text: item.name, ranges: [], alias: null }));
    return { query: '', results, createName: null };
  }
  const results = search(text, state.items)
    .filter((r) => keep(r.item))
    .map((r) => ({ item: r.item, text: r.text, ranges: r.ranges, alias: r.alias }));
  const exact = state.items.some((item) => namesExactly(item, norm));
  return { query: text, results, createName: exact ? null : text };
}

/** Counts for the quick-filter chips. */
export function filterCounts(state) {
  let uncategorized = 0;
  let staples = 0;
  for (const item of state.items) {
    if (isUncategorized(item, state)) uncategorized += 1;
    if (item.staple) staples += 1;
  }
  return { uncategorized, staples };
}

/** The line under the title: "45 items · 2 uncategorized · 8 staples", or "No items yet". */
export function itemsSummary(state) {
  const n = state.items.length;
  if (!n) return 'No items yet';
  const { uncategorized, staples } = filterCounts(state);
  return [
    plural(n, 'item'),
    uncategorized && `${uncategorized} uncategorized`,
    staples && plural(staples, 'staple'),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "added 4×" / "never added" (times the item was put on the list). */
export function usageLabel(item) {
  const n = item.use_count ?? 0;
  return n ? `added ${n}×` : 'never added';
}

// ── Editing ─────────────────────────────────────────────────────────────────────────────────

/** The server's name normalization (SPEC §2.3): whitespace collapsed, first character upper. */
export function normalizeName(raw) {
  const s = collapse(raw);
  if (!s) return '';
  const first = String.fromCodePoint(s.codePointAt(0));
  return first.toUpperCase() + s.slice(first.length);
}

/** "Parmesan, parm ," -> ['Parmesan', 'parm'] (blank entries dropped; the server normalizes). */
export function parseAliases(text) {
  return String(text ?? '')
    .split(',')
    .map(collapse)
    .filter(Boolean);
}

/** The aliases as the editor's comma-separated text. */
export function formatAliases(aliases) {
  return (aliases ?? []).join(', ');
}

/** Aliases as the server will store them: normalized, no blanks, no duplicates, not the name. */
export function cleanAliases(aliases, ownName) {
  const own = normalizeName(ownName).toLowerCase();
  const out = [];
  for (const raw of aliases ?? []) {
    const alias = normalizeName(raw);
    const key = alias.toLowerCase();
    if (!alias || key === own || out.some((a) => a.toLowerCase() === key)) continue;
    out.push(alias);
  }
  return out;
}

/**
 * The full `PUT /api/items/{id}` body: the item's editable fields with `changes` applied.
 * @param {object} item
 * @param {{name?: string, category_id?: number|null, aliases?: string[], staple?: boolean}} [changes]
 */
export function itemBody(item, changes = {}) {
  return {
    name: item.name,
    category_id: item.category_id ?? null,
    aliases: [...(item.aliases ?? [])],
    staple: !!item.staple,
    ...changes,
  };
}

/**
 * True when saving `draft` would change the item (after the server's normalization).
 * @param {object} item
 * @param {{name: string, category_id: number|null, aliases: string[], staple: boolean}} draft
 */
export function draftChanged(item, draft) {
  const name = normalizeName(draft.name);
  const aliases = cleanAliases(draft.aliases, name);
  return (
    name !== item.name ||
    (draft.category_id ?? null) !== (item.category_id ?? null) ||
    !!draft.staple !== !!item.staple ||
    aliases.length !== (item.aliases ?? []).length ||
    aliases.some((a, i) => a !== item.aliases[i])
  );
}

/** Which editor field a server validation message is about: 'name', 'aliases' or 'category'. */
export function errorField(message) {
  const m = String(message ?? '');
  if (/^alias\b/i.test(m)) return 'aliases';
  if (/^category\b/i.test(m)) return 'category';
  return 'name';
}

// ── Delete & merge ──────────────────────────────────────────────────────────────────────────

/** Recipes that use the item, by name. */
export function itemRecipes(itemId, state) {
  return state.recipes.filter((r) => r.item_ids.includes(itemId)).sort((a, b) => compareNames(a.name, b.name));
}

/** "Tacos", "Tacos and Stir Fry", "A, B, C and 2 more". */
export function joinNames(names, max = 3) {
  if (names.length <= 1) return names.join('');
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/** The delete confirmation: which recipes lose the item, and whether it leaves the list. */
export function deleteMessage(item, state) {
  const recipes = itemRecipes(item.id, state).map((r) => r.name);
  const onList = state.entriesByItemId.has(item.id);
  let what;
  if (recipes.length && onList) what = `It comes out of ${joinNames(recipes)}, and off the list.`;
  else if (recipes.length) what = `It comes out of ${joinNames(recipes)}.`;
  else if (onList) what = 'It comes off the list too.';
  else what = "It isn't in any recipe or on the list.";
  return `${what} This can't be undone.`;
}

/**
 * The merge confirmation (SPEC §3.8): "Parmesan will become an alias of Parmigiano Reggiano;
 * 2 recipes updated." plus what happens on the list and to the category.
 */
export function mergeMessage(from, into, state) {
  const recipes = itemRecipes(from.id, state).length;
  const parts = [
    `${from.name} will become an alias of ${into.name}${recipes ? `; ${plural(recipes, 'recipe')} updated` : ''}.`,
  ];
  const fromOnList = state.entriesByItemId.has(from.id);
  if (fromOnList && state.entriesByItemId.has(into.id)) parts.push('Their list entries are combined.');
  else if (fromOnList) parts.push(`Its list entry becomes ${into.name}.`);
  const category = state.categoriesById.get(from.category_id);
  if (category && isUncategorized(into, state)) parts.push(`${into.name} moves to ${category.name}.`);
  parts.push("This can't be undone.");
  return parts.join(' ');
}

/**
 * The merge picker's choices: every other item by name when the filter is blank, else the best
 * fuzzy matches.
 * @returns {ItemResult[]}
 */
export function mergeOptions(query, from, state) {
  const others = state.items.filter((i) => i.id !== from.id);
  if (!normalize(collapse(query))) {
    return others
      .sort((a, b) => compareNames(a.name, b.name))
      .map((item) => ({ item, text: item.name, ranges: [], alias: null }));
  }
  return search(query, others, { limit: MERGE_LIMIT }).map((r) => ({
    item: r.item,
    text: r.text,
    ranges: r.ranges,
    alias: r.alias,
  }));
}

// ── Keys ────────────────────────────────────────────────────────────────────────────────────

/**
 * What a keydown on a focused item row does: 'down', 'up', 'first', 'last', 'edit', 'staple',
 * 'category', 'merge', 'delete', 'search', or null. Keys with Ctrl/Cmd/Alt/Shift are ignored.
 * @param {{key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean}} e
 */
export function itemKeyAction(e) {
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
    case 'Enter':
    case 'F2':
      return 'edit';
    case 's':
      return 'staple';
    case 'c':
      return 'category';
    case 'm':
      return 'merge';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case 'Escape':
    case '/':
      return 'search';
    default:
      return null;
  }
}
