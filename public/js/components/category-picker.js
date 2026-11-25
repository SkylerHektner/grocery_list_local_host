// The category picker sheet (components/pick-dialog.js): the Items view's `c`, its row category
// button and new items, and the omnibar's new-item flow on touch screens (where the inline
// picker would sit under the on-screen keyboard). Digits work like the omnibar's picker.

import { h, highlight } from '../dom.js';
import { categoryOptions, UNCATEGORIZED } from '../omnibar-model.js';
import { openPicker } from './pick-dialog.js';

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
