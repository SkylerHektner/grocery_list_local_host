// DOM builders for the omnibar (see omnibar.js): its skeleton (input + dropdown), the dropdown's
// rows, header and footer. No state: every function takes what it renders plus the handlers.

import { h, highlight } from '../dom.js';
import { icon } from '../icons.js';
import { plural } from '../list-model.js';

/**
 * The search box (an ARIA combobox) and its dropdown (head, listbox, foot).
 * @param {{idPrefix: string, placeholder: string, label: string, onInput: Function,
 *   onKeydown: Function, onFocus: Function, onBlur: Function}} options
 */
export function omnibarShell({ idPrefix, placeholder, label, onInput, onKeydown, onFocus, onBlur }) {
  const listboxId = `${idPrefix}-listbox`;
  const input = h('input', {
    class: 'search-input',
    type: 'text',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listboxId,
    'aria-label': label,
    placeholder,
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'enter',
    testid: `${idPrefix}-search`,
    onInput,
    onKeydown,
    onFocus,
    onBlur,
  });
  const head = h('div', { class: 'omnibar-head', testid: `${idPrefix}-head` });
  const listbox = h('ul', {
    class: 'omnibar-options',
    id: listboxId,
    role: 'listbox',
    'aria-label': 'Suggestions',
    testid: `${idPrefix}-results`,
  });
  const foot = h('div', { class: 'omnibar-foot', 'aria-hidden': 'true' });
  // mousedown would move focus off the input: picking by mouse/tap keeps typing focus.
  const popup = h(
    'div',
    { class: 'omnibar-pop', testid: `${idPrefix}-popup`, hidden: true, onMousedown: (e) => e.preventDefault() },
    head,
    listbox,
    foot,
  );
  const el = h(
    'div',
    { class: 'omnibar', testid: `${idPrefix}-omnibar` },
    h('label', { class: 'search' }, icon('search'), input, h('kbd', { class: 'kbd search-hint', 'aria-hidden': 'true' }, '/')),
    popup,
  );
  return { el, input, head, listbox, foot, popup };
}

/**
 * Scrolls `option` into view inside the dropdown only, clear of the sticky head and foot
 * (scrollIntoView could scroll the page while the user types).
 */
export function scrollIntoPopup(popup, option, head, foot) {
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < popup.scrollTop + head.offsetHeight) popup.scrollTop = Math.max(0, top - head.offsetHeight);
  else if (bottom > popup.scrollTop + popup.clientHeight - foot.offsetHeight) {
    popup.scrollTop = bottom - popup.clientHeight + foot.offsetHeight;
  }
}

/**
 * Common attributes of an option row.
 * @param {string} id        DOM id (for aria-activedescendant)
 * @param {object} option    {key, kind}
 * @param {string} testid
 * @param {{pick: Function, hover: Function}} on
 * @param {string[]} [classes]
 */
function optionAttrs(id, option, testid, on, classes = []) {
  return {
    class: ['option', ...classes],
    role: 'option',
    id,
    'aria-selected': 'false',
    testid,
    dataset: { option: option.key, kind: option.kind },
    onClick: () => on.pick(option),
    onPointermove: () => on.hover(option.key),
  };
}

/**
 * A search-mode row: an item, a recipe, or a create row.
 * @param {string} id
 * @param {import('../omnibar-model.js').SearchOption} option
 * @param {object} state   derived store state
 * @param {{itemBadge: Function, recipeBadge: Function, pick: Function, hover: Function}} on
 */
export function searchRow(id, option, state, on) {
  switch (option.kind) {
    case 'item': {
      const item = option.value;
      const { alias, text, ranges } = option.match;
      const category = state.categoriesById.get(item.category_id);
      const badge = on.itemBadge(item, state);
      return h(
        'li',
        optionAttrs(id, option, 'omnibar-option', on),
        h(
          'span',
          { class: 'option-label' },
          alias ? item.name : highlight(text, ranges),
          alias && h('span', { class: 'option-alias' }, highlight(alias, ranges)),
        ),
        h(
          'span',
          { class: 'option-meta' },
          badge && h('span', { class: 'tag tag-accent', testid: 'option-badge' }, badge),
          h('span', { class: ['option-category', !category && 'is-uncategorized'] }, category?.name ?? 'Uncategorized'),
        ),
      );
    }
    case 'recipe': {
      const recipe = option.value;
      const badge = on.recipeBadge(recipe, state);
      return h(
        'li',
        optionAttrs(id, option, 'omnibar-option', on, ['option-recipe']),
        h('span', { class: 'option-label' }, icon('book', { size: 16 }), highlight(option.match.text, option.match.ranges)),
        h(
          'span',
          { class: 'option-meta' },
          badge && h('span', { class: 'tag tag-accent', testid: 'option-badge' }, badge),
          h('span', { class: 'tag tag-warm' }, 'Recipe'),
          h('span', { class: 'option-category' }, plural(recipe.item_ids.length, 'item')),
        ),
      );
    }
    case 'create-item':
      return h(
        'li',
        optionAttrs(id, option, 'omnibar-create-item', on, ['option-create']),
        h('span', { class: 'option-label' }, icon('plus', { size: 16 }), 'Create item ', h('q', null, option.name)),
        h('span', { class: 'option-meta option-keys' }, h('kbd', { class: 'kbd' }, 'Shift+Enter')),
      );
    case 'create-recipe':
      return h(
        'li',
        optionAttrs(id, option, 'omnibar-create-recipe', on, ['option-create']),
        h('span', { class: 'option-label' }, icon('book', { size: 16 }), 'Create recipe ', h('q', null, option.name)),
      );
    default:
      return null;
  }
}

/**
 * A category-picker row: numbered category, or Uncategorized (0).
 * @param {string} id
 * @param {import('../omnibar-model.js').CategoryOption} option
 * @param {{pick: Function, hover: Function}} on
 */
export function categoryRow(id, option, on) {
  const none = option.kind === 'uncategorized';
  return h(
    'li',
    {
      ...optionAttrs(id, option, 'category-option', on, [none && 'option-uncategorized']),
      'data-number': option.number ?? '',
    },
    h('span', { class: 'option-num', 'aria-hidden': option.number === null ? 'true' : null }, option.number ?? ''),
    h(
      'span',
      { class: 'option-label' },
      none ? 'Uncategorized' : highlight(option.category.name, option.ranges),
    ),
    none && h('span', { class: 'option-meta option-keys' }, h('kbd', { class: 'kbd' }, 'Tab')),
  );
}

/** The parsed inline note ("eggs, 2 dozen"), shown above the results. */
export function noteBanner(note) {
  return h(
    'div',
    { class: 'omnibar-note', testid: 'omnibar-note' },
    icon('pencil', { size: 14 }),
    h('span', null, 'Note ', h('q', { testid: 'omnibar-note-text' }, note)),
  );
}

/** "New item "Candles" → choose a category" (+ the note), with a Back button for touch. */
export function pickerTitle(name, note, onBack) {
  return [
    h(
      'div',
      { class: 'omnibar-picker-title', testid: 'omnibar-picker-title' },
      h('span', null, 'New item ', h('q', { testid: 'omnibar-picker-name' }, name), ' → choose a category'),
      note && h('span', { class: 'omnibar-picker-note' }, 'Note ', h('q', null, note)),
    ),
    h(
      'button',
      { type: 'button', class: 'btn btn-ghost btn-sm omnibar-back', testid: 'omnibar-picker-back', onClick: onBack },
      'Back',
    ),
  ];
}

const hint = (key, label) => h('span', { class: 'omnibar-hint' }, h('kbd', { class: 'kbd' }, key), label);

/** Keyboard hints at the foot of the dropdown (hidden on touch screens by CSS). */
export function footHints(mode) {
  return mode === 'picker'
    ? [hint('1–9', 'pick'), hint('0', 'uncategorized'), hint('Enter', 'highlighted'), hint('Esc', 'back')]
    : [hint('↑↓', 'move'), hint('Enter', 'add'), hint('Shift+Enter', 'new item'), hint(',', 'note'), hint('Esc', 'clear')];
}
