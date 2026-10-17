// The Items view's rows (SPEC §3.8): rendering, roving focus and the row keys (DOM builders in
// items-row-view.js). Rows are keyed `item-<id>` (the create row `create`), so focus survives
// live-sync re-renders (rerender() in dom.js) and the open editor is moved, never rebuilt. When
// the focused row goes away (deleted, merged, filtered out by a chip after `c`/`s`), its
// neighbour takes focus.
//
// Keys on a focused row (itemKeyAction() in items-model.js): ↑/↓/j/k move (↑ on the first: back
// to the filter), Home/End, Enter/F2 edit, s staple, c category, m merge, Delete/Backspace
// delete, / or Esc back to the filter. Keys inside the open editor are the editor's.

import { h, isTypingTarget, rerender } from '../dom.js';
import { fallbackFocus } from '../list-model.js';
import { itemKeyAction } from '../items-model.js';
import { createRow, emptyState, itemRow, moreRow, noneRow } from './items-row-view.js';

const FLASH_MS = 1600;

/**
 * @param {object} deps
 * @param {{edit: (id: number) => void, create: (name: string) => void, staple: (id: number) => void,
 *   category: (id: number) => void, merge: (id: number) => void, delete: (id: number) => void,
 *   more: () => void}} deps.on
 * @param {(select?: boolean) => void} deps.focusSearch
 */
export function createItemRows({ on, focusSearch }) {
  const flashes = new Map(); // row key -> time its highlight started
  let cursorKey = null; // the row with tabindex=0
  let keys = []; // row keys in display order, as rendered
  let options = [];

  const el = h('ul', {
    class: 'rows item-rows',
    id: 'item-list',
    role: 'list', // list-style: none drops the list role in Safari
    'aria-label': 'Items',
    testid: 'item-list',
    onKeydown,
    onFocusin: (e) => {
      const key = keyOf(e.target);
      if (key) setCursor(key);
    },
  });

  /**
   * @param {object} view
   * @param {object[]} view.options   rows: `{key, item, text, ranges, alias}`, `{key: 'more', more}`
   *   ("Show more": `more` results not rendered) or `{key: 'create', name}`
   * @param {object} view.state
   * @param {object|null} view.editor the open editor (createItemEditor)
   * @param {string|null} view.activeKey  the highlighted row (Enter in the filter acts on it)
   * @param {string} view.query
   * @param {object} view.filters
   */
  function render({ options: next, state, editor, activeKey, query, filters }) {
    const before = keys;
    const nextKeys = next.map((o) => o.key);
    const hadFocus = el.contains(document.activeElement);
    const focusedKey = hadFocus ? keyOf(document.activeElement) : null;
    if (cursorKey === null || !nextKeys.includes(cursorKey)) {
      cursorKey = cursorKey === null ? (nextKeys[0] ?? null) : fallbackFocus(before, nextKeys, cursorKey);
    }
    keys = nextKeys;
    options = next;
    const now = Date.now();
    for (const [key, start] of flashes) if (now - start > FLASH_MS) flashes.delete(key);

    rerender(el, () => {
      if (!next.length) return emptyState({ total: state.items.length, query, filters });
      const rows = next.map((o) => {
        const view = { active: o.key === activeKey, tabbable: o.key === cursorKey, flash: flashes.get(o.key), now, on, editor: null };
        if (o.more) return moreRow(o, view);
        if (!o.item) return createRow(o, view);
        view.editor = editor?.id === o.item.id ? editor : null;
        return itemRow(o, state, view);
      });
      if (query && !next.some((o) => o.item)) rows.unshift(noneRow(query));
      return rows;
    });
    // The focused row went away: focus its neighbour (or the filter).
    if (hadFocus && !el.contains(document.activeElement)) {
      const key = focusedKey === null ? null : fallbackFocus(before, nextKeys, focusedKey);
      if (!(key !== null && focusRow(key, { scroll: false }))) focusSearch();
    }
  }

  // ── Focus ──────────────────────────────────────────────────────────────────────────────

  function keyOf(node) {
    return node?.closest?.('.item-row')?.dataset.key ?? null;
  }

  function rowEl(key) {
    return el.querySelector(`.item-row[data-key="${CSS.escape(key)}"]`);
  }

  function setCursor(key) {
    cursorKey = key;
    for (const li of el.querySelectorAll('.item-row')) li.tabIndex = li.dataset.key === key ? 0 : -1;
  }

  function focusRow(key, { scroll = true } = {}) {
    const li = key && rowEl(key);
    if (!li) return false;
    setCursor(key);
    li.focus({ preventScroll: true });
    if (scroll) li.scrollIntoView({ block: 'nearest' });
    return true;
  }

  // ── Keys ───────────────────────────────────────────────────────────────────────────────

  function onKeydown(e) {
    if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return;
    if (e.target.closest?.('.item-editor')) return; // the editor's own keys
    const key = keyOf(e.target);
    if (!key) return;
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    const action = itemKeyAction(e);
    if (!action) return;
    const index = keys.indexOf(key);
    const option = options[index];
    switch (action) {
      case 'down':
        if (index < keys.length - 1) focusRow(keys[index + 1]);
        break;
      case 'up':
        if (index > 0) focusRow(keys[index - 1]);
        else focusSearch();
        break;
      case 'first':
        focusRow(keys[0]);
        break;
      case 'last':
        focusRow(keys[keys.length - 1]);
        break;
      case 'search':
        focusSearch(e.key === '/');
        break;
      case 'edit':
        if (option?.item) on.edit(option.item.id);
        else if (option?.more) on.more();
        else if (option) on.create(option.name);
        break;
      default:
        if (!option?.item) return;
        on[action](option.item.id);
    }
    e.preventDefault();
  }

  return {
    el,
    render,
    focusRow,
    /** Focuses the first row; false when there is none. */
    focusFirst() {
      return keys.length > 0 && focusRow(keys[0]);
    },
    /** Highlights the row the filter's Enter acts on, without rebuilding. */
    paintActive(activeKey) {
      for (const li of el.querySelectorAll('.item-row')) li.classList.toggle('is-active', li.dataset.key === activeKey);
    },
    /** Marks an item's row for a brief highlight on the next render. */
    flash(id) {
      flashes.set(`item-${id}`, Date.now());
    },
    /** True when focus is on a row or inside it. */
    hasFocus() {
      return el.contains(document.activeElement);
    },
  };
}
