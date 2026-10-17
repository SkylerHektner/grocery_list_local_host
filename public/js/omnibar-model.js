// What the omnibar shows for a given input (SPEC §3.1, §3.2). Pure; no DOM. The component is
// components/omnibar.js; this module decides the options, the parsed note and the category
// picker contents so the logic is unit-tested.
//
//   const model = searchModel('eggs, 2 dozen', state, { recipes: true, createRecipe: true });
//   // -> { raw, query: 'eggs', note: '2 dozen', exactItem: <Eggs>, options: [
//   //      { key: 'item-31', kind: 'item', value: <Eggs>, match: <fuzzy SearchResult> }, ... ] }

import { normalize, search } from './fuzzy.js';

/** Max fuzzy results in the dropdown (the create rows come on top of these). */
export const RESULT_LIMIT = 8;

/** Key of the "Uncategorized" choice in the category picker. */
export const UNCATEGORIZED = 'cat-none';

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Inline note syntax: only the text before the first comma is searched; the rest is the note.
 * `"eggs, 2 dozen"` -> `{query: 'eggs', note: '2 dozen'}`; `"eggs,"` -> note `null`.
 * @param {string} raw
 * @returns {{query: string, note: string|null}}
 */
export function parseEntry(raw) {
  const text = String(raw ?? '');
  const comma = text.indexOf(',');
  if (comma < 0) return { query: collapse(text), note: null };
  return { query: collapse(text.slice(0, comma)), note: collapse(text.slice(comma + 1)) || null };
}

const isRecipe = (c) => Array.isArray(c.ingredients);

/** True when `query` equals (normalized) the item's name or one of its aliases. */
function exactlyNames(item, norm) {
  if (normalize(item.name) === norm) return true;
  return (item.aliases ?? []).some((a) => normalize(a) === norm);
}

/**
 * @typedef {object} SearchOption
 * @property {string} key       stable id: `item-<id>`, `recipe-<id>`, `create-item`, `create-recipe`
 * @property {'item'|'recipe'|'create-item'|'create-recipe'} kind
 * @property {object} [value]   the item or recipe (results only)
 * @property {object} [match]   the fuzzy SearchResult (results only): text, ranges, alias
 * @property {string} [name]    the name to create (create rows only)
 */

/**
 * The search-mode dropdown for an input value.
 * @param {string} raw  the input's value
 * @param {{items: object[], recipes: object[]}} state
 * @param {object} [options]
 * @param {boolean} [options.recipes]       include recipes as results (List view)
 * @param {boolean} [options.createItem]    offer `+ Create item "…"` (default true)
 * @param {boolean} [options.createRecipe]  offer `+ Create recipe "…"`
 * @param {number} [options.limit]          max fuzzy results (default RESULT_LIMIT)
 * @returns {{raw: string, query: string, note: string|null, exactItem: object|null,
 *   options: SearchOption[]}}
 */
export function searchModel(raw, state, options = {}) {
  const { recipes = false, createItem = true, createRecipe = false, limit = RESULT_LIMIT } = options;
  const { query, note } = parseEntry(raw);
  const model = { raw: String(raw ?? ''), query, note, exactItem: null, options: [] };
  const norm = normalize(query);
  if (!norm) return model;

  const candidates = recipes ? [...state.items, ...state.recipes] : state.items;
  for (const match of search(query, candidates, { limit })) {
    const kind = isRecipe(match.item) ? 'recipe' : 'item';
    model.options.push({ key: `${kind}-${match.item.id}`, kind, value: match.item, match });
  }
  model.exactItem = state.items.find((item) => exactlyNames(item, norm)) ?? null;
  // An exact item match means the user is after that item: no create rows at all.
  if (model.exactItem) return model;
  if (createItem) model.options.push({ key: 'create-item', kind: 'create-item', name: query });
  if (createRecipe && !state.recipes.some((r) => normalize(r.name) === norm)) {
    model.options.push({ key: 'create-recipe', kind: 'create-recipe', name: query });
  }
  return model;
}

/**
 * @typedef {object} CategoryOption
 * @property {string} key            `cat-<id>`, or UNCATEGORIZED
 * @property {'category'|'uncategorized'} kind
 * @property {object|null} category  null for Uncategorized
 * @property {number|null} number    the one-key shortcut: 1-9 by walk position, 0 for
 *                                   Uncategorized, null past the ninth category
 * @property {Array<[number, number]>} ranges  fuzzy match ranges in the name (filtering)
 */

/**
 * The new-item category picker: categories in walk order (fuzzy-ranked while `filter` is not
 * blank), then Uncategorized, which is always offered.
 * @param {string} filter
 * @param {object[]} categories  in walk order
 * @returns {CategoryOption[]}
 */
export function categoryOptions(filter, categories) {
  const numberOf = new Map(categories.map((c, i) => [c.id, i < 9 ? i + 1 : null]));
  const option = (category, ranges = []) => ({
    key: `cat-${category.id}`,
    kind: 'category',
    category,
    number: numberOf.get(category.id),
    ranges,
  });
  const list = String(filter ?? '').trim()
    ? search(filter, categories).map((r) => option(r.item, r.ranges))
    : categories.map((c) => option(c));
  list.push({ key: UNCATEGORIZED, kind: 'uncategorized', category: null, number: 0, ranges: [] });
  return list;
}

/**
 * The category a digit key picks in the picker: `'0'` = Uncategorized (`{category: null}`),
 * `'1'`-`'9'` = that walk position; `undefined` when there is no such category or the key is
 * not a digit.
 * @param {string} key
 * @param {object[]} categories  in walk order
 * @returns {{category: object|null} | undefined}
 */
export function categoryForDigit(key, categories) {
  if (!/^[0-9]$/.test(key)) return undefined;
  if (key === '0') return { category: null };
  const category = categories[Number(key) - 1];
  return category ? { category } : undefined;
}

/**
 * What a keydown in the omnibar does (the component maps these to its actions):
 *
 *   search mode   ↓ 'down' (dropdown open) or 'exit-down' (closed: hand focus to the host),
 *                 ↑ 'up', Enter 'pick', Shift+Enter 'create', Esc 'clear' or, on an empty
 *                 input, 'leave'
 *   picker mode   ↑/↓ 'up'/'down', Enter 'pick', Esc 'back', Backspace on an empty filter
 *                 'back', Tab 'uncategorized', a digit on an empty filter 'digit'
 *
 * Keys with Ctrl/Cmd/Alt, and Shift+arrows (text selection), are never handled.
 * @param {{key: string, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean}} e
 * @param {{mode: 'search'|'picker', open: boolean, empty: boolean}} ctx  `open`: the dropdown
 *   shows options; `empty`: the input value is ''
 * @returns {null|'down'|'up'|'exit-down'|'pick'|'create'|'clear'|'leave'|'back'|'uncategorized'|'digit'}
 */
export function keyAction(e, { mode, open, empty }) {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.shiftKey && e.key.startsWith('Arrow')) return null;
  if (mode === 'picker') {
    switch (e.key) {
      case 'ArrowDown':
        return 'down';
      case 'ArrowUp':
        return 'up';
      case 'Enter':
        return 'pick';
      case 'Escape':
        return 'back';
      case 'Backspace':
        return empty ? 'back' : null;
      case 'Tab':
        return e.shiftKey ? null : 'uncategorized';
      default:
        // Digits pick only while the filter is empty, so names with digits can be typed.
        return !e.shiftKey && empty && /^[0-9]$/.test(e.key) ? 'digit' : null;
    }
  }
  switch (e.key) {
    case 'ArrowDown':
      return open ? 'down' : 'exit-down';
    case 'ArrowUp':
      return open ? 'up' : null;
    case 'Enter':
      return e.shiftKey ? 'create' : 'pick';
    case 'Escape':
      return empty ? 'leave' : 'clear';
    default:
      return null;
  }
}

/**
 * Moves a highlight by `delta`, clamped to the list (no wrapping): -1 for an empty list.
 * @param {number} index
 * @param {number} delta
 * @param {number} length
 */
export function moveIndex(index, delta, length) {
  if (length <= 0) return -1;
  if (index < 0) return 0;
  return Math.min(Math.max(index + delta, 0), length - 1);
}
