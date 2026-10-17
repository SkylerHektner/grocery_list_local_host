// A modal "pick one" list with a filter box: the Items view's category picker (`c`, new items)
// and merge-target picker. Keys: typing filters, ↑/↓ move the highlight (clamped), Enter picks
// it, digits pick a numbered option while the filter is empty (like the omnibar's category
// picker), Esc cancels. Mouse/tap picks too. Keyboard devices focus the filter; touch screens
// don't (no on-screen keyboard covering the rows); the panel is a bottom sheet on narrow screens.
//
//   const choice = await openPicker({
//     title: 'Category for Milk', placeholder: 'Filter categories…', digits: true,
//     options: (filter) => [{ key: 'cat-1', value: 1, number: 1, label: 'Produce' }, …],
//   });   // -> {value} or null when cancelled (value may itself be null, e.g. Uncategorized)

import { h, isKeyboardDevice } from '../dom.js';
import { icon } from '../icons.js';
import { moveIndex } from '../omnibar-model.js';
import { openModal } from './dialog.js';

/**
 * @typedef {object} PickOption
 * @property {string} key                 stable id
 * @property {unknown} value              what the promise resolves with
 * @property {number|null} [number]       digit shortcut (shown as a keycap); undefined = no column
 * @property {Node|string} label
 * @property {Node|string|null} [meta]    right-aligned extra (category, "current", …)
 * @property {string} [testid]            default `${testid}-option`
 * @property {string} [className]
 */

/**
 * @param {object} options
 * @param {string} options.title
 * @param {Node|string} [options.lead]       line under the title
 * @param {string} [options.placeholder]
 * @param {string} [options.testid]          panel; the filter is `-input`, the empty row `-empty`
 * @param {(filter: string) => PickOption[]} options.options
 * @param {boolean|string} [options.digits]  0-9 pick the option with that `number`; a string
 *   names option 0 in the key hints (e.g. 'uncategorized')
 * @param {string|null} [options.initialKey] highlighted first (else the first option)
 * @param {string} [options.emptyText]
 * @returns {Promise<{value: unknown} | null>}
 */
export function openPicker({
  title,
  lead,
  placeholder = 'Filter…',
  testid = 'pick-dialog',
  options,
  digits = false,
  initialKey = null,
  emptyText = 'No matches',
}) {
  return new Promise((resolve) => {
    let modal = null;
    let opts = [];
    let activeKey = initialKey;
    const listId = `${testid}-listbox`;
    const optionId = (key) => `${testid}-opt-${key}`;

    const input = h('input', {
      class: 'search-input',
      type: 'text',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'true',
      'aria-controls': listId,
      'aria-label': placeholder,
      placeholder,
      autocomplete: 'off',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
      testid: `${testid}-input`,
      onInput: () => refresh(true),
    });
    const listbox = h('ul', { class: 'listbox pick-list', id: listId, role: 'listbox', 'aria-label': title, testid: `${testid}-options` });

    const done = (result) => {
      modal?.close();
      resolve(result);
    };

    function refresh(reset) {
      opts = options(input.value);
      let index = reset ? -1 : opts.findIndex((o) => o.key === activeKey);
      if (index < 0) index = opts.length ? 0 : -1;
      activeKey = index >= 0 ? opts[index].key : null;
      render();
    }

    function row(o) {
      return h(
        'li',
        {
          class: ['option', o.className],
          role: 'option',
          id: optionId(o.key),
          'aria-selected': 'false',
          testid: o.testid ?? `${testid}-option`,
          'data-number': o.number ?? '',
          dataset: { option: o.key },
          onClick: () => done({ value: o.value }),
          onPointermove: () => {
            if (activeKey === o.key) return;
            activeKey = o.key;
            paint(false);
          },
        },
        o.number !== undefined &&
          h('span', { class: 'option-num', 'aria-hidden': o.number === null ? 'true' : null }, o.number ?? ''),
        h('span', { class: 'option-label' }, o.label),
        o.meta && h('span', { class: 'option-meta' }, o.meta),
      );
    }

    function render() {
      listbox.replaceChildren(
        ...(opts.length
          ? opts.map(row)
          : [h('li', { class: 'option option-empty', role: 'option', 'aria-disabled': 'true', testid: `${testid}-empty` }, emptyText)]),
      );
      paint(true);
    }

    function paint(scroll) {
      let active = null;
      for (const li of listbox.children) {
        const on = li.dataset.option !== undefined && li.dataset.option === activeKey;
        li.setAttribute('aria-selected', String(on));
        if (on) active = li;
      }
      if (active) input.setAttribute('aria-activedescendant', active.id);
      else input.removeAttribute('aria-activedescendant');
      if (scroll) active?.scrollIntoView({ block: 'nearest' });
    }

    function move(delta) {
      const index = moveIndex(opts.findIndex((o) => o.key === activeKey), delta, opts.length);
      activeKey = index >= 0 ? opts[index].key : null;
      paint(true);
    }

    function pickActive() {
      const option = opts.find((o) => o.key === activeKey);
      if (option) done({ value: option.value });
    }

    function onKeydown(e) {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (digits && !e.shiftKey && /^[0-9]$/.test(e.key) && input.value === '') {
        const option = opts.find((o) => o.number === Number(e.key));
        e.preventDefault();
        if (option) done({ value: option.value });
      }
    }

    refresh(false);
    const kbd = (key) => h('kbd', { class: 'kbd' }, key);
    modal = openModal({
      title,
      body: [
        lead && h('p', { class: 'pick-lead', testid: `${testid}-lead` }, lead),
        h('label', { class: 'search pick-search' }, icon('search', { size: 18 }), input),
        listbox,
        h(
          'p',
          { class: 'pick-keys only-keys', 'aria-hidden': 'true' },
          kbd('↑↓'),
          ' move ',
          kbd('Enter'),
          ' pick ',
          digits && [kbd('1–9'), ' by number ', kbd('0'), ` ${digits === true ? 'none' : digits} `],
          kbd('Esc'),
          ' cancel',
        ),
      ],
      actions: [h('button', { type: 'button', class: 'btn btn-ghost', testid: `${testid}-cancel`, onClick: () => done(null) }, 'Cancel')],
      testid,
      className: 'pick-modal',
      onRequestClose: () => done(null),
      onEnter: pickActive,
      initialFocus: () => (isKeyboardDevice() ? input : input.closest('.modal')),
    });
    modal.el.addEventListener('keydown', onKeydown);
    paint(true);
  });
}
