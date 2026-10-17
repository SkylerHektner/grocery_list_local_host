// Items catalog view (#/items, SPEC §3.8): a fuzzy filter over names and aliases, quick-filter
// chips (Uncategorized, Staples), an inline editor per row (items-editor.js), and the row
// actions in items-actions.js (staple, category picker, delete, merge, `+ New item "…"`). Rows,
// focus and row keys: items-rows.js. `#/items/uncategorized` opens with that chip on.
//
// Keys in the filter: typing filters, Enter edits the top match (or creates the typed name when
// the `+ New item` row is on top), ↓ moves into the rows, Esc clears. Live sync re-renders the
// rows but never touches the filter box or the open editor's fields.

import { h, isKeyboardDevice, parkFocus } from '../dom.js';
import { icon } from '../icons.js';
import { createQueue } from '../queue.js';
import { draftChanged, errorField, filterCounts, filterItems, itemsSummary } from '../items-model.js';
import { ROW_PAGE, visibleResults } from '../paging.js';
import { stickyBar } from '../components/sticky-bar.js';
import { createItemActions } from './items-actions.js';
import { createItemEditor } from './items-editor.js';
import { createItemRows } from './items-rows.js';

let current = null;

function mountItems(container, ctx) {
  const { store, api, toast } = ctx;
  const queue = createQueue();
  const filters = { uncategorized: ctx.params[0] === 'uncategorized', staples: false };
  let model = filterItems('', store.state, filters);
  let editor = null; // the open inline editor (one at a time)
  let inputFocused = false;
  let limit = ROW_PAGE; // results rendered; "Show more" adds ROW_PAGE (reset by a new filter)
  let keepId = null; // an item row that must stay rendered (just saved, created, merged into)

  const latest = (id) => store.state.itemsById.get(id);
  const keyOf = (id) => `item-${id}`;

  const input = h('input', {
    class: 'search-input',
    type: 'search',
    placeholder: 'Find an item, or name a new one',
    'aria-label': 'Find an item, or name a new one',
    'aria-controls': 'item-list',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    enterkeyhint: 'go',
    testid: 'items-search',
    onInput: () => refilter(),
    onKeydown: onInputKeydown,
    onFocus: () => {
      inputFocused = true;
      rows.paintActive(activeKey());
    },
    onBlur: () => {
      inputFocused = false;
      rows.paintActive(null);
    },
  });
  const rows = createItemRows({
    on: {
      edit: (id) => edit(id),
      create: (name) => actions.create(name),
      staple: (id) => actions.staple(id),
      category: (id) => actions.category(id),
      merge: (id) => actions.merge(id),
      delete: (id) => actions.delete(id),
      more: () => showMore(),
    },
    focusSearch: (select) => focusInput(select),
  });
  const actions = createItemActions({
    store,
    api,
    toast,
    confirm: ctx.confirm,
    queue,
    rows,
    render: (keep) => render(keep),
    refresh: (keep) => refresh(keep),
    focusInput: () => focusInput(),
    editingId: () => editor?.id ?? null,
    closeEditor: () => closeEditor(),
  });
  const summaryEl = h('p', { class: 'view-lead', testid: 'items-summary' });
  const chip = (key, label) =>
    h(
      'button',
      {
        type: 'button',
        class: 'filter-chip',
        'aria-pressed': String(filters[key]),
        testid: `filter-${key}`,
        onClick: () => {
          filters[key] = !filters[key];
          refilter();
        },
      },
      h('span', { class: 'filter-chip-label' }, label),
      h('span', { class: 'filter-chip-count', testid: `filter-${key}-count` }),
    );
  const chips = { uncategorized: chip('uncategorized', 'Uncategorized'), staples: chip('staples', 'Staples') };

  // ── Model & rendering ──────────────────────────────────────────────────────────────────

  /** The rows: the first `limit` results, then "Show more" and `+ New item "…"` when due. */
  function options() {
    const editing = editor ? latest(editor.id) : null;
    const { shown, hidden } = visibleResults(model.results, limit, [editing?.id, keepId]);
    const opts = shown.map((r) => ({ key: keyOf(r.item.id), ...r }));
    // The row being edited stays put even if the filter no longer matches it.
    if (editing && !opts.some((o) => o.item.id === editing.id)) {
      opts.unshift({ key: keyOf(editing.id), item: editing, text: editing.name, ranges: [], alias: null });
    }
    if (hidden) opts.push({ key: 'more', more: hidden });
    if (model.createName) opts.push({ key: 'create', name: model.createName });
    return opts;
  }

  /** While typing in the filter, the top row is what Enter acts on: it is highlighted. */
  function activeKey(opts = options()) {
    return inputFocused && model.query ? (opts[0]?.key ?? null) : null;
  }

  /** The filter text or a chip changed: start again from the first page of results. */
  function refilter() {
    limit = ROW_PAGE;
    keepId = null;
    refresh();
  }

  /** Recomputes the results (same filter); `keep`: an item id whose row must be rendered. */
  function refresh(keep) {
    model = filterItems(input.value, store.state, filters);
    render(keep);
  }

  /** "Show more": the next page of rows; focus moves to the first new one if it was on the button. */
  function showMore() {
    const before = options();
    const at = before.findIndex((o) => o.key === 'more');
    const hadFocus = rows.hasFocus();
    limit = Math.max(limit, at) + ROW_PAGE;
    render();
    if (hadFocus && at >= 0) rows.focusRow(options()[at]?.key);
  }

  function render(keep) {
    if (keep !== undefined) keepId = keep;
    const opts = options();
    rows.render({ options: opts, state: store.state, editor, activeKey: activeKey(opts), query: model.query, filters });
    summaryEl.textContent = itemsSummary(store.state);
    const counts = filterCounts(store.state);
    for (const [key, el] of Object.entries(chips)) {
      el.setAttribute('aria-pressed', String(filters[key]));
      el.querySelector('.filter-chip-count').textContent = String(counts[key]);
    }
    chips.uncategorized.classList.toggle('needs-attention', counts.uncategorized > 0);
  }

  function focusInput(select = false) {
    input.focus();
    if (select) input.select();
  }

  // ── Editing ────────────────────────────────────────────────────────────────────────────

  function edit(id, field = 'name') {
    const item = latest(id);
    if (!item) return;
    if (editor?.id === id) {
      editor.focus(field);
      return;
    }
    if (editor?.dirty()) {
      editor.showError('Save or cancel this edit first');
      editor.focus();
      return;
    }
    editor = createItemEditor({
      item,
      state: store.state,
      onSave: save,
      onCancel: () => closeEditor(),
      onMerge: () => actions.merge(id),
      onDelete: () => actions.delete(id),
    });
    render();
    editor.el.scrollIntoView({ block: 'nearest' });
    // Phones: no on-screen keyboard until a field is tapped (it would cover the editor).
    if (isKeyboardDevice()) editor.focus(field);
    else editor.el.focus({ preventScroll: true });
  }

  /** Closes the editor; its row gets focus back (if focus was in the editor). */
  function closeEditor() {
    const id = editor?.id;
    editor = null;
    render(id); // its row stays rendered, even if a rename sorted it past "Show more"
    if (id !== undefined && !rows.hasFocus()) rows.focusRow(keyOf(id));
  }

  async function save() {
    const ed = editor;
    if (!ed || ed.busy) return;
    const draft = ed.read();
    const item = latest(ed.id);
    if (!item) return closeEditor();
    if (!draftChanged(item, draft)) return closeEditor();
    ed.setBusy(true);
    try {
      await queue.run(() => api.quiet.updateItem(ed.id, draft));
      if (editor !== ed) return;
      rows.flash(ed.id);
      closeEditor();
    } catch (err) {
      ed.setBusy(false);
      const message = err?.message ?? 'Could not save the item';
      if (editor !== ed) toast(message, { variant: 'error' });
      else if (err?.status === 404) {
        closeEditor();
        toast(`${item.name} was deleted, maybe on another device`);
      } else {
        const at = errorField(message);
        ed.showError(message, at);
        ed.focus(at);
      }
    }
  }

  // ── Keys ───────────────────────────────────────────────────────────────────────────────

  function onInputKeydown(e) {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowDown') {
      if (rows.focusFirst()) e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      refresh(); // act on exactly what is typed
      const top = options()[0];
      if (!model.query || !top) return;
      if (top.item) edit(top.item.id);
      else if (top.name) actions.create(top.name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value) {
        input.value = '';
        refilter();
      } else {
        parkFocus();
      }
    }
  }

  // ── Layout ─────────────────────────────────────────────────────────────────────────────

  const { sentinel, bar } = stickyBar(
    ctx,
    { testid: 'items-bar' },
    h('label', { class: 'search' }, icon('search'), input, h('kbd', { class: 'kbd search-hint', 'aria-hidden': 'true' }, '/')),
  );
  container.classList.add('items-view');
  container.append(
    h('header', { class: 'view-head' }, h('h1', { class: 'view-title', testid: 'view-title' }, 'Items'), summaryEl),
    sentinel,
    bar,
    h(
      'div',
      { class: 'filter-chips', role: 'group', 'aria-label': 'Show only' },
      h('span', { class: 'filter-chips-label' }, 'Show only'),
      chips.uncategorized,
      chips.staples,
    ),
    h('div', { class: 'card items-card' }, rows.el),
  );

  ctx.subscribe(() => {
    if (editor && !latest(editor.id)) {
      const gone = editor;
      editor = null;
      if (gone.el.contains(document.activeElement)) toast('That item was deleted, maybe on another device');
    }
    editor?.sync(store.state);
    refresh();
  });
  render();
  if (isKeyboardDevice()) focusInput();

  return { focusSearch: () => focusInput(true) };
}

export default {
  id: 'items',
  title: 'Items',
  mount(container, ctx) {
    current = mountItems(container, ctx);
  },
  unmount() {
    current = null;
  },
  focusSearch() {
    current?.focusSearch();
  },
};
