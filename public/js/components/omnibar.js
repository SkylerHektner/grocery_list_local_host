// The omnibar (SPEC §3.1, §3.2): a search/add combobox with fuzzy results, inline note syntax,
// create rows and the new-item category picker. Used by the List view and (T6) the recipe
// editor, so everything view-specific comes in through the config.
//
//   const omnibar = createOmnibar({
//     store, api, toast, queue,          // queue: createQueue() shared with the host view
//     idPrefix: 'list',                  // input testid `list-search`, listbox `list-results`
//     placeholder: 'Add an item or recipe',
//     recipes: true, createRecipe: true, // List view only
//     itemBadge: (item, state) => state.entriesByItemId.has(item.id) ? 'on list' : null,
//     onPickItem: (item, { note, created }) => api.addToList(item.id, note),   // queued
//     onPickRecipe: (recipe) => ...,     // queued
//     onCreateRecipe: (name) => ...,     // queued
//     onExitDown: () => list.focusFirst(),   // ↓ with nothing to move through; true = handled
//   });
//   container.append(omnibar.el);  ...  omnibar.destroy() on unmount
//
// Keys (mapped by keyAction() in omnibar-model.js): ↑/↓ move the highlight (clamped, no wrap),
// Enter picks it, Shift+Enter creates an item, Esc clears (then calls onEscape / leaves the box).
// Picker: 1-9 pick (only while the filter is empty), 0 or Tab = Uncategorized, typing filters,
// Enter picks the highlight, Esc or Backspace on an empty filter goes back with the text intact.
//
// Never races fast typing: options are recomputed synchronously on every input event (and again
// on Enter if the value changed since), the input clears and keeps focus right after a pick, and
// the pick callbacks run one at a time through `queue`, so `milk⏎ eggs⏎ bananas⏎` all land, in
// order. A pick that fails puts its text back if the input is still empty. Live-sync updates only
// re-render the dropdown (the input is never replaced) and keep the highlighted option.

import { parkFocus } from '../dom.js';
import { createQueue } from '../queue.js';
import { roomBelow } from '../viewport.js';
import { categoryForDigit, categoryOptions, keyAction, moveIndex, searchModel } from '../omnibar-model.js';
import {
  categoryRow,
  footHints,
  noteBanner,
  omnibarShell,
  pickerTitle,
  scrollIntoPopup,
  searchRow,
} from './omnibar-rows.js';

let instances = 0;

/**
 * @param {object} config
 * @param {object} config.store             store.js store
 * @param {object} config.api               api.js client (createItem)
 * @param {Function} [config.toast]
 * @param {ReturnType<typeof createQueue>} [config.queue]
 * @param {string} [config.idPrefix]        DOM ids and test ids (`<prefix>-search`, ...)
 * @param {string} [config.placeholder]
 * @param {string} [config.label]           accessible name (default: placeholder)
 * @param {boolean} [config.recipes]        offer recipes as results
 * @param {boolean} [config.createRecipe]   offer `+ Create recipe "…"`
 * @param {(item: object, state: object) => string|null} [config.itemBadge]
 * @param {(recipe: object, state: object) => string|null} [config.recipeBadge]
 * @param {(item: object, opts: {note: string|null, created?: boolean}) => unknown} config.onPickItem
 * @param {(recipe: object, opts: {note: string|null}) => unknown} [config.onPickRecipe]
 * @param {(name: string) => unknown} [config.onCreateRecipe]
 * @param {() => boolean} [config.onExitDown]
 * @param {() => void} [config.onEscape]    Esc on an empty input (default: focus goes to the view)
 */
export function createOmnibar(config) {
  const {
    store,
    api,
    toast = () => {},
    queue = createQueue(),
    idPrefix = `omnibar${++instances}`,
    placeholder = 'Add an item',
    label = placeholder,
    recipes = false,
    createRecipe = false,
    itemBadge = () => null,
    recipeBadge = () => null,
    onPickItem,
    onPickRecipe,
    onCreateRecipe,
    onExitDown,
    onEscape,
  } = config;

  let mode = 'search'; // 'search' | 'picker'
  let model = null; // searchModel() of the input value (search mode); null = stale
  let categories = []; // categoryOptions() (picker mode)
  let picker = null; // {raw, name, note} while choosing a category
  let activeKey = null;
  let focused = false;
  let destroyed = false;

  const optionId = (key) => `${idPrefix}-opt-${key}`;
  const { el, input, head, listbox, foot, popup } = omnibarShell({
    idPrefix,
    placeholder,
    label,
    onInput: () => refresh(true),
    onKeydown,
    onFocus,
    onBlur,
  });

  const rowHandlers = { itemBadge, recipeBadge, pick, hover };

  // Phones: keep the dropdown above the on-screen keyboard (it shrinks the visible area).
  const vv = globalThis.visualViewport;
  const refit = () => {
    if (!popup.hidden) fit();
  };
  vv?.addEventListener('resize', refit);

  const unsubscribe = store.subscribe(() => {
    if (focused || mode === 'picker') refresh(false);
    else model = null;
  });

  // ── Model ──────────────────────────────────────────────────────────────────────────────

  function options() {
    return mode === 'picker' ? categories : (model?.options ?? []);
  }

  function activeOption() {
    return options().find((o) => o.key === activeKey) ?? null;
  }

  /** Recomputes the options for the current input. `reset`: highlight the top option. */
  function refresh(reset) {
    if (destroyed || !store.state) return;
    if (mode === 'picker') categories = categoryOptions(input.value, store.state.categories);
    else model = searchModel(input.value, store.state, { recipes, createRecipe });
    const opts = options();
    let index = reset ? -1 : opts.findIndex((o) => o.key === activeKey);
    if (index < 0) index = opts.length ? 0 : -1;
    activeKey = index >= 0 ? opts[index].key : null;
    render(reset);
  }

  /** Makes sure the model matches the input value (Enter right after a keystroke). */
  function sync() {
    if (mode === 'search' && (!model || model.raw !== input.value)) refresh(true);
  }

  function isOpen() {
    return focused && (mode === 'picker' || options().length > 0);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────────────────

  function render(scrollTop = false) {
    const open = isOpen();
    popup.hidden = !open;
    el.classList.toggle('is-open', open);
    el.classList.toggle('is-picking', mode === 'picker');
    input.setAttribute('aria-expanded', String(open));
    if (!open) {
      input.removeAttribute('aria-activedescendant');
      listbox.replaceChildren();
      return;
    }
    const state = store.state;
    if (mode === 'picker') {
      head.replaceChildren(...pickerTitle(picker.name, picker.note, () => exitPicker()));
      listbox.setAttribute('aria-label', 'Categories');
      listbox.replaceChildren(...categories.map((o) => categoryRow(optionId(o.key), o, rowHandlers)));
    } else {
      head.replaceChildren(...(model.note && model.options.length ? [noteBanner(model.note)] : []));
      listbox.setAttribute('aria-label', 'Suggestions');
      listbox.replaceChildren(...model.options.map((o) => searchRow(optionId(o.key), o, state, rowHandlers)));
    }
    head.hidden = !head.childNodes.length;
    foot.replaceChildren(...footHints(mode));
    fit();
    if (scrollTop) popup.scrollTop = 0;
    paintActive(true);
  }

  /** Caps the dropdown's height to the visible space below it (see viewport.js). */
  function fit() {
    popup.style.setProperty('--pop-room', `${roomBelow(popup.getBoundingClientRect().top, window)}px`);
  }

  /** Marks the highlighted option (aria-selected + activedescendant) without rebuilding rows. */
  function paintActive(scroll) {
    let active = null;
    for (const li of listbox.children) {
      const on = li.dataset.option === activeKey;
      li.setAttribute('aria-selected', String(on));
      if (on) active = li;
    }
    if (!active) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    input.setAttribute('aria-activedescendant', active.id);
    if (scroll) scrollIntoPopup(popup, active, head, foot);
  }

  function move(delta) {
    const opts = options();
    const index = moveIndex(opts.findIndex((o) => o.key === activeKey), delta, opts.length);
    activeKey = index >= 0 ? opts[index].key : null;
    paintActive(true);
  }

  function hover(key) {
    if (activeKey === key) return;
    activeKey = key;
    paintActive(false);
  }

  // ── Actions ────────────────────────────────────────────────────────────────────────────

  function clear() {
    input.value = '';
    refresh(true);
  }

  /** Runs `task` in the queue; on failure puts `raw` back if the user hasn't typed since. */
  function run(task, raw) {
    queue.run(task).catch(() => {
      if (destroyed || mode !== 'search' || input.value !== '' || !raw) return;
      input.value = raw;
      refresh(true);
    });
  }

  function pick(option) {
    if (!option) return;
    switch (option.kind) {
      case 'item': {
        const { note, raw } = model;
        clear();
        run(() => onPickItem(option.value, { note }), raw);
        return;
      }
      case 'recipe': {
        const { note, raw } = model;
        clear();
        if (onPickRecipe) run(() => onPickRecipe(option.value, { note }), raw);
        return;
      }
      case 'create-item':
        startCreate();
        return;
      case 'create-recipe': {
        const { raw } = model;
        clear();
        if (onCreateRecipe) run(() => onCreateRecipe(option.name), raw);
        return;
      }
      case 'category':
      case 'uncategorized':
        choose(option.category);
        return;
      default:
    }
  }

  /** Shift+Enter / the create row: switch the dropdown to the category picker. */
  function startCreate() {
    sync();
    const { query, note, raw, exactItem } = model;
    if (!query) return;
    if (exactItem) {
      toast(`"${exactItem.name}" already exists. Press Enter to add it.`);
      return;
    }
    picker = { raw, name: query, note };
    mode = 'picker';
    input.value = '';
    input.placeholder = 'Filter categories…';
    refresh(true);
  }

  /** Back to the search; `restore` puts the text back (Esc), else the input is left empty. */
  function exitPicker(restore = true) {
    if (mode !== 'picker') return;
    const { raw } = picker;
    mode = 'search';
    picker = null;
    input.placeholder = placeholder;
    input.value = restore ? raw : '';
    refresh(true);
    if (restore) {
      try {
        input.setSelectionRange(raw.length, raw.length);
      } catch {
        // ignore
      }
    }
  }

  /** Creates the picked-for item in `category` (null = Uncategorized), then picks it. */
  function choose(category) {
    if (!picker) return;
    const { name, note, raw } = picker;
    exitPicker(false);
    run(async () => {
      const { id } = await api.createItem({ name, category_id: category ? category.id : null });
      const item = store.state.itemsById.get(id);
      if (item) await onPickItem(item, { note, created: true });
    }, raw);
  }

  // ── Events ─────────────────────────────────────────────────────────────────────────────

  function onKeydown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    sync(); // Enter right after a keystroke acts on the current text
    const action = keyAction(e, { mode, open: isOpen(), empty: input.value === '' });
    if (!action) return;
    if (action === 'exit-down') {
      if (onExitDown?.()) e.preventDefault();
      return;
    }
    e.preventDefault();
    switch (action) {
      case 'down':
      case 'up':
        move(action === 'down' ? 1 : -1);
        break;
      case 'pick':
        pick(activeOption());
        break;
      case 'create':
        startCreate();
        break;
      case 'clear':
        clear();
        break;
      case 'leave':
        if (onEscape) onEscape();
        else parkFocus(); // leave the box, but keep focus in the view (not on <body>)
        break;
      case 'back':
        exitPicker();
        break;
      case 'uncategorized':
        choose(null);
        break;
      case 'digit': {
        const choice = categoryForDigit(e.key, store.state.categories);
        if (choice) choose(choice.category);
        break;
      }
      default:
    }
  }

  function onFocus() {
    focused = true;
    refresh(false);
  }

  function onBlur() {
    focused = false;
    render();
    // Focus went elsewhere on the page (not just another window/app): leave the picker so the
    // omnibar isn't stuck in it; the typed name comes back.
    if (mode === 'picker') {
      setTimeout(() => {
        if (!focused && !destroyed && document.hasFocus()) exitPicker();
      }, 0);
    }
  }

  return {
    el,
    input,
    /** Focuses the input; `select` selects its text (for `/` and Ctrl+K). */
    focus({ select = false } = {}) {
      input.focus();
      if (select) input.select();
    },
    clear,
    /** 'search' or 'picker'. */
    get mode() {
      return mode;
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      vv?.removeEventListener('resize', refit);
    },
  };
}
