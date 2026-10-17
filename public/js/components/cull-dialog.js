// The cull dialog (SPEC §3.4): a recipe's ingredients as checkboxes, in list order, before the
// recipe goes on the list. Staples start unchecked, items already on the list are tagged. Keys:
// ↑/↓ (j/k) move, Space toggles, `a` toggles all, Enter adds, Esc cancels; Tab stays inside and
// focus returns to where it was (the omnibar) afterwards. Narrow screens get a full-screen sheet
// with a sticky confirm button. Logic: cull-model.js.
//
//   // inside the view's mutation queue, so it lands in order with other edits:
//   queue.run(() => addRecipeWithCull({ recipe, store, api, toast, onUndo, onEdit }));

import { h, rerender } from '../dom.js';
import {
  addedMessage,
  chosenIds,
  countLabel,
  cullGroups,
  cullKeyAction,
  defaultChecked,
  ingredientOrder,
  listChanged,
  reconcileChecked,
  toggleAll,
  toggleOne,
} from '../cull-model.js';
import { openModal } from './dialog.js';

const kbd = (key) => h('kbd', { class: 'kbd' }, key);

/**
 * Opens the dialog for `recipe`. Resolves `{action: 'add', itemIds}` (confirmed; `itemIds` in
 * recipe order, possibly empty), `{action: 'edit'}` (the recipe has no ingredients and the user
 * chose to open its editor), `{action: 'gone'}` (deleted on another device meanwhile) or null
 * (cancelled).
 * @param {{recipe: object, store: object}} options
 * @returns {Promise<{action: 'add', itemIds: number[]} | {action: 'edit'} | {action: 'gone'} | null>}
 */
export function openCullDialog({ recipe, store }) {
  if (!cullGroups(recipe, store.state).length) return openEmpty(recipe);
  return new Promise((resolve) => {
    const id = recipe.id;
    let groups = cullGroups(recipe, store.state);
    let order = ingredientOrder(groups);
    let checked = defaultChecked(groups);
    let cursor = order[0];
    let modal = null;
    let unsubscribe = () => {};

    const done = (result) => {
      unsubscribe();
      modal?.close();
      resolve(result);
    };
    const confirmAdd = () => {
      const latest = store.state.recipesById.get(id);
      done(latest ? { action: 'add', itemIds: chosenIds(latest, checked) } : { action: 'gone' });
    };

    const count = h('span', { class: 'cull-count', testid: 'cull-count', 'aria-live': 'polite' });
    const toggleButton = h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm cull-toggle-all',
      testid: 'cull-toggle-all',
      title: 'Check or uncheck everything (a)',
      'aria-keyshortcuts': 'A',
      onClick: () => setChecked(toggleAll(checked, order)),
    });
    const list = h('div', {
      class: 'cull-list',
      role: 'group',
      'aria-label': 'Ingredients',
      testid: 'cull-list',
      onChange,
      onFocusin: (e) => {
        const itemId = Number(e.target?.dataset?.itemId);
        if (itemId) setCursor(itemId);
      },
    });

    function row(r) {
      const itemId = r.item.id;
      return h(
        'li',
        { class: 'cull-row', testid: 'cull-row', dataset: { itemId: String(itemId) } },
        h(
          'label',
          { class: 'cull-label' },
          h('input', {
            type: 'checkbox',
            class: 'checkbox cull-check',
            checked: checked.has(itemId),
            tabindex: itemId === cursor ? '0' : '-1',
            testid: 'cull-check',
            dataset: { key: `cull-${itemId}`, itemId: String(itemId) },
          }),
          h(
            'span',
            { class: 'cull-text' },
            h('span', { class: 'cull-name', testid: 'cull-name' }, r.item.name),
            r.note && h('span', { class: 'row-note cull-note', testid: 'cull-note', title: 'Note from the recipe' }, r.note),
          ),
          h(
            'span',
            { class: 'cull-tags' },
            r.onList && h('span', { class: 'tag tag-accent', testid: 'cull-tag' }, 'on list'),
            r.staple && h('span', { class: 'tag tag-warm', testid: 'cull-tag' }, 'staple'),
          ),
        ),
      );
    }

    function renderList() {
      rerender(list, () =>
        groups.map((g) =>
          h(
            'section',
            { class: 'cull-group', 'aria-label': g.name },
            h('h3', { class: 'group-header cull-group-header', 'aria-hidden': 'true' }, g.name),
            h('ul', { class: 'rows cull-rows', role: 'list' }, g.rows.map(row)),
          ),
        ),
      );
      paint();
    }

    /** Syncs checkboxes, row styles, the count and the toggle-all label with `checked`. */
    function paint() {
      for (const input of list.querySelectorAll('.cull-check')) {
        const on = checked.has(Number(input.dataset.itemId));
        input.checked = on;
        input.closest('.cull-row').classList.toggle('is-skipped', !on);
      }
      count.textContent = countLabel(checked.size, order.length);
      const all = order.length > 0 && order.every((i) => checked.has(i));
      toggleButton.textContent = all ? 'Uncheck all' : 'Check all';
    }

    function setChecked(next) {
      checked = next;
      paint();
    }

    function setCursor(itemId) {
      cursor = itemId;
      for (const input of list.querySelectorAll('.cull-check')) {
        input.tabIndex = Number(input.dataset.itemId) === itemId ? 0 : -1;
      }
    }

    function focusRow(itemId) {
      if (itemId === undefined) return;
      setCursor(itemId);
      const input = list.querySelector(`.cull-check[data-item-id="${itemId}"]`);
      input?.focus();
      input?.closest('.cull-row')?.scrollIntoView({ block: 'nearest' });
    }

    function onChange(e) {
      const itemId = Number(e.target?.dataset?.itemId);
      if (!itemId) return;
      // The checkbox already flipped itself; mirror it (and repaint in case of a mismatch).
      if (e.target.checked !== checked.has(itemId)) checked = toggleOne(checked, itemId);
      paint();
    }

    function onKeydown(e) {
      if (e.isComposing) return;
      const action = cullKeyAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'toggle-all') {
        setChecked(toggleAll(checked, order));
        return;
      }
      const index = order.indexOf(cursor);
      // From a button, ↑/↓ first go back to the row the user was on.
      const step = list.contains(e.target) ? 1 : 0;
      if (action === 'down') focusRow(order[Math.min(index + step, order.length - 1)]);
      else if (action === 'up') focusRow(order[Math.max(index - step, 0)]);
      else if (action === 'first') focusRow(order[0]);
      else focusRow(order[order.length - 1]);
    }

    // Live sync: ingredients edited (or the list changed) on another device while open.
    unsubscribe = store.subscribe((state) => {
      const latest = state.recipesById.get(id);
      if (!latest) {
        done({ action: 'gone' });
        return;
      }
      const seen = new Set(order);
      groups = cullGroups(latest, state);
      order = ingredientOrder(groups);
      checked = reconcileChecked(checked, seen, groups);
      if (!order.includes(cursor)) cursor = order[0];
      renderList();
    });

    const confirmButton = h(
      'button',
      { type: 'button', class: 'btn btn-primary cull-confirm', testid: 'cull-confirm', onClick: confirmAdd },
      'Add to list',
    );
    const cancelButton = h(
      'button',
      { type: 'button', class: 'btn btn-ghost cull-cancel', testid: 'cull-cancel', onClick: () => done(null) },
      'Cancel',
    );

    renderList();
    modal = openModal({
      title: `Add ${recipe.name}`,
      body: [
        h(
          'p',
          { class: 'cull-lead' },
          'Uncheck what you already have.',
          h('span', { class: 'cull-keys only-keys' }, kbd('Space'), ' skip ', kbd('a'), ' all ', kbd('Enter'), ' add'),
        ),
        list,
      ],
      actions: [h('div', { class: 'cull-status' }, count, toggleButton), cancelButton, confirmButton],
      testid: 'cull-dialog',
      className: 'cull-modal',
      closeButton: true,
      onRequestClose: () => done(null),
      onEnter: confirmAdd,
      initialFocus: () => list.querySelector('.cull-check[tabindex="0"]'),
    });
    // On the whole panel, so `a` and the arrows also work from the buttons.
    modal.el.addEventListener('keydown', onKeydown);
  });
}

/** A recipe without ingredients: nothing to cull, so offer its editor instead. */
function openEmpty(recipe) {
  return new Promise((resolve) => {
    let modal = null;
    const done = (result) => {
      modal?.close();
      resolve(result);
    };
    const edit = h(
      'button',
      { type: 'button', class: 'btn btn-primary', testid: 'cull-edit', onClick: () => done({ action: 'edit' }) },
      'Edit recipe',
    );
    modal = openModal({
      title: `${recipe.name} has no ingredients`,
      body: h(
        'p',
        { class: 'modal-message', testid: 'cull-empty' },
        'Add its ingredients in the recipe editor first, then add it to the list.',
      ),
      actions: [
        h('button', { type: 'button', class: 'btn btn-ghost', testid: 'cull-cancel', onClick: () => done(null) }, 'Cancel'),
        edit,
      ],
      testid: 'cull-dialog',
      onRequestClose: () => done(null),
      onEnter: () => done({ action: 'edit' }),
      initialFocus: () => edit,
    });
  });
}

/**
 * The whole "add a recipe to the list" flow: the cull dialog, `POST /api/list/recipes`, then a
 * toast ("Added 8 items from Tacos") with Undo when the list changed. Run it inside the view's
 * mutation queue. Rejects (after the api's error toast) when the request fails.
 * @param {object} options
 * @param {object} options.recipe
 * @param {object} options.store
 * @param {object} options.api
 * @param {Function} options.toast
 * @param {() => void} [options.onUndo]  the Undo button
 * @param {() => void} [options.onEdit]  open the editor (a recipe without ingredients)
 * @returns {Promise<boolean>} whether the recipe was added
 */
export async function addRecipeWithCull({ recipe, store, api, toast, onUndo, onEdit }) {
  const choice = await openCullDialog({ recipe, store });
  if (!choice) return false;
  if (choice.action === 'edit') {
    onEdit?.();
    return false;
  }
  if (choice.action === 'gone') {
    toast(`${recipe.name} was deleted`);
    return false;
  }
  const before = store.state;
  await api.addRecipeToList(recipe.id, choice.itemIds);
  const changed = listChanged(before, store.state);
  const name = store.state.recipesById.get(recipe.id)?.name ?? recipe.name;
  toast(
    addedMessage(name, choice.itemIds.length, changed),
    changed && onUndo ? { variant: 'success', action: { label: 'Undo', onClick: onUndo } } : {},
  );
  return true;
}
