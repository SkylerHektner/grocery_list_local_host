// DOM builders for the Store order view (see categories.js for the behaviour): a category row
// with its walk position, item count and move/rename/delete buttons; the Uncategorized footer;
// the empty state. No state of their own.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { hashFor } from '../router.js';
import { countLabel } from '../categories-model.js';
import { noteArt } from '../components/empty.js';

const kbd = (key) => h('kbd', { class: 'kbd' }, key);

/**
 * @param {{id: number, name: string}} category
 * @param {object} view
 * @param {number} view.position   1-based walk position
 * @param {number} view.count      items in it
 * @param {boolean} view.first
 * @param {boolean} view.last
 * @param {boolean} view.tabbable
 * @param {number|undefined} view.flash
 * @param {number} view.now
 * @param {{move: (id: number, delta: number) => void, rename: (id: number) => void, remove: (id: number) => void}} view.on
 */
export function categoryRow(category, { position, count, first, last, tabbable, flash, now, on }) {
  const { id, name } = category;
  const button = (testid, key, label, title, iconName, disabled, onClick, extra) =>
    h(
      'button',
      {
        type: 'button',
        class: ['btn btn-ghost btn-icon btn-sm', extra],
        tabindex: '-1',
        'aria-label': label,
        'aria-disabled': disabled ? 'true' : null,
        title,
        testid,
        dataset: { key },
        onClick: (e) => {
          e.stopPropagation();
          if (!disabled) onClick();
        },
      },
      icon(iconName, { size: 18 }),
    );
  return h(
    'li',
    {
      class: ['row', 'category-row', flash && 'is-flash'],
      style: flash ? { animationDelay: `-${now - flash}ms` } : null,
      tabindex: tabbable ? '0' : '-1',
      'aria-label': `${position}. ${name}, ${countLabel(count).toLowerCase()}`,
      testid: 'category-row',
      dataset: { key: `cat-${id}`, categoryId: String(id) },
    },
    h('span', { class: 'category-num', testid: 'category-position', 'aria-hidden': 'true' }, position),
    h(
      'span',
      { class: 'category-main', title: 'Rename (F2)', onClick: () => on.rename(id) },
      h('span', { class: 'category-name', testid: 'category-name' }, name),
      h('span', { class: ['category-count', !count && 'is-empty'], testid: 'category-count' }, countLabel(count)),
    ),
    h(
      'span',
      { class: 'row-actions category-actions' },
      button('category-up', `up-${id}`, `Move ${name} up`, 'Move up (Alt+↑)', 'arrow-up', first, () => on.move(id, -1), 'category-move'),
      button('category-down', `down-${id}`, `Move ${name} down`, 'Move down (Alt+↓)', 'arrow-down', last, () => on.move(id, 1), 'category-move'),
      button('category-rename', `rename-${id}`, `Rename ${name}`, 'Rename (F2)', 'pencil', false, () => on.rename(id), 'category-rename'),
      button('category-delete', `delete-${id}`, `Delete ${name}`, 'Delete (Delete)', 'trash', false, () => on.remove(id), 'row-remove'),
    ),
  );
}

/** Below the walk: Uncategorized always comes last; a link to review those items. */
export function uncategorizedFoot(count) {
  return [
    h('span', { class: 'category-num is-none', 'aria-hidden': 'true' }, '–'),
    h(
      'span',
      { class: 'category-main' },
      h('span', { class: 'category-name' }, 'Uncategorized'),
      h('span', { class: 'category-count', testid: 'uncategorized-count' }, `${countLabel(count)} · always last`),
    ),
    count > 0 &&
      h(
        'a',
        { class: 'btn btn-ghost btn-sm category-review', href: hashFor('items', 'uncategorized'), testid: 'review-uncategorized' },
        'Review',
        icon('chevron', { size: 16 }),
      ),
  ];
}

/** Keyboard hints under the card (keyboard devices only). */
export function keyHints() {
  return h(
    'p',
    { class: 'category-keys only-keys', 'aria-hidden': 'true' },
    kbd('Alt+↑'),
    kbd('Alt+↓'),
    ' move ',
    kbd('F2'),
    ' rename ',
    kbd('Del'),
    ' delete ',
    kbd('n'),
    ' new category',
  );
}

/** No categories at all. */
export function emptyState() {
  return h(
    'li',
    { class: 'empty categories-empty', testid: 'categories-empty' },
    noteArt(),
    h('h2', { class: 'empty-title' }, 'No categories yet'),
    h(
      'p',
      { class: 'empty-body' },
      'Add the sections of your store in the order you walk through them. ',
      h('span', { class: 'only-keys' }, 'Press ', kbd('n'), ' to add one.'),
    ),
  );
}
