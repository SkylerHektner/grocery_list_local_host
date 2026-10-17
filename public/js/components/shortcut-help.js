// The `?` keyboard-shortcut overlay. Content comes from shortcuts.js plus the active view's
// own `shortcuts`.

import { h } from '../dom.js';
import { groupsFor } from '../shortcuts.js';
import { openModal } from './dialog.js';

let open = null;

/** Renders key alternatives: ['/', 'Ctrl+K'] -> [/] / [Ctrl]+[K]. */
export function keyCaps(keys) {
  return keys.flatMap((combo, i) => [
    i > 0 && h('span', { class: 'kbd-sep', 'aria-hidden': 'true' }, '/'),
    ...combo.split('+').flatMap((key, j) => [
      j > 0 && h('span', { class: 'kbd-sep', 'aria-hidden': 'true' }, '+'),
      h('kbd', { class: 'kbd' }, key),
    ]),
  ]);
}

/**
 * Opens the overlay (or returns the one already open).
 * @param {{viewId: string, viewTitle: string, extra?: {keys: string[], label: string}[]}} options
 */
export function openShortcutHelp({ viewId, viewTitle, extra = [] }) {
  if (open) return open;
  const groups = groupsFor(viewId, viewTitle, extra);
  const body = h(
    'div',
    { class: 'shortcut-groups' },
    groups.map((group) =>
      h(
        'section',
        { class: 'shortcut-group', testid: 'shortcut-group' },
        h('h3', { class: 'shortcut-group-title' }, group.title),
        h(
          'dl',
          { class: 'shortcut-list' },
          group.items.map((item) =>
            h('div', { class: 'shortcut' }, h('dt', null, keyCaps(item.keys)), h('dd', null, item.label)),
          ),
        ),
      ),
    ),
  );
  const modal = openModal({
    title: 'Keyboard shortcuts',
    body,
    testid: 'shortcuts-overlay',
    closeButton: true,
    wide: true,
    onRequestClose: () => close(),
  });
  function close() {
    open = null;
    modal.close();
  }
  open = { el: modal.el, close };
  return open;
}
