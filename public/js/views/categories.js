// Store order view (#/categories, SPEC §3.9): the categories in walk order with their item
// counts. Keys on a focused row: ↑/↓/j/k move focus, Home/End, Alt+↑/Alt+↓ move the category
// (focus follows it), Enter/F2 rename, Delete/Backspace delete (confirm says how many items
// become Uncategorized); `n` anywhere in the view adds one. Touch: ↑/↓ buttons on each row, tap
// a row to rename it. DOM builders: categories-view.js.
//
// Moves show at once: a local `desired` order is rendered until every queued move has landed.
// Each queued request sends the latest desired order (reconciled with categories added or
// deleted meanwhile), so holding Alt+↓ never races or sends a stale permutation.

import { h, isKeyboardDevice, isTypingTarget, rerender } from '../dom.js';
import { icon } from '../icons.js';
import { createQueue } from '../queue.js';
import { fallbackFocus, plural } from '../list-model.js';
import {
  categoryCounts,
  categoryKeyAction,
  deleteCategoryMessage,
  moveId,
  reconcileOrder,
  sameOrder,
} from '../categories-model.js';
import { isModalOpen } from '../components/dialog.js';
import { promptName } from '../components/name-dialog.js';
import { categoryRow, emptyState, keyHints, uncategorizedFoot } from './categories-view.js';

const FLASH_MS = 1600;
const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

let current = null;

function mountCategories(container, ctx) {
  const { store, api, toast, confirm } = ctx;
  const queue = createQueue();
  const flashes = new Map(); // category id -> time its highlight started
  let desired = null; // the walk order shown while moves are in flight
  let pending = 0;
  let cursorId = null; // the row with tabindex=0
  let order = []; // ids as rendered

  const list = h('ol', {
    class: 'rows category-rows',
    role: 'list', // list-style: none drops the list role in Safari
    'aria-label': 'Categories in walk order',
    testid: 'category-list',
    onKeydown,
    onFocusin: (e) => {
      const id = idOf(e.target);
      if (id !== null) setCursor(id);
    },
  });
  const foot = h('div', { class: 'category-foot', testid: 'category-foot' });
  const summaryEl = h('p', { class: 'view-lead', testid: 'categories-summary' });
  const announcer = h('div', { class: 'visually-hidden', role: 'status', testid: 'categories-announcer' });

  const serverOrder = () => store.state.categories.map((c) => c.id);
  const shownOrder = () => (desired ? reconcileOrder(desired, serverOrder()) : serverOrder());
  const on = { move, rename, remove };

  // ── Rendering ──────────────────────────────────────────────────────────────────────────

  function render() {
    const state = store.state;
    const before = order;
    const next = shownOrder();
    const hadFocus = list.contains(document.activeElement);
    const focusedId = hadFocus ? idOf(document.activeElement) : null;
    if (cursorId === null || !next.includes(cursorId)) {
      cursorId = cursorId === null ? (next[0] ?? null) : fallbackFocus(before, next, cursorId);
    }
    order = next;
    const { byId, uncategorized } = categoryCounts(state);
    const now = Date.now();
    for (const [id, start] of flashes) if (now - start > FLASH_MS) flashes.delete(id);
    rerender(list, () =>
      next.length
        ? next.map((id, i) =>
            categoryRow(state.categoriesById.get(id), {
              position: i + 1,
              count: byId.get(id) ?? 0,
              first: i === 0,
              last: i === next.length - 1,
              tabbable: id === cursorId,
              flash: flashes.get(id),
              now,
              on,
            }),
          )
        : emptyState(),
    );
    foot.replaceChildren(...uncategorizedFoot(uncategorized).filter(Boolean));
    summaryEl.textContent = next.length
      ? `${plural(next.length, 'category', 'categories')}, in the order you walk through the store. The list and its export follow it.`
      : 'The list and its export follow this order.';
    // The focused row went away (deleted here or on another device): focus its neighbour.
    if (hadFocus && !list.contains(document.activeElement)) {
      const id = focusedId === null ? null : fallbackFocus(before, next, focusedId);
      if (!(id !== null && focusRow(id, { scroll: false }))) newButton.focus(); // the last one went
    }
  }

  // ── Focus ──────────────────────────────────────────────────────────────────────────────

  function idOf(node) {
    const li = node?.closest?.('.category-row');
    return li ? Number(li.dataset.categoryId) : null;
  }

  function rowEl(id) {
    return list.querySelector(`.category-row[data-category-id="${id}"]`);
  }

  function setCursor(id) {
    cursorId = id;
    for (const li of list.querySelectorAll('.category-row')) li.tabIndex = Number(li.dataset.categoryId) === id ? 0 : -1;
  }

  function focusRow(id, { scroll = true } = {}) {
    const li = id !== null && id !== undefined ? rowEl(id) : null;
    if (!li) return false;
    setCursor(id);
    li.focus({ preventScroll: true });
    if (scroll) li.scrollIntoView({ block: 'nearest' });
    return true;
  }

  /** After a dialog: back to the row (the dialog's opener may have been re-rendered away). */
  function refocus(id) {
    if (!list.contains(document.activeElement)) focusRow(id) || focusRow(cursorId);
  }

  // ── Actions ────────────────────────────────────────────────────────────────────────────

  function move(id, delta) {
    const next = moveId(shownOrder(), id, delta);
    if (!next) return;
    desired = next;
    pending += 1;
    flashes.set(id, Date.now());
    render();
    rowEl(id)?.scrollIntoView({ block: 'nearest' });
    const name = store.state.categoriesById.get(id)?.name ?? '';
    announcer.textContent = `${name}: number ${next.indexOf(id) + 1} of ${next.length}`;
    queue
      .run(async () => {
        if (!desired) return; // an earlier move failed: show the server's order
        const ids = reconcileOrder(desired, serverOrder());
        if (!sameOrder(ids, serverOrder())) await api.reorderCategories(ids);
      })
      .catch(() => {
        desired = null; // the api toasted the error
      })
      .finally(() => {
        pending -= 1;
        if (pending === 0) {
          desired = null;
          render();
        }
      });
  }

  async function rename(id) {
    const category = store.state.categoriesById.get(id);
    if (!category) return;
    await promptName({
      title: 'Rename category',
      label: 'Category name',
      value: category.name,
      confirmLabel: 'Rename',
      testid: 'rename-category-dialog',
      submit: async (name) => {
        if (collapse(name) !== store.state.categoriesById.get(id)?.name) {
          await queue.run(() => api.quiet.renameCategory(id, name));
          flashes.set(id, Date.now());
        }
        return id;
      },
    });
    render();
    refocus(id);
  }

  async function remove(id) {
    const category = store.state.categoriesById.get(id);
    if (!category) return;
    const count = categoryCounts(store.state).byId.get(id) ?? 0;
    const ok = await confirm({
      title: `Delete ${category.name}?`,
      message: deleteCategoryMessage(count),
      confirmLabel: 'Delete category',
      danger: true,
    });
    refocus(id);
    if (!ok) return;
    queue.run(() => api.deleteCategory(id)).then(
      () => toast(count ? `Deleted ${category.name}; ${plural(count, 'item')} now uncategorized` : `Deleted ${category.name}`),
      () => {},
    );
  }

  async function add() {
    const id = await promptName({
      title: 'New category',
      label: 'Category name',
      placeholder: 'e.g. Garden center',
      confirmLabel: 'Add category',
      testid: 'new-category-dialog',
      submit: (name) => queue.run(() => api.quiet.createCategory(name)).then((res) => res.id),
    });
    if (id === null || id === undefined) {
      if (!list.contains(document.activeElement) && isKeyboardDevice()) focusRow(cursorId);
      return;
    }
    flashes.set(id, Date.now());
    render();
    focusRow(id);
  }

  // ── Keys ───────────────────────────────────────────────────────────────────────────────

  function onKeydown(e) {
    if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return;
    const id = idOf(e.target);
    if (id === null) return;
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    const action = categoryKeyAction(e);
    if (!action) return;
    e.preventDefault();
    const index = order.indexOf(id);
    switch (action) {
      case 'down':
        focusRow(order[Math.min(index + 1, order.length - 1)]);
        break;
      case 'up':
        focusRow(order[Math.max(index - 1, 0)]);
        break;
      case 'first':
        focusRow(order[0]);
        break;
      case 'last':
        focusRow(order[order.length - 1]);
        break;
      case 'move-up':
      case 'move-down':
        move(id, action === 'move-up' ? -1 : 1);
        break;
      case 'rename':
        rename(id);
        break;
      case 'delete':
        remove(id);
        break;
      default:
    }
  }

  // `n` anywhere in the view (not while typing): new category.
  ctx.listen(document, 'keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || isModalOpen() || isTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.key !== 'n') return;
    e.preventDefault();
    add();
  });

  // ── Layout ─────────────────────────────────────────────────────────────────────────────

  const newButton = h(
    'button',
    { type: 'button', class: 'btn btn-primary btn-sm', testid: 'new-category', title: 'New category (n)', 'aria-keyshortcuts': 'N', onClick: add },
    icon('plus', { size: 16 }),
    'New category',
  );
  container.classList.add('categories-view');
  container.append(
    h(
      'header',
      { class: 'view-head' },
      h(
        'div',
        { class: 'split-head categories-head' },
        h('h1', { class: 'view-title', testid: 'view-title' }, 'Store order'),
        newButton,
      ),
      summaryEl,
    ),
    h('div', { class: 'card categories-card' }, list, foot),
    keyHints(),
    announcer,
  );

  ctx.subscribe(() => render());
  render();
  if (isKeyboardDevice()) focusRow(cursorId, { scroll: false });

  return { focusSearch: () => focusRow(cursorId) || newButton.focus() };
}

export default {
  id: 'categories',
  title: 'Store order',
  mount(container, ctx) {
    current = mountCategories(container, ctx);
  },
  unmount() {
    current = null;
  },
  focusSearch() {
    current?.focusSearch();
  },
};
