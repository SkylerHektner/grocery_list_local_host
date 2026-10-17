// A recipe's ingredient rows in the editor (SPEC §3.7): grouped by category in walk order like
// the list, each with the note the recipe gives the item's list entry. Rows are keyed by item
// id, so focus and an open note editor survive live-sync re-renders. Keys on a focused row:
// ↑/↓ (j/k) move (↑ on the first: back to the search), Home/End, Enter/n edit the note (Enter
// saves, Esc cancels, empty clears), Delete/Backspace/x remove (focus moves to the next row,
// else the previous, else the search), / or Esc back to the search. DOM: recipe-ingredient-view.js.
//
// Removals and note edits show at once (optimistically) and run through the editor's queue, each
// reading the latest recipe; the toast's Undo puts a removed ingredient (and its note) back
// where it was.

import { h, isTypingTarget, rerender } from '../dom.js';
import { fallbackFocus, neighborAfterRemoval } from '../list-model.js';
import {
  ingredientGroups,
  ingredientOrder,
  normalizeNote,
  restoreIngredient,
  withIngredientNote,
  withoutIngredient,
} from '../recipes-model.js';
import { ingredientGroupView, ingredientsEmptyView } from './recipe-ingredient-view.js';

const FLASH_MS = 1600;

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
  const pendingNotes = new Map(); // item id -> note saved locally, response not in yet
  const flashes = new Map(); // item id -> time its highlight started
  let editingId = null;
  let cursorId = null;
  let order = [];
  let rendering = false;
  let destroyed = false;

  const el = h('div', { class: 'list-body ingredients', testid: 'ingredients', onKeydown, onFocusin });
  const latest = () => store.state.recipesById.get(recipeId);

  const view = {
    editingId,
    cursorId,
    flashes,
    now: 0,
    onEdit: startEdit,
    onRemove: remove,
    onSave: (id, value) => saveNote(id, value, true),
    onCancel: cancelEdit,
    onBlur: (id, input) => {
      // Re-renders replace the input; only a real blur (click/tap elsewhere) saves.
      if (!rendering && input.isConnected && editingId === id) saveNote(id, input.value, false);
    },
  };

  // ── Rendering ──────────────────────────────────────────────────────────────────────────

  function render() {
    const recipe = latest();
    if (destroyed || !recipe) return;
    const groups = ingredientGroups(recipe, store.state, { hidden: pending, notes: pendingNotes });
    const before = order;
    const next = ingredientOrder(groups);
    const hadFocus = el.contains(document.activeElement);
    const focusedId = hadFocus ? rowIdOf(document.activeElement) : null;
    if (editingId !== null && !next.includes(editingId)) editingId = null;
    if (cursorId === null || !next.includes(cursorId)) {
      cursorId = cursorId === null ? (next[0] ?? null) : fallbackFocus(before, next, cursorId);
    }
    order = next;
    const now = Date.now();
    for (const [id, start] of flashes) if (now - start > FLASH_MS) flashes.delete(id);
    Object.assign(view, { editingId, cursorId, now });
    rendering = true;
    try {
      rerender(el, () => (groups.length ? groups.map((g) => ingredientGroupView(g, view)) : ingredientsEmptyView()));
    } finally {
      rendering = false;
    }
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
    view.cursorId = id;
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

  // ── Notes ──────────────────────────────────────────────────────────────────────────────

  function startEdit(id) {
    if (editingId === id) return;
    editingId = id;
    setCursor(id);
    render();
    const input = el.querySelector(`[data-key="ingredient-note-${id}"]`);
    if (input) {
      input.focus();
      input.select();
    }
  }

  function cancelEdit(id) {
    editingId = null;
    render();
    focusRow(id);
  }

  function saveNote(id, value, refocus) {
    if (editingId !== id) return;
    editingId = null;
    const recipe = latest();
    const next = normalizeNote(value);
    const changed = !!recipe && withIngredientNote(recipe, id, next) !== null;
    if (changed) pendingNotes.set(id, next);
    render();
    if (refocus) focusRow(id);
    if (!changed) return;
    queue
      .run(async () => {
        const current = latest();
        const ingredients = current ? withIngredientNote(current, id, next) : null;
        if (ingredients) await api.updateRecipe(recipeId, { name: current.name, ingredients });
      })
      .catch(() => {})
      .finally(() => {
        pendingNotes.delete(id);
        render();
      });
  }

  // ── Removing ───────────────────────────────────────────────────────────────────────────

  function remove(id) {
    const item = store.state.itemsById.get(id);
    if (!item || pending.has(id)) return;
    const neighbour = neighborAfterRemoval(order, id);
    const hadFocus = el.contains(document.activeElement);
    if (editingId === id) editingId = null;
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
        const index = recipe ? recipe.ingredients.findIndex((i) => i.item_id === id) : -1;
        if (index < 0) return null;
        const ingredient = recipe.ingredients[index];
        await api.updateRecipe(recipeId, { name: recipe.name, ingredients: withoutIngredient(recipe, id) });
        return { index, ingredient, recipeName: recipe.name };
      })
      .then(
        (done) => {
          if (!done) return;
          toast(`Removed ${item.name} from ${done.recipeName}`, {
            action: { label: 'Undo', onClick: () => restore(done.ingredient, done.index) },
          });
        },
        () => {},
      )
      .finally(() => {
        pending.delete(id);
        render();
      });
  }

  function restore(ingredient, index) {
    queue
      .run(async () => {
        const recipe = latest();
        const known = store.state.itemsById.has(ingredient.item_id);
        const ingredients = recipe && known ? restoreIngredient(recipe, ingredient, index) : null;
        if (ingredients) await api.updateRecipe(recipeId, { name: recipe.name, ingredients });
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
      case 'Enter':
      case 'n':
        startEdit(id);
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
