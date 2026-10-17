// DOM builders for the Items view (see items-rows.js for the behaviour): item rows, the open
// editor's row, the `+ New item "…"` row and the empty states. No state of their own.

import { h, highlight } from '../dom.js';
import { icon } from '../icons.js';
import { itemRowLabel, usageLabel } from '../items-model.js';
import { moreLabel } from '../paging.js';
import { noteArt } from '../components/empty.js';

const kbd = (key) => h('kbd', { class: 'kbd' }, key);

/** The "Enter" keycap on the row Enter acts on (keyboard devices only). */
const enterHint = () => h('span', { class: 'item-row-hint only-keys', 'aria-hidden': 'true' }, kbd('Enter'));

/**
 * @typedef {object} RowView
 * @property {boolean} active      highlighted (Enter in the filter acts on it)
 * @property {boolean} tabbable    roving tabindex
 * @property {number|undefined} flash   time its highlight started
 * @property {number} now
 * @property {object|null} editor  the open editor when this row is being edited
 * @property {{edit: Function, category: Function, create: Function}} on
 */

/** The aliases, the one that matched the filter highlighted. */
function aliasList(item, match) {
  return item.aliases.flatMap((alias, i) => [
    i > 0 && ', ',
    match.alias === alias ? highlight(alias, match.ranges) : alias,
  ]);
}

/**
 * @param {import('../items-model.js').ItemResult & {key: string}} option
 * @param {object} state   derived store state
 * @param {RowView} view
 */
export function itemRow(option, state, view) {
  const { item } = option;
  const category = state.categoriesById.get(item.category_id);
  const usage = usageLabel(item);
  const attrs = {
    class: [
      'row',
      'item-row',
      !category && 'is-uncategorized',
      view.active && 'is-active',
      view.editor && 'is-editing',
      view.flash && 'is-flash',
    ],
    style: view.flash ? { animationDelay: `-${view.now - view.flash}ms` } : null,
    tabindex: view.tabbable ? '0' : '-1',
    'aria-label': view.editor ? null : itemRowLabel(item, state),
    testid: 'item-row',
    dataset: { key: option.key, itemId: String(item.id) },
  };
  if (view.editor) return h('li', attrs, view.editor.el);
  return h(
    'li',
    attrs,
    h(
      'div',
      { class: 'item-row-main', onClick: () => view.on.edit(item.id) },
      h(
        'span',
        { class: 'item-row-title' },
        h('span', { class: 'item-name', testid: 'item-name' }, option.alias ? item.name : highlight(option.text, option.ranges)),
        item.staple && h('span', { class: 'tag tag-warm', testid: 'item-staple', title: 'Starts unchecked when a recipe goes on the list' }, 'staple'),
        state.entriesByItemId.has(item.id) && h('span', { class: 'tag tag-accent', testid: 'item-on-list' }, 'on list'),
      ),
      (item.aliases.length > 0 || usage) &&
        h(
          'span',
          { class: 'item-row-sub' },
          item.aliases.length > 0 && h('span', { class: 'item-aliases', testid: 'item-aliases' }, 'aka ', aliasList(item, option)),
          usage && h('span', { class: 'item-usage', testid: 'item-usage' }, usage),
        ),
    ),
    enterHint(),
    h(
      'button',
      {
        type: 'button',
        class: ['item-category', !category && 'is-uncategorized'],
        tabindex: '-1',
        title: 'Change the category (c)',
        'aria-label': `Category of ${item.name}: ${category?.name ?? 'Uncategorized'}. Change it`,
        testid: 'item-category',
        onClick: (e) => {
          e.stopPropagation();
          view.on.category(item.id);
        },
      },
      !category && icon('alert', { size: 14 }),
      h('span', { class: 'item-category-name' }, category?.name ?? 'Uncategorized'),
      icon('chevron-down', { size: 14 }),
    ),
    h(
      'span',
      { class: 'row-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-ghost btn-icon btn-sm item-edit-btn',
          tabindex: '-1',
          title: 'Edit (Enter)',
          'aria-label': `Edit ${item.name}`,
          testid: 'item-edit',
          onClick: (e) => {
            e.stopPropagation();
            view.on.edit(item.id);
          },
        },
        icon('pencil', { size: 16 }),
      ),
    ),
  );
}

/**
 * `+ New item "Birthday candles"`.
 * @param {{key: string, name: string}} option
 * @param {RowView} view
 */
export function createRow(option, view) {
  return h(
    'li',
    {
      class: ['row', 'item-row', 'item-create', view.active && 'is-active'],
      tabindex: view.tabbable ? '0' : '-1',
      testid: 'item-create',
      dataset: { key: option.key },
      onClick: () => view.on.create(option.name),
    },
    h('span', { class: 'item-row-main' }, h('span', { class: 'item-row-title' }, icon('plus', { size: 16 }), 'New item ', h('q', null, option.name))),
    enterHint(),
  );
}

/**
 * "Show 100 more (1145 not shown)": renders the next page of results (Enter or tap).
 * @param {{key: string, more: number}} option
 * @param {RowView} view
 */
export function moreRow(option, view) {
  return h(
    'li',
    {
      class: ['row', 'item-row', 'item-more'],
      tabindex: view.tabbable ? '0' : '-1',
      testid: 'items-more',
      dataset: { key: option.key },
      onClick: () => view.on.more(),
    },
    h('span', { class: 'item-row-main' }, h('span', { class: 'item-row-title' }, icon('chevron-down', { size: 16 }), moreLabel(option.more))),
  );
}

/** Above the create row when the filter matches nothing. */
export function noneRow(query) {
  return h('li', { class: 'items-none', testid: 'items-none' }, 'No item matches ', h('q', null, query));
}

/**
 * Nothing to show: no items at all, or none passes the quick filters.
 * @param {{total: number, query: string, filters: {uncategorized?: boolean, staples?: boolean}}} options
 */
export function emptyState({ total, query, filters }) {
  let title = 'No items yet';
  let body = [
    'Items you create on the list or in a recipe show up here. ',
    h('span', { class: 'only-keys' }, 'Or type a name above and press ', kbd('Enter'), '.'),
    h('span', { class: 'only-touch' }, 'Or type a name above to create one.'),
  ];
  if (total) {
    const what = filters.uncategorized && filters.staples ? 'uncategorized staple' : filters.uncategorized ? 'uncategorized item' : 'staple';
    title = query ? `No ${what} matches` : filters.uncategorized && !filters.staples ? 'Every item has a category' : `No ${what}s`;
    body = filters.staples
      ? ['Staples are things you usually have: recipes add them unchecked. Mark one in its editor', h('span', { class: 'only-keys' }, ' or with ', kbd('s')), '.']
      : ['Nice: nothing to sort out.'];
  }
  return h(
    'li',
    { class: 'empty items-empty', testid: 'items-empty' },
    noteArt(),
    h('h2', { class: 'empty-title' }, title),
    h('p', { class: 'empty-body' }, body),
  );
}
