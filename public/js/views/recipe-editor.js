// Recipe editor (#/recipes/<id>, SPEC §3.7): rename (Enter or leaving the field saves; errors
// show under it), add ingredients with the omnibar (items only, inline item creation included;
// `beef, 1 lb` gives the ingredient a note), edit their notes and remove them
// (views/recipe-ingredients.js), add the recipe to the list (cull dialog) or delete
// it. Every edit goes through the view's queue and reads the latest recipe first, so rapid entry
// never drops an ingredient. Live sync never touches the name field while it is focused or holds
// an unsaved edit, nor the omnibar text. Esc in the empty omnibar (or the back link) goes back
// to where the editor was opened from: the List view after `+ Create recipe`, else the index.
// F2 jumps to the name.

import { h, isKeyboardDevice } from '../dom.js';
import { icon } from '../icons.js';
import { hashFor } from '../router.js';
import { hasIngredient, ingredientCount, ingredientIds, withIngredient, withIngredientNote } from '../recipes-model.js';
import { isModalOpen } from '../components/dialog.js';
import { noteArt } from '../components/empty.js';
import { createOmnibar } from '../components/omnibar.js';
import { stickyBar } from '../components/sticky-bar.js';
import { createIngredientRows } from './recipe-ingredients.js';

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * @param {HTMLElement} container
 * @param {object} ctx      view ctx, scoped to this editor
 * @param {object} actions  from views/recipes.js: queue, addToList(recipe)
 * @param {{id: number, back: {view: string, label: string}, onFound: () => void}} options
 *   `onFound`: the "not found" recipe has arrived (created on another device, not synced yet
 *   when the editor opened): rebuild the editor
 */
export function createRecipeEditor(container, ctx, actions, { id, back, onFound }) {
  const { store, api, toast } = ctx;
  const { queue } = actions;
  const latest = () => store.state.recipesById.get(id);
  const backLink = h(
    'a',
    { class: 'back-link', href: hashFor(back.view), testid: 'recipe-back' },
    icon('back', { size: 18 }),
    back.label,
  );
  container.classList.add('recipe-editor');

  if (!latest()) return notFound();

  let deleting = false;
  let savingName = null; // the name text being saved, while its request is in flight
  let rejectedName = null; // the last name the server refused (not re-sent on blur)

  // ── Name ───────────────────────────────────────────────────────────────────────────────

  const nameError = h('p', { class: 'field-error', id: 'recipe-name-error', role: 'alert', testid: 'recipe-name-error', hidden: true });
  const nameInput = h('input', {
    class: 'recipe-name-input',
    type: 'text',
    value: latest().name,
    maxlength: '80',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-label': 'Recipe name',
    'aria-describedby': 'recipe-name-error',
    title: 'Rename (F2)',
    testid: 'recipe-name-input',
    onInput: () => {
      rejectedName = null;
      setNameError(null);
    },
    onKeydown: (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        saveName(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        nameInput.value = latest()?.name ?? nameInput.value;
        setNameError(null);
        omnibar.focus();
      }
    },
    onBlur: () => saveName(false),
  });

  function setNameError(message) {
    nameError.textContent = message ?? '';
    nameError.hidden = !message;
    if (message) nameInput.setAttribute('aria-invalid', 'true');
    else nameInput.removeAttribute('aria-invalid');
  }

  /** Saves the typed name if it changed. `enter`: then move on to the ingredient search. */
  async function saveName(enter) {
    const recipe = latest();
    const typed = nameInput.value;
    if (!recipe || deleting || typed === savingName || typed === rejectedName) return;
    if (collapse(typed) === recipe.name) {
      nameInput.value = recipe.name;
      setNameError(null);
      if (enter) omnibar.focus();
      return;
    }
    savingName = typed;
    try {
      await queue.run(async () => {
        const current = latest();
        if (current) await api.quiet.updateRecipe(id, { name: typed, ingredients: current.ingredients });
      });
      setNameError(null);
      if (nameInput.value === typed) nameInput.value = latest()?.name ?? typed; // normalized
      renderHead();
      if (enter && document.activeElement === nameInput) omnibar.focus();
    } catch (err) {
      rejectedName = typed;
      const message = err?.message ?? 'Could not rename the recipe';
      setNameError(message);
      if (enter) nameInput.select();
      // Saved on the way out of the editor: the inline error is gone with it.
      if (!nameInput.isConnected) toast(message, { variant: 'error' });
    } finally {
      savingName = null;
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────────────────

  /** Adds the picked item with the typed note; already an ingredient: a typed note replaces its note. */
  async function addIngredient(item, { note = null } = {}) {
    const recipe = latest();
    if (!recipe) return;
    const ingredients = withIngredient(recipe, item.id, note);
    if (!ingredients) {
      const renoted = note ? withIngredientNote(recipe, item.id, note) : null;
      if (renoted) await api.updateRecipe(id, { name: recipe.name, ingredients: renoted });
      toast(renoted ? `Updated the note for ${item.name}` : `${item.name} is already in ${recipe.name}`);
      rows.highlight([item.id]);
      rows.render();
      rows.reveal(item.id);
      return;
    }
    await api.updateRecipe(id, { name: recipe.name, ingredients });
    announcer.textContent = `Added ${item.name}`;
    rows.reveal(item.id);
  }

  function addToList() {
    const recipe = latest();
    if (!recipe) return;
    if (!recipe.ingredients.length) {
      toast(`Add some ingredients to ${recipe.name} first`);
      omnibar.focus();
      return;
    }
    actions.addToList(recipe);
  }

  async function deleteRecipe() {
    const recipe = latest();
    if (!recipe) return;
    const onList = store.state.listRecipeIds.has(id);
    const ok = await ctx.confirm({
      title: `Delete ${recipe.name}?`,
      message: onList
        ? "It comes off the list too; items already on the list stay there. This can't be undone."
        : "Its ingredients stay in your catalog. This can't be undone.",
      confirmLabel: 'Delete recipe',
      danger: true,
    });
    if (!ok) return;
    deleting = true;
    queue.run(() => api.deleteRecipe(id)).then(
      () => {
        toast(`Deleted ${recipe.name}`);
        ctx.navigate('recipes');
      },
      () => {
        deleting = false;
      },
    );
  }

  // ── Pieces ─────────────────────────────────────────────────────────────────────────────

  const omnibar = createOmnibar({
    store,
    api,
    toast,
    queue,
    idPrefix: 'recipe',
    placeholder: 'Add an ingredient…',
    label: 'Add an ingredient',
    itemBadge: (item, state) => {
      const recipe = state.recipesById.get(id);
      return recipe && hasIngredient(recipe, item.id) ? 'in recipe' : null;
    },
    onPickItem: addIngredient,
    onExitDown: () => rows.focusFirst(),
    onEscape: () => ctx.navigate(back.view),
  });
  const rows = createIngredientRows({ recipeId: id, store, api, queue, toast, focusSearch: () => omnibar.focus() });
  const announcer = h('div', { class: 'visually-hidden', role: 'status', testid: 'recipe-announcer' });
  const summaryEl = h('p', { class: 'view-lead recipe-summary', testid: 'recipe-summary' });
  const addButton = h(
    'button',
    { type: 'button', class: 'btn btn-primary btn-sm', testid: 'recipe-add-to-list', onClick: addToList },
    icon('plus', { size: 16 }),
    'Add to list',
  );
  const deleteButton = h(
    'button',
    { type: 'button', class: 'btn btn-ghost btn-sm btn-quiet-danger', testid: 'recipe-delete', onClick: deleteRecipe },
    icon('trash', { size: 16 }),
    'Delete',
  );

  function renderHead() {
    const recipe = latest();
    if (!recipe) return;
    const onList = store.state.listRecipeIds.has(id);
    summaryEl.replaceChildren(
      ingredientCount(recipe),
      ...(onList ? [h('span', { class: 'tag tag-accent', testid: 'recipe-on-list' }, 'on list')] : []),
    );
    // Never clobber typing: only an idle, unedited name field follows other devices.
    const idle = document.activeElement !== nameInput && savingName === null && nameError.hidden;
    if (idle) nameInput.value = recipe.name;
  }

  // ── Layout ─────────────────────────────────────────────────────────────────────────────

  const { sentinel, bar } = stickyBar(ctx, { testid: 'recipe-bar' }, omnibar.el);
  container.append(
    h('nav', { class: 'recipe-nav', 'aria-label': 'Back' }, backLink),
    h(
      'header',
      { class: 'view-head split-head recipe-head' },
      h('div', { class: 'split-head-text recipe-title' }, nameInput, nameError, summaryEl),
      h('div', { class: 'split-head-actions' }, deleteButton, addButton),
    ),
    sentinel,
    bar,
    h('div', { class: 'card list-card' }, rows.el),
    announcer,
  );

  renderHead();
  rows.render();

  ctx.subscribe((state, prev) => {
    if (gone) return;
    const recipe = state.recipesById.get(id);
    if (!recipe) {
      if (!deleting) replaceWithNotFound();
      return;
    }
    const old = prev?.recipesById.get(id);
    const before = new Set(old ? ingredientIds(old) : []);
    rows.highlight(ingredientIds(recipe).filter((i) => !before.has(i)));
    renderHead();
    rows.render();
  });

  ctx.listen(document, 'keydown', (e) => {
    if (e.defaultPrevented || isModalOpen() || e.key !== 'F2' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    nameInput.focus();
    nameInput.select();
  });

  ctx.onCleanup(() => {
    omnibar.destroy();
    rows.destroy();
  });

  if (isKeyboardDevice()) omnibar.focus();

  let gone = false;
  function replaceWithNotFound() {
    if (gone) return;
    gone = true;
    omnibar.destroy();
    rows.destroy();
    const hadFocus = container.contains(document.activeElement);
    container.replaceChildren();
    notFound();
    if (hadFocus) backLink.focus();
  }

  function notFound() {
    ctx.subscribe((state) => {
      if (state.recipesById.has(id)) onFound();
    });
    container.append(
      h('nav', { class: 'recipe-nav', 'aria-label': 'Back' }, backLink),
      h(
        'section',
        { class: 'card empty', testid: 'recipe-not-found' },
        noteArt(),
        h('h1', { class: 'empty-title' }, 'Recipe not found'),
        h('p', { class: 'empty-body' }, 'It may have been deleted, maybe on another device.'),
        h('a', { class: 'btn btn-primary', href: hashFor('recipes'), testid: 'recipe-not-found-back' }, 'All recipes'),
      ),
    );
    return { recipeId: id, focusSearch: () => backLink.focus() };
  }

  return {
    recipeId: id,
    focusSearch: () => (gone ? backLink.focus() : omnibar.focus({ select: true })),
  };
}
