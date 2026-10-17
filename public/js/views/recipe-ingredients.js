// A recipe's ingredient rows in the editor (SPEC §3.7): grouped by category in walk order like
// the list, each removable by keyboard and tap. Rows are keyed by item id, so focus survives
// live-sync re-renders. Keys on a focused row: ↑/↓ (j/k) move (↑ on the first: back to the
// search), Home/End, Delete/Backspace/x remove (focus moves to the next row, else the previous,
// else the search), / or Esc back to the search.
//
// Removals show at once (optimistically) and run through the editor's queue, each reading the
// latest recipe; the toast's Undo puts the ingredient back where it was.

import { h, isTypingTarget, rerender } from '../dom.js';
import { icon } from '../icons.js';
import { fallbackFocus, neighborAfterRemoval } from '../list-model.js';
import { ingredientGroups, ingredientOrder, restoreIngredient, withoutIngredient } from '../recipes-model.js';
import { noteArt } from '../components/empty.js';

const FLASH_MS = 1600;
const kbd = (key) => h('kbd', { class: 'kbd' }, key);

/**
 * @param {object} deps
 * @param {number} deps.recipeId
 * @param {object} deps.store
 * @param {object} deps.api
 * @param {ReturnType<import('../queue.js').createQueue>} deps.queue
 * @param {Function} deps.toast
 * @param {() => void} deps.focusSearch
 */
export function createIngredientRows({ recipeId, store, api, queue, toast, focusSearch }) {
  const pending = new Set(); // item ids removed locally, response not in yet
  const flashes = new Map(); // item id -> time its highlight started
  let cursorId = null;
  let order = [];
  let destroyed = false;

  const el = h('div', { class: 'list-body ingredients', testid: 'ingredients', onKeydown, onFocusin });
  const latest = () => store.state.recipesById.get(recipeId);

  // ── Rendering ──────────────────────────────────────────────────────────────────────────

  function row({ item, staple }, now) {
    const id = item.id;
    const flashed = flashes.get(id);
    return h(
      'li',
      {
        class: ['row', 'list-row', 'ingredient-row', flashed && 'is-flash'],
        style: flashed ? { animationDelay: `-${now - flashed}ms` } : null,
        tabindex: id === cursorId ? '0' : '-1',
        testid: 'ingredient-row',
        dataset: { key: `ingredient-${id}`, itemId: String(id) },
      },
      h('span', { class: 'row-main' }, h('span', { class: 'row-name', testid: 'ingredient-name' }, item.name)),
      staple && h('span', { class: 'row-tags' }, h('span', { class: 'tag tag-warm', title: 'Starts unchecked when the recipe goes on the list' }, 'staple')),
      h(
        'span',
        { class: 'row-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost btn-icon btn-sm row-remove',
            tabindex: '-1',
            'aria-label': `Remove ${item.name} from the recipe`,
            title: 'Remove (Delete)',
            testid: 'ingredient-remove',
            onClick: (e) => {
              e.stopPropagation();
              remove(id);
            },
          },
          icon('close', { size: 18 }),
        ),
      ),
    );
  }

  function emptyView() {
    return h(
      'div',
      { class: 'empty list-empty', testid: 'ingredients-empty' },
      noteArt(),
      h('h2', { class: 'empty-title' }, 'No ingredients yet'),
      h(
        'p',
        { class: 'empty-body' },
        h('span', { class: 'only-keys' }, 'Type an item and press ', kbd('Enter'), '. Then the next one.'),
        h('span', { class: 'only-touch' }, 'Type an item above and tap it to add it.'),
      ),
      h(
        'ul',
        { class: 'empty-tips' },
        h(
          'li',
          null,
          h('span', { class: 'only-keys' }, kbd('Shift+Enter'), ' creates a new item'),
          h('span', { class: 'only-touch' }, 'Unknown items can be created on the spot'),
        ),
        h('li', null, 'Staples start unchecked when the recipe goes on the list'),
      ),
    );
  }

  function render() {
    const recipe = latest();
    if (destroyed || !recipe) return;
    const visible = { ...recipe, item_ids: recipe.item_ids.filter((id) => !pending.has(id)) };
    const groups = ingredientGroups(visible, store.state);
    const before = order;
    const next = ingredientOrder(groups);
    const hadFocus = el.contains(document.activeElement);
    const focusedId = hadFocus ? rowIdOf(document.activeElement) : null;
    if (cursorId === null || !next.includes(cursorId)) {
      cursorId = cursorId === null ? (next[0] ?? null) : fallbackFocus(before, next, cursorId);
    }
    order = next;
    const now = Date.now();
    for (const [id, start] of flashes) if (now - start > FLASH_MS) flashes.delete(id);
    rerender(el, () =>
      groups.length
        ? groups.map((g) =>
            h(
              'section',
              { class: 'list-group', testid: 'ingredient-group', 'data-category': g.name, 'aria-label': g.name },
              h(
                'h2',
                { class: 'group-header', 'aria-hidden': 'true' },
                h('span', { class: 'group-name' }, g.name),
                h('span', { class: 'group-count' }, g.rows.length),
              ),
              h('ul', { class: 'rows' }, g.rows.map((r) => row(r, now))),
            ),
          )
        : emptyView(),
    );
    // The focused row went away (removed here or on another device): focus its neighbour.
    if (hadFocus && !el.contains(document.activeElement)) {
      const id = focusedId === null ? null : fallbackFocus(before, next, focusedId);
      if (id !== null) focusRow(id, { scroll: false });
      else focusSearch();
    }
  }

  // ── Focus ──────────────────────────────────────────────────────────────────────────────

  function rowIdOf(node) {
    const li = node?.closest?.('.ingredient-row');
    return li ? Number(li.dataset.itemId) : null;
  }

  function rowEl(id) {
    return el.querySelector(`.ingredient-row[data-item-id="${id}"]`);
  }

  function setCursor(id) {
    cursorId = id;
    for (const li of el.querySelectorAll('.ingredient-row')) li.tabIndex = Number(li.dataset.itemId) === id ? 0 : -1;
  }

  function focusRow(id, { scroll = true } = {}) {
    const li = rowEl(id);
    if (!li) return false;
    setCursor(id);
    li.focus({ preventScroll: true });
    if (scroll) li.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function onFocusin(e) {
    const id = rowIdOf(e.target);
    if (id !== null) setCursor(id);
  }

  // ── Removing ───────────────────────────────────────────────────────────────────────────

  function remove(id) {
    const item = store.state.itemsById.get(id);
    if (!item || pending.has(id)) return;
    const neighbour = neighborAfterRemoval(order, id);
    const hadFocus = el.contains(document.activeElement);
    pending.add(id);
    if (cursorId === id) cursorId = neighbour;
    render();
    if (hadFocus) {
      if (neighbour !== null) focusRow(neighbour);
      else focusSearch();
    }
    queue
      .run(async () => {
        const recipe = latest();
        const index = recipe ? recipe.item_ids.indexOf(id) : -1;
        if (index < 0) return null;
        await api.updateRecipe(recipeId, { name: recipe.name, item_ids: withoutIngredient(recipe, id) });
        return { index, recipeName: recipe.name };
      })
      .then(
        (done) => {
          if (!done) return;
          toast(`Removed ${item.name} from ${done.recipeName}`, {
            action: { label: 'Undo', onClick: () => restore(id, done.index) },
          });
        },
        () => {},
      )
      .finally(() => {
        pending.delete(id);
        render();
      });
  }

  function restore(id, index) {
    queue
      .run(async () => {
        const recipe = latest();
        const ids = recipe && store.state.itemsById.has(id) ? restoreIngredient(recipe, id, index) : null;
        if (ids) await api.updateRecipe(recipeId, { name: recipe.name, item_ids: ids });
      })
      .catch(() => {});
  }

  function onKeydown(e) {
    if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const id = rowIdOf(e.target);
    if (id === null) return;
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    const index = order.indexOf(id);
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        if (index < order.length - 1) focusRow(order[index + 1]);
        break;
      case 'ArrowUp':
      case 'k':
        if (index > 0) focusRow(order[index - 1]);
        else focusSearch();
        break;
      case 'Home':
        focusRow(order[0]);
        break;
      case 'End':
        focusRow(order[order.length - 1]);
        break;
      case 'Delete':
      case 'Backspace':
      case 'x':
        remove(id);
        break;
      case 'Escape':
      case '/':
        focusSearch();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  return {
    el,
    render,
    /** Focuses the first row; false when there are none. */
    focusFirst() {
      return order.length > 0 && focusRow(order[0]);
    },
    /** Marks rows for a brief highlight on the next render(). */
    highlight(ids) {
      const now = Date.now();
      for (const id of ids) flashes.set(id, now);
    },
    /** Scrolls a row into view without moving focus. */
    reveal(id) {
      rowEl(id)?.scrollIntoView({ block: 'nearest' });
    },
    destroy() {
      destroyed = true;
    },
  };
}
