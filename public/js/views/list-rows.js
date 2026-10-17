// The list itself (SPEC §3.5): entries grouped by category, keyboard navigation, inline note
// editing and removal (DOM builders in list-row-view.js). Rows are keyed by item id
// (`data-key="item-<id>"`), so focus and an open note editor survive live-sync re-renders
// (rerender() in dom.js), and the focused row's neighbour takes focus when another device
// removes it.
//
// Each group's rows are a wrapped grid of tiles (CSS). Keys on a focused tile: ↑/↓ move a line
// up/down the grid to the nearest column (↑ on the top line: back to the search), ←/→ and j/k
// the previous/next tile in reading order (k on the first: back to the search), Home/End,
// Delete/Backspace/x remove (focus moves to the next row, else the previous), Enter/n edit the
// note (Enter saves, Esc cancels, empty clears), / or Esc back to the search.
//
// Removals and note edits show at once (optimistically) and run through the shared queue; a
// failure (the API already toasted it) just re-renders the server's state.

import { h, isTypingTarget, rerender } from '../dom.js';
import { displayOrder, fallbackFocus, gridNeighbor, groupEntries, neighborAfterRemoval } from '../list-model.js';
import { emptyView, groupView } from './list-row-view.js';

const FLASH_MS = 1600;

/**
 * @param {object} deps
 * @param {object} deps.store
 * @param {object} deps.api
 * @param {ReturnType<import('../queue.js').createQueue>} deps.queue
 * @param {Function} deps.toast
 * @param {() => void} deps.focusSearch
 * @param {() => void} deps.undo
 */
export function createListRows({ store, api, queue, toast, focusSearch, undo }) {
  const pendingRemovals = new Set(); // item ids removed locally, response not in yet
  const pendingNotes = new Map(); // item id -> note saved locally, response not in yet
  const flashes = new Map(); // item id -> time the highlight started
  let editingId = null;
  let cursorId = null; // the row with tabindex=0 (roving tabindex)
  let order = []; // item ids in display order, as rendered
  let rendering = false;

  const el = h('div', { class: 'list-body', testid: 'list-body', onKeydown, onFocusin });

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
    const groups = groupEntries(store.state, { hidden: pendingRemovals, notes: pendingNotes });
    const before = order;
    const next = displayOrder(groups);
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
      rerender(el, () => (groups.length ? groups.map((g) => groupView(g, view)) : emptyView()));
    } finally {
      rendering = false;
    }
    // The focused row went away (removed here or elsewhere): focus its neighbour.
    if (hadFocus && !el.contains(document.activeElement)) {
      const id = focusedId === null ? null : fallbackFocus(before, next, focusedId);
      if (id !== null) focusRow(id, { scroll: false });
      else focusSearch();
    }
  }

  // ── Focus ──────────────────────────────────────────────────────────────────────────────

  function rowIdOf(node) {
    const li = node?.closest?.('.list-row');
    return li ? Number(li.dataset.itemId) : null;
  }

  function rowEl(id) {
    return el.querySelector(`.list-row[data-item-id="${id}"]`);
  }

  function setCursor(id) {
    if (cursorId === id) return;
    cursorId = id;
    view.cursorId = id;
    for (const li of el.querySelectorAll('.list-row')) {
      li.tabIndex = Number(li.dataset.itemId) === id ? 0 : -1;
    }
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

  // ── Editing & removing ─────────────────────────────────────────────────────────────────

  function startEdit(id) {
    if (editingId === id) return;
    editingId = id;
    setCursor(id);
    render();
    const input = el.querySelector(`[data-key="note-${id}"]`);
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
    const next = value.replace(/\s+/g, ' ').trim();
    const current = store.state.entriesByItemId.get(id);
    const changed = current && (current.note ?? '') !== next;
    if (changed) pendingNotes.set(id, next || null);
    render();
    if (refocus) focusRow(id);
    if (!changed) return;
    queue
      .run(() => api.setNote(id, next || null))
      .catch(() => {})
      .finally(() => {
        pendingNotes.delete(id);
        render();
      });
  }

  function remove(id) {
    const item = store.state.itemsById.get(id);
    if (!item || pendingRemovals.has(id)) return;
    const neighbour = neighborAfterRemoval(order, id);
    const hadFocus = el.contains(document.activeElement);
    if (editingId === id) editingId = null;
    pendingRemovals.add(id);
    if (cursorId === id) cursorId = neighbour;
    render();
    if (hadFocus) {
      if (neighbour !== null) focusRow(neighbour);
      else focusSearch();
    }
    queue
      .run(() => api.removeFromList(id))
      .then(
        () => toast(`Removed ${item.name}`, { action: { label: 'Undo', onClick: undo } }),
        () => {},
      )
      .finally(() => {
        pendingRemovals.delete(id);
        render();
      });
  }

  function onKeydown(e) {
    if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const id = rowIdOf(e.target);
    if (id === null) return;
    // Enter/Space on a focused button inside the row: let the button work.
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    const index = order.indexOf(id);
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const boxes = order.map((rowId) => rowEl(rowId)?.getBoundingClientRect() ?? { top: 0, left: 0, width: 0 });
        const next = gridNeighbor(boxes, index, e.key === 'ArrowDown' ? 1 : -1);
        if (next !== null) focusRow(order[next]);
        else if (e.key === 'ArrowUp') focusSearch();
        break;
      }
      case 'ArrowRight':
      case 'j':
        if (index < order.length - 1) focusRow(order[index + 1]);
        break;
      case 'ArrowLeft':
      case 'k':
        if (index > 0) focusRow(order[index - 1]);
        else if (e.key === 'k') focusSearch();
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
      case 'Enter':
      case 'n':
        startEdit(id);
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
    /** Focuses the first row; false when the list is empty. */
    focusFirst() {
      return order.length > 0 && focusRow(order[0]);
    },
    /** Marks rows for a brief highlight (just added / restored) on the next render(). */
    highlight(ids) {
      const now = Date.now();
      for (const id of ids) flashes.set(id, now);
    },
    /** Scrolls a row into view (after a local add), without moving focus. */
    reveal(id) {
      rowEl(id)?.scrollIntoView({ block: 'nearest' });
    },
  };
}
