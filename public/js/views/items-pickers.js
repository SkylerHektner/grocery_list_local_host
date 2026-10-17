// The Items view's pickers, built on components/pick-dialog.js: a category (for `c`, the row's
// category button and new items; digits like the omnibar's picker) and a merge target.

import { h, highlight } from '../dom.js';
import { categoryOptions, UNCATEGORIZED } from '../omnibar-model.js';
import { mergeOptions } from '../items-model.js';
import { openPicker } from '../components/pick-dialog.js';

/**
 * Asks for a category: walk order, numbered 1-9, then Uncategorized (0).
 * @param {object} options
 * @param {object} options.store
 * @param {string} options.title
 * @param {string} [options.lead]
 * @param {number|null} [options.current]  the item's category (marked and highlighted);
 *   undefined for a new item
 * @returns {Promise<{categoryId: number|null} | null>} null when cancelled
 */
export async function pickCategory({ store, title, lead, current }) {
  let currentKey = null;
  if (current !== undefined) {
    currentKey = store.state.categoriesById.has(current) ? `cat-${current}` : UNCATEGORIZED;
  }
  const choice = await openPicker({
    title,
    lead,
    placeholder: 'Filter categories…',
    testid: 'category-picker',
    digits: 'uncategorized',
    initialKey: currentKey,
    emptyText: 'No category matches',
    options: (filter) =>
      categoryOptions(filter, store.state.categories).map((o) => ({
        key: o.key,
        value: o.category ? o.category.id : null,
        number: o.number,
        label: o.category ? highlight(o.category.name, o.ranges) : 'Uncategorized',
        meta: o.key === currentKey ? h('span', { class: 'tag', testid: 'category-current' }, 'current') : null,
        testid: 'category-option',
        className: o.category ? null : 'option-uncategorized',
      })),
  });
  return choice ? { categoryId: choice.value } : null;
}

/**
 * Asks which item `item` should be merged into (every other item; fuzzy filter).
 * @param {{store: object, item: object}} options
 * @returns {Promise<number|null>} the target item id, or null when cancelled
 */
export async function pickMergeTarget({ store, item }) {
  const choice = await openPicker({
    title: `Merge ${item.name} into…`,
    lead: `Pick the item to keep. ${item.name} becomes one of its aliases.`,
    placeholder: 'Find the item to keep…',
    testid: 'merge-picker',
    emptyText: 'No other item matches',
    options: (filter) => {
      const state = store.state;
      const from = state.itemsById.get(item.id) ?? item;
      return mergeOptions(filter, from, state).map((r) => {
        const category = state.categoriesById.get(r.item.category_id);
        return {
          key: `item-${r.item.id}`,
          value: r.item.id,
          label: r.alias
            ? [r.item.name, h('span', { class: 'option-alias' }, highlight(r.alias, r.ranges))]
            : highlight(r.text, r.ranges),
          meta: h('span', { class: ['option-category', !category && 'is-uncategorized'] }, category?.name ?? 'Uncategorized'),
          testid: 'merge-option',
        };
      });
    },
  });
  return choice ? choice.value : null;
}
