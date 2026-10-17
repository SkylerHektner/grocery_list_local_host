// "Recipes on this list" chips (SPEC §3.5): one per recipe in `list.recipe_ids`, each with an ×
// that takes the recipe off the list (its items go unless also added manually or by another
// recipe). Keyed by recipe id so keyboard focus survives live-sync re-renders.

import { h, rerender } from '../dom.js';
import { icon } from '../icons.js';

/**
 * @param {object} deps
 * @param {object} deps.store
 * @param {(recipe: object) => void} deps.onRemove
 * @param {() => void} deps.focusFallback  where focus goes when the last chip disappears
 */
export function createRecipeChips({ store, onRemove, focusFallback }) {
  const el = h('div', { class: 'recipe-chips', testid: 'recipe-chips', role: 'group', 'aria-label': 'Recipes on this list' });

  function chip(recipe) {
    return h(
      'span',
      { class: 'chip', testid: 'recipe-chip', 'data-recipe-id': recipe.id },
      icon('book', { size: 14 }),
      h('span', { class: 'chip-label' }, recipe.name),
      h(
        'button',
        {
          type: 'button',
          class: 'chip-remove',
          'aria-label': `Take ${recipe.name} off the list`,
          title: `Take ${recipe.name} and its items off the list`,
          testid: 'recipe-chip-remove',
          dataset: { key: `chip-${recipe.id}` },
          onClick: () => onRemove(recipe),
        },
        icon('close', { size: 14 }),
      ),
    );
  }

  function render() {
    const state = store.state;
    const recipes = state.list.recipe_ids.map((id) => state.recipesById.get(id)).filter(Boolean);
    const hadFocus = el.contains(document.activeElement);
    el.hidden = !recipes.length;
    rerender(el, () =>
      recipes.length ? [h('span', { class: 'recipe-chips-label' }, 'From recipes'), ...recipes.map(chip)] : [],
    );
    // The focused chip was removed: move to the next one, else back to the search.
    if (hadFocus && !el.contains(document.activeElement)) {
      const next = el.querySelector('.chip-remove');
      if (next) next.focus();
      else focusFallback();
    }
  }

  return { el, render };
}
