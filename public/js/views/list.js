// List view (SPEC §3.1, §3.2, §3.5, §3.6): the omnibar, recipe chips, the grouped list and the
// export preview with copy. Pieces: components/omnibar.js, views/list-chips.js,
// views/list-rows.js (rows, keyboard navigation, notes, removal; DOM in list-row-view.js),
// views/list-export.js (preview), clipboard.js (copy fallbacks).
//
// Every mutation goes through one queue (queue.js), so rapid adds, removals and undos land in
// order. Feedback is quiet: an added row is highlighted and scrolled into view (and announced to
// screen readers); toasts are only for "already on the list", errors, and removals with Undo.
// Ctrl+Shift+C copies from anywhere in the view; Ctrl+Z undoes when not typing in a field.

import { h, isTypingTarget } from '../dom.js';
import { icon } from '../icons.js';
import { createQueue } from '../queue.js';
import { copyText } from '../clipboard.js';
import { addedEntries, plural, summary } from '../list-model.js';
import { isModalOpen } from '../components/dialog.js';
import { openCopyDialog } from '../components/copy-dialog.js';
import { createOmnibar } from '../components/omnibar.js';
import { createRecipeChips } from './list-chips.js';
import { createListRows } from './list-rows.js';
import { createExportPanel } from './list-export.js';

/** @type {{omnibar: ReturnType<typeof createOmnibar>} | null} */
let current = null;

function mount(container, ctx) {
  const { store, api, toast, confirm } = ctx;
  const queue = createQueue();

  const announcer = h('div', { class: 'visually-hidden', role: 'status', testid: 'list-announcer' });
  const announce = (message) => {
    announcer.textContent = message;
  };

  // ── Actions ──────────────────────────────────────────────────────────────────────────────

  function undo() {
    queue
      .run(async () => {
        const before = store.state;
        await api.quiet.undo();
        return addedEntries(before, store.state);
      })
      .then(
        (restored) => {
          announce('Undone');
          if (restored.length) rows.reveal(restored[0]);
        },
        (err) => {
          if (err?.status === 409) toast('Nothing to undo');
          else toast(err?.message ?? 'Undo failed', { variant: 'error' });
        },
      );
  }

  const undoAction = { label: 'Undo', onClick: undo };

  async function addItem(item, { note }) {
    const wasOn = store.state.entriesByItemId.has(item.id);
    await api.addToList(item.id, note);
    if (wasOn) {
      toast(note ? `${item.name} is already on the list. Note updated.` : `${item.name} is already on the list`);
      rows.highlight([item.id]);
      rows.render();
    } else {
      announce(`Added ${item.name}`);
    }
    rows.reveal(item.id);
  }

  // T6 seam: picking a recipe should open the cull dialog (SPEC §3.4). Until then it adds the
  // recipe with the dialog's defaults (every ingredient except staples), with Undo.
  async function addRecipe(recipe) {
    const state = store.state;
    const keep = recipe.item_ids.filter((id) => state.itemsById.has(id) && !state.itemsById.get(id).staple);
    await api.addRecipeToList(recipe.id, keep);
    const skipped = recipe.item_ids.length - keep.length;
    toast(`Added ${recipe.name}${skipped ? ` (skipped ${plural(skipped, 'staple')})` : ''}`, { action: undoAction });
  }

  /** "+ Create recipe": create it, then open its editor (#/recipes/<id>, built in T6). */
  async function createRecipe(name) {
    const { id } = await api.createRecipe({ name });
    ctx.navigate('recipes', id);
  }

  function removeRecipe(recipe) {
    queue
      .run(async () => {
        const before = store.state.list.entries.length;
        await api.removeRecipeFromList(recipe.id);
        return before - store.state.list.entries.length;
      })
      .then(
        (n) => toast(`Removed ${recipe.name}${n ? ` and ${plural(n, 'item')}` : ''}`, { action: undoAction }),
        () => {},
      );
  }

  async function clearList() {
    const { entries, recipe_ids: recipeIds } = store.state.list;
    if (!entries.length && !recipeIds.length) return;
    const what = [entries.length && plural(entries.length, 'item'), recipeIds.length && plural(recipeIds.length, 'recipe')]
      .filter(Boolean)
      .join(' and ');
    const ok = await confirm({
      title: 'Clear the list?',
      message: `${what} will come off the list. You can undo this.`,
      confirmLabel: 'Clear list',
      danger: true,
    });
    if (!ok) return;
    queue.run(() => api.clearList()).then(
      () => {
        toast('Cleared the list', { action: undoAction });
        omnibar.focus();
      },
      () => {},
    );
  }

  async function copyList() {
    const count = store.state.list.entries.length;
    if (!count) {
      toast('The list is empty: nothing to copy');
      return;
    }
    let text = exportPanel.current();
    if (text === null) {
      try {
        text = await api.exportText();
      } catch (err) {
        toast(err.message, { variant: 'error' });
        return;
      }
    }
    const how = await copyText(text, { manual: openCopyDialog });
    if (how !== 'manual') toast(`Copied ${plural(count, 'item')}`, { variant: 'success' });
  }

  // ── Pieces ───────────────────────────────────────────────────────────────────────────────

  const omnibar = createOmnibar({
    store,
    api,
    toast,
    queue,
    idPrefix: 'list',
    placeholder: 'Add an item or recipe…',
    label: 'Add an item or recipe',
    recipes: true,
    createRecipe: true,
    itemBadge: (item, state) => (state.entriesByItemId.has(item.id) ? 'on list' : null),
    recipeBadge: (recipe, state) => (state.listRecipeIds.has(recipe.id) ? 'on list' : null),
    onPickItem: addItem,
    onPickRecipe: addRecipe,
    onCreateRecipe: createRecipe,
    onExitDown: () => rows.focusFirst(),
  });

  const rows = createListRows({
    store,
    api,
    queue,
    toast,
    undo,
    focusSearch: () => omnibar.focus(),
  });

  const exportPanel = createExportPanel({ store, api });

  const summaryEl = h('p', { class: 'view-lead', testid: 'list-summary', 'aria-live': 'off' });
  const clearButton = h(
    'button',
    { type: 'button', class: 'btn btn-ghost btn-sm', testid: 'clear-list', onClick: clearList },
    icon('trash', { size: 16 }),
    'Clear',
  );
  const copyButton = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-primary btn-sm',
      testid: 'copy-list',
      title: 'Copy the list (Ctrl+Shift+C)',
      'aria-keyshortcuts': 'Control+Shift+C',
      onClick: copyList,
    },
    icon('copy', { size: 16 }),
    'Copy',
  );
  const chips = createRecipeChips({ store, onRemove: removeRecipe, focusFallback: () => omnibar.focus() });

  function renderHead() {
    const { list } = store.state;
    summaryEl.textContent = summary(store.state);
    clearButton.disabled = !list.entries.length && !list.recipe_ids.length;
    copyButton.disabled = !list.entries.length;
  }

  // ── Layout ───────────────────────────────────────────────────────────────────────────────

  const bar = h('div', { class: 'sticky-bar list-bar', testid: 'list-bar' }, omnibar.el);
  const sentinel = h('div', { class: 'list-bar-sentinel', 'aria-hidden': 'true' });
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(([entry]) => {
      bar.classList.toggle('is-stuck', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(sentinel);
    ctx.onCleanup(() => observer.disconnect());
  }

  container.classList.add('view-wide', 'list-view');
  container.append(
    h(
      'div',
      { class: 'list-layout' },
      h(
        'div',
        { class: 'list-main' },
        h(
          'header',
          { class: 'view-head list-head' },
          h('div', { class: 'list-head-text' }, h('h1', { class: 'view-title', testid: 'view-title' }, 'List'), summaryEl),
          h('div', { class: 'list-actions' }, clearButton, copyButton),
        ),
        sentinel,
        bar,
        chips.el,
        h('div', { class: 'card list-card' }, rows.el),
      ),
      exportPanel.el,
    ),
    announcer,
  );

  renderHead();
  chips.render();
  rows.render();

  ctx.subscribe((state, prev) => {
    renderHead();
    chips.render();
    rows.highlight(addedEntries(prev, state));
    rows.render();
    exportPanel.update();
  });

  ctx.listen(document, 'keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || isModalOpen()) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (e.shiftKey && (key === 'c' || e.code === 'KeyC')) {
      e.preventDefault();
      copyList();
    } else if (!e.shiftKey && key === 'z' && !isTypingTarget(e.target)) {
      e.preventDefault();
      undo();
    }
  });

  ctx.onCleanup(() => {
    omnibar.destroy();
    exportPanel.destroy();
  });

  current = { omnibar };
  // Keyboard devices start typing right away; phones don't get the keyboard popped up.
  if (!matchMedia('(hover: none)').matches) omnibar.focus();
}

export default {
  id: 'list',
  title: 'List',
  mount,
  unmount() {
    current = null;
  },
  focusSearch() {
    current?.omnibar.focus({ select: true });
  },
};
