// Recipes index (#/recipes, SPEC §3.7): a fuzzy filter over every recipe, with ingredient
// counts and an "on list" marker. Keys in the filter: typing filters, Enter opens the top match
// (or creates the typed name via the `+ New recipe "…"` row when nothing matches), ↓ moves into
// the rows, Esc clears. On a row: ↑/↓ (j/k) move (↑ on the first: back to the filter), Home/End,
// Enter opens, `a` adds to the list (cull dialog), / or Esc back to the filter. `n` anywhere
// (when not typing) or the "New recipe" button asks for a name. Rows are keyed by recipe id, so
// focus survives live-sync re-renders. DOM builders: recipes-index-view.js.

import { h, isKeyboardDevice, isTypingTarget, parkFocus, rerender } from '../dom.js';
import { icon } from '../icons.js';
import { filterRecipes, recipesSummary } from '../recipes-model.js';
import { isModalOpen } from '../components/dialog.js';
import { promptName } from '../components/name-dialog.js';
import { stickyBar } from '../components/sticky-bar.js';
import { createRow, emptyState, noneRow, recipeRow } from './recipes-index-view.js';

/**
 * @param {HTMLElement} container
 * @param {object} ctx      view ctx, scoped to the index
 * @param {object} actions  from views/recipes.js: addToList(recipe), open(id), create(name), queue
 * @param {{focusRecipe?: number|null}} options  the recipe whose row gets focus (back from its editor)
 */
export function createRecipesIndex(container, ctx, actions, { focusRecipe = null } = {}) {
  const { store, api } = ctx;
  let model = filterRecipes('', store.state.recipes);
  let cursorKey = null; // the row with tabindex=0 (roving tabindex)
  let inputFocused = false;

  const input = h('input', {
    class: 'search-input',
    type: 'search',
    placeholder: 'Find a recipe, or name a new one',
    'aria-label': 'Find a recipe, or name a new one',
    'aria-controls': 'recipe-list',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    enterkeyhint: 'go',
    testid: 'recipes-search',
    onInput: () => refresh(),
    onKeydown: onInputKeydown,
    // Repaint only: a rebuild here would replace the row that focus is moving to.
    onFocus: () => {
      inputFocused = true;
      paintActive();
    },
    onBlur: () => {
      inputFocused = false;
      paintActive();
    },
  });
  const list = h('ul', {
    class: 'rows recipe-rows',
    id: 'recipe-list',
    role: 'list', // list-style: none drops the list role in Safari
    'aria-label': 'Recipes',
    testid: 'recipe-list',
    onKeydown: onRowKeydown,
    onFocusin: (e) => {
      const key = keyOf(e.target);
      if (key) setCursor(key);
    },
  });
  const summaryEl = h('p', { class: 'view-lead', testid: 'recipes-summary' });

  // ── Options ────────────────────────────────────────────────────────────────────────────

  /** The rows in order: `{key, recipe?, ranges?, text?}`; the create row has key 'create'. */
  function options() {
    const rows = model.results.map((r) => ({ key: `recipe-${r.recipe.id}`, ...r }));
    if (model.createName) rows.push({ key: 'create', name: model.createName });
    return rows;
  }

  function refresh() {
    model = filterRecipes(input.value, store.state.recipes);
    renderRows();
  }

  function act(option) {
    if (!option) return;
    if (option.recipe) actions.open(option.recipe.id);
    else actions.create(option.name);
  }

  async function newRecipe() {
    const id = await promptName({
      title: 'New recipe',
      label: 'Recipe name',
      placeholder: 'e.g. Lasagna',
      value: model.query,
      confirmLabel: 'Create recipe',
      testid: 'new-recipe-dialog',
      submit: (name) => actions.queue.run(() => api.quiet.createRecipe({ name })).then((res) => res.id),
    });
    if (id !== null && id !== undefined) actions.open(id);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────────────────

  /** While typing in the filter, the top row is what Enter acts on: it is highlighted. */
  function activeKey(opts = options()) {
    return inputFocused && model.query ? (opts[0]?.key ?? null) : null;
  }

  function paintActive() {
    const key = activeKey();
    for (const li of list.querySelectorAll('.recipe-row')) li.classList.toggle('is-active', li.dataset.key === key);
  }

  function renderRows() {
    const opts = options();
    if (!opts.some((o) => o.key === cursorKey)) cursorKey = opts[0]?.key ?? null;
    const active = activeKey(opts);
    const state = store.state;
    const handlers = {
      onOpen: actions.open,
      onAdd: (id) => actions.addToList(store.state.recipesById.get(id)),
      onCreate: actions.create,
    };
    rerender(list, () => {
      if (!opts.length) return emptyState();
      const rows = opts.map((o) => {
        const view = { ...handlers, active: o.key === active, tabbable: o.key === cursorKey };
        return o.recipe ? recipeRow(o, state, view) : createRow(o, view);
      });
      if (model.query && !model.results.length) rows.unshift(noneRow(model.query));
      return rows;
    });
    summaryEl.textContent = recipesSummary(store.state);
  }

  // ── Focus & keys ───────────────────────────────────────────────────────────────────────

  function keyOf(node) {
    return node?.closest?.('.recipe-row')?.dataset.key ?? null;
  }

  function rowEl(key) {
    return list.querySelector(`.recipe-row[data-key="${CSS.escape(key)}"]`);
  }

  function setCursor(key) {
    cursorKey = key;
    for (const li of list.querySelectorAll('.recipe-row')) li.tabIndex = li.dataset.key === key ? 0 : -1;
  }

  function focusRow(key) {
    const li = key && rowEl(key);
    if (!li) return false;
    setCursor(key);
    li.focus({ preventScroll: true });
    li.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function focusInput(select = false) {
    input.focus();
    if (select) input.select();
  }

  function onInputKeydown(e) {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowDown') {
      const first = options()[0];
      if (first && focusRow(first.key)) e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      refresh(); // act on exactly what is typed
      if (model.query) act(options()[0]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value) {
        input.value = '';
        refresh();
      } else {
        parkFocus();
      }
    }
  }

  function onRowKeydown(e) {
    if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const key = keyOf(e.target);
    if (!key) return;
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    const opts = options();
    const index = opts.findIndex((o) => o.key === key);
    const option = opts[index];
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        if (index < opts.length - 1) focusRow(opts[index + 1].key);
        break;
      case 'ArrowUp':
      case 'k':
        if (index > 0) focusRow(opts[index - 1].key);
        else focusInput();
        break;
      case 'Home':
        focusRow(opts[0].key);
        break;
      case 'End':
        focusRow(opts[opts.length - 1].key);
        break;
      case 'Enter':
        act(option);
        break;
      case 'a':
        if (!option?.recipe) return;
        actions.addToList(store.state.recipesById.get(option.recipe.id));
        break;
      case 'Escape':
      case '/':
        focusInput(e.key === '/');
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // `n` anywhere in the view (not while typing): new recipe.
  ctx.listen(document, 'keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || isModalOpen() || isTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.key !== 'n') return;
    e.preventDefault();
    newRecipe();
  });

  // ── Layout ─────────────────────────────────────────────────────────────────────────────

  const newButton = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-primary btn-sm',
      testid: 'new-recipe',
      title: 'New recipe (n)',
      'aria-keyshortcuts': 'N',
      onClick: newRecipe,
    },
    icon('plus', { size: 16 }),
    'New recipe',
  );
  const { sentinel, bar } = stickyBar(
    ctx,
    { testid: 'recipes-bar' },
    h('label', { class: 'search' }, icon('search'), input, h('kbd', { class: 'kbd search-hint', 'aria-hidden': 'true' }, '/')),
  );
  container.classList.add('recipes-view');
  container.append(
    h(
      'header',
      { class: 'view-head split-head' },
      h('div', { class: 'split-head-text' }, h('h1', { class: 'view-title', testid: 'view-title' }, 'Recipes'), summaryEl),
      h('div', { class: 'split-head-actions' }, newButton),
    ),
    sentinel,
    bar,
    h('div', { class: 'card recipes-card' }, list),
  );

  ctx.subscribe(() => refresh());
  renderRows();
  if (!(focusRecipe !== null && focusRow(`recipe-${focusRecipe}`)) && isKeyboardDevice()) focusInput();

  return {
    focusSearch: () => focusInput(true),
  };
}
