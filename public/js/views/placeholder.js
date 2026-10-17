// Stand-in view until T5-T7 replace each view module: a search box previewing fuzzy matches,
// an empty state, and live counts from the snapshot (shows routing and live sync working).

import { search } from '../fuzzy.js';
import { h, highlight, rerender } from '../dom.js';
import { icon } from '../icons.js';
import { noteArt } from '../components/empty.js';

export { noteArt };

const STATS = [
  ['list', 'On the list', (s) => s.list.entries.length],
  ['items', 'Items', (s) => s.items.length],
  ['recipes', 'Recipes', (s) => s.recipes.length],
  ['categories', 'Store sections', (s) => s.categories.length],
];

/**
 * @param {object} config
 * @param {string} config.id
 * @param {string} config.title
 * @param {string} config.lead
 * @param {string} config.placeholder         search box placeholder
 * @param {string} config.emptyTitle
 * @param {string} config.emptyBody
 * @param {(state: object) => object[]} config.candidates
 * @param {(item: object, state: object) => Node[]} config.meta  tags shown on a result row
 */
export function placeholderView(config) {
  let input = null;
  let results = null;
  let stats = null;
  let store = null;

  function renderResults() {
    const query = input.value;
    const state = store.state;
    const found = query.trim() ? search(query, config.candidates(state), { limit: 6 }) : [];
    results.hidden = !query.trim();
    rerender(results, () =>
      found.length
        ? found.map((r, i) =>
            h(
              'li',
              {
                class: 'option',
                role: 'option',
                id: `${config.id}-option-${r.item.id}`,
                'aria-selected': i === 0 ? 'true' : 'false',
                testid: 'search-result',
              },
              h(
                'span',
                { class: 'option-label' },
                r.alias ? r.item.name : highlight(r.text, r.ranges),
                r.alias && h('span', { class: 'option-alias' }, highlight(r.alias, r.ranges)),
              ),
              h('span', { class: 'option-meta' }, config.meta(r.item, state)),
            ),
          )
        : h('li', { class: 'option option-empty', role: 'option', 'aria-disabled': 'true' }, 'No matches'),
    );
  }

  function renderStats() {
    const state = store.state;
    rerender(stats, () => [
      ...STATS.map(([key, label, count]) =>
        h('div', { class: 'stat' }, h('dt', null, label), h('dd', { testid: `count-${key}` }, count(state))),
      ),
    ]);
  }

  return {
    id: config.id,
    title: config.title,

    mount(container, ctx) {
      store = ctx.store;
      input = h('input', {
        class: 'search-input',
        type: 'search',
        placeholder: config.placeholder,
        'aria-label': config.placeholder,
        'aria-controls': `${config.id}-results`,
        autocomplete: 'off',
        spellcheck: 'false',
        enterkeyhint: 'search',
        testid: `${config.id}-search`,
        onInput: renderResults,
      });
      results = h('ul', {
        class: 'listbox search-results',
        id: `${config.id}-results`,
        role: 'listbox',
        'aria-label': 'Matches',
        testid: `${config.id}-results`,
        hidden: true,
      });
      stats = h('dl', { class: 'stats', testid: 'stats' });
      container.append(
        h(
          'header',
          { class: 'view-head' },
          h('h1', { class: 'view-title', testid: 'view-title' }, config.title),
          h('p', { class: 'view-lead' }, config.lead),
        ),
        h(
          'div',
          { class: 'search-wrap' },
          h('label', { class: 'search' }, icon('search'), input, h('kbd', { class: 'kbd search-hint' }, '/')),
          results,
        ),
        h(
          'section',
          { class: 'card empty', testid: `${config.id}-empty` },
          noteArt(),
          h('h2', { class: 'empty-title' }, config.emptyTitle),
          h('p', { class: 'empty-body' }, config.emptyBody),
          stats,
          h('p', { class: 'empty-foot' }, 'Synced with every device on your Wi-Fi · ', h('span', { testid: 'state-version' }, `v${store.state.version}`)),
        ),
      );
      renderStats();
      ctx.subscribe(() => {
        renderStats();
        container.querySelector('[data-testid="state-version"]').textContent = `v${store.state.version}`;
        if (input.value.trim()) renderResults();
      });
    },

    focusSearch() {
      input?.focus();
      input?.select();
    },
  };
}

/** Meta tags for an item row: category, staple, on list. */
export function itemMeta(item, state) {
  const category = state.categoriesById.get(item.category_id);
  return [
    state.entriesByItemId.has(item.id) && h('span', { class: 'tag tag-accent' }, 'on list'),
    item.staple && h('span', { class: 'tag tag-warm' }, 'staple'),
    h('span', { class: ['option-category', !category && 'is-uncategorized'] }, category?.name ?? 'Uncategorized'),
  ];
}

/** Meta tags for a recipe row. */
export function recipeMeta(recipe, state) {
  return [
    state.listRecipeIds.has(recipe.id) && h('span', { class: 'tag tag-accent' }, 'on list'),
    h('span', { class: 'tag' }, 'recipe'),
    h('span', { class: 'option-category' }, `${recipe.item_ids.length} items`),
  ];
}
