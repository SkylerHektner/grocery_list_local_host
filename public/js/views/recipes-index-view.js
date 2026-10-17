// DOM builders for the recipes index (see recipes-index.js for the behaviour): recipe rows, the
// `+ New recipe "…"` row and the empty states. No state of their own.

import { h, highlight } from '../dom.js';
import { icon } from '../icons.js';
import { ingredientCount, ingredientNames } from '../recipes-model.js';
import { noteArt } from '../components/empty.js';

const kbd = (key) => h('kbd', { class: 'kbd' }, key);

/** The "Enter" keycap shown on the row Enter acts on (keyboard devices only). */
const enterHint = () => h('span', { class: 'recipe-row-hint only-keys', 'aria-hidden': 'true' }, kbd('Enter'));

/**
 * @param {{key: string, recipe: object, text: string, ranges: Array<[number, number]>}} option
 * @param {object} state  derived store state
 * @param {{active: boolean, tabbable: boolean, onOpen: (id: number) => void, onAdd: (id: number) => void}} view
 */
export function recipeRow(option, state, { active, tabbable, onOpen, onAdd }) {
  const { recipe } = option;
  const names = ingredientNames(recipe, state);
  return h(
    'li',
    {
      class: ['row', 'recipe-row', active && 'is-active'],
      tabindex: tabbable ? '0' : '-1',
      testid: 'recipe-row',
      dataset: { key: option.key, recipeId: String(recipe.id) },
    },
    h(
      'div',
      { class: 'recipe-row-main', onClick: () => onOpen(recipe.id) },
      h(
        'span',
        { class: 'recipe-row-title' },
        h('span', { class: 'recipe-row-name', testid: 'recipe-name' }, highlight(option.text, option.ranges)),
        state.listRecipeIds.has(recipe.id) && h('span', { class: 'tag tag-accent', testid: 'recipe-on-list' }, 'on list'),
      ),
      h(
        'span',
        { class: 'recipe-row-sub' },
        h('span', { class: 'recipe-row-count', testid: 'recipe-count' }, ingredientCount(recipe)),
        names && h('span', { class: 'recipe-row-items' }, names),
      ),
    ),
    enterHint(),
    h(
      'span',
      { class: 'row-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-sm recipe-add',
          tabindex: '-1',
          title: 'Add to the list (a)',
          'aria-label': `Add ${recipe.name} to the list`,
          testid: 'recipe-add',
          onClick: (e) => {
            e.stopPropagation();
            onAdd(recipe.id);
          },
        },
        icon('plus', { size: 16 }),
        h('span', { class: 'recipe-add-label' }, 'Add'),
      ),
    ),
  );
}

/**
 * `+ New recipe "Lasagna"`.
 * @param {{key: string, name: string}} option
 * @param {{active: boolean, tabbable: boolean, onCreate: (name: string) => void}} view
 */
export function createRow(option, { active, tabbable, onCreate }) {
  return h(
    'li',
    {
      class: ['row', 'recipe-row', 'recipe-create', active && 'is-active'],
      tabindex: tabbable ? '0' : '-1',
      testid: 'recipe-create',
      dataset: { key: option.key },
      onClick: () => onCreate(option.name),
    },
    h(
      'span',
      { class: 'recipe-row-main' },
      h('span', { class: 'recipe-row-title' }, icon('plus', { size: 16 }), 'New recipe ', h('q', null, option.name)),
    ),
    enterHint(),
  );
}

/** Above the create row when the filter matches nothing. */
export function noneRow(query) {
  return h('li', { class: 'recipes-none', testid: 'recipes-none' }, 'No recipe matches ', h('q', null, query));
}

/** No recipes at all. */
export function emptyState() {
  return h(
    'li',
    { class: 'empty recipes-empty', testid: 'recipes-empty' },
    noteArt(),
    h('h2', { class: 'empty-title' }, 'No recipes yet'),
    h(
      'p',
      { class: 'empty-body' },
      'A recipe is a set of items you put on the list in one go. ',
      h('span', { class: 'only-keys' }, 'Type a name above and press ', kbd('Enter'), ' to start one.'),
      h('span', { class: 'only-touch' }, 'Type a name above to start one.'),
    ),
  );
}
