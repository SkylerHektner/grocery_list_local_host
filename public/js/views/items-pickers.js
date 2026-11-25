// The Items view's pickers: a category (components/category-picker.js, re-exported) and a merge
// target, both built on components/pick-dialog.js.

import { h, highlight } from '../dom.js';
import { MERGE_BLANK_LIMIT, mergeOptions } from '../items-model.js';
import { openPicker } from '../components/pick-dialog.js';

export { pickCategory } from '../components/category-picker.js';

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
    footnote: (filter, shown) => {
      const others = store.state.items.length - 1;
      return !filter.trim() && shown >= MERGE_BLANK_LIMIT && others > shown
        ? `The first ${shown} of ${others} items: type to find the others.`
        : null;
    },
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
