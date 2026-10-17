// Modal dialogs: a generic openModal() and a promise-based confirm(). Modals stack; the topmost
// owns the keyboard (Esc closes, Tab is trapped inside, Enter runs `onEnter` unless a button,
// link or textarea has focus; a held-down, repeating Enter never confirms). While any modal is
// open the app shell (#shell) is inert and the page doesn't scroll. On narrow screens CSS turns
// the panel into a bottom sheet that sits above the on-screen keyboard (viewport.js). Closing
// returns focus to the opener, or to focusFallback() (dom.js) when the opener is gone.
//
//   if (await confirm({ title: 'Clear the list?', confirmLabel: 'Clear', danger: true })) …

import { focusFallback, h } from '../dom.js';
import { icon } from '../icons.js';

/** @type {{layer: HTMLElement, panel: HTMLElement, onEnter?: () => void, requestClose: () => void}[]} */
const stack = [];
let listening = false;
let seq = 0;

/** True while any modal is open (global shortcuts are suspended then). */
export function isModalOpen() {
  return stack.length > 0;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

/** The element now standing in for a removed `el` (same data-key), if any. */
function twinOf(el) {
  const key = el instanceof HTMLElement ? el.dataset.key : null;
  return key ? document.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
}

function onKeydown(e) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    top.requestClose();
  } else if (e.key === 'Tab') {
    const els = focusables(top.panel);
    if (!els.length) {
      e.preventDefault();
      top.panel.focus();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    const inside = top.panel.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  } else if (e.key === 'Enter' && top.onEnter && !e.isComposing && !e.repeat && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
    const t = e.target;
    if (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement || t instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    top.onEnter();
  }
}

function sync() {
  const open = stack.length > 0;
  document.getElementById('shell')?.toggleAttribute('inert', open);
  document.documentElement.classList.toggle('has-modal', open);
  stack.forEach((m, i) => m.layer.toggleAttribute('inert', i < stack.length - 1));
  if (open && !listening) document.addEventListener('keydown', onKeydown, true);
  if (!open && listening) document.removeEventListener('keydown', onKeydown, true);
  listening = open;
}

/**
 * Opens a modal panel.
 * @param {object} options
 * @param {string} options.title
 * @param {Node|Node[]} [options.body]
 * @param {Node[]} [options.actions]     buttons for the footer
 * @param {string} [options.testid]      on the panel; the layer gets `${testid}-layer` and the
 *   optional close button `${testid}-close`
 * @param {boolean} [options.closeButton]  show an × in the header
 * @param {boolean} [options.wide]
 * @param {string} [options.className]  extra class on the panel (e.g. a full-screen sheet)
 * @param {() => void} [options.onRequestClose]  Esc, backdrop click or ×; default: close()
 * @param {() => void} [options.onEnter]
 * @param {() => HTMLElement | null} [options.initialFocus]  default: first focusable, else panel
 * @returns {{el: HTMLElement, close: () => void}}
 */
export function openModal({
  title,
  body,
  actions,
  testid = 'modal',
  closeButton = false,
  wide = false,
  className,
  onRequestClose,
  onEnter,
  initialFocus,
}) {
  const titleId = `modal-title-${++seq}`;
  const opener = document.activeElement;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    layer.remove();
    sync();
    // Back to the opener, or its replacement when a live-sync re-render rebuilt it (same
    // data-key, see rerender() in dom.js); else the dialog underneath, else the search box.
    const target = opener?.isConnected ? opener : twinOf(opener);
    if (target instanceof HTMLElement && target !== document.body) target.focus({ preventScroll: true });
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const below = stack[stack.length - 1];
    if (below) (focusables(below.panel)[0] ?? below.panel).focus({ preventScroll: true });
    else focusFallback();
  }

  const requestClose = () => (onRequestClose ? onRequestClose() : close());
  const panel = h(
    'div',
    {
      class: ['modal', wide && 'modal-wide', className],
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: '-1',
      testid,
    },
    h(
      'div',
      { class: 'modal-head' },
      h('h2', { class: 'modal-title', id: titleId }, title),
      closeButton &&
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost btn-icon modal-close',
            'aria-label': 'Close',
            testid: `${testid}-close`,
            onClick: requestClose,
          },
          icon('close'),
        ),
    ),
    body && h('div', { class: 'modal-body' }, body),
    actions && h('div', { class: 'modal-actions' }, actions),
  );
  const layer = h(
    'div',
    { class: 'modal-layer', testid: `${testid}-layer` },
    h('div', { class: 'modal-backdrop', onClick: requestClose }),
    panel,
  );
  const entry = { layer, panel, onEnter, requestClose };
  stack.push(entry);
  document.body.append(layer);
  sync();
  (initialFocus?.() ?? focusables(panel)[0] ?? panel).focus();
  return { el: panel, close };
}

/**
 * Asks a yes/no question. Enter confirms, Esc / backdrop / Cancel cancel.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @param {boolean} [options.danger]   red confirm button (deletes, clearing the list)
 * @param {string} [options.testid]    default 'confirm-dialog'; buttons get `-confirm`/`-cancel`
 * @returns {Promise<boolean>}
 */
export function confirm({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  testid = 'confirm-dialog',
}) {
  return new Promise((resolve) => {
    let modal = null;
    const done = (value) => {
      modal?.close();
      resolve(value);
    };
    const ok = h(
      'button',
      {
        type: 'button',
        class: ['btn', danger ? 'btn-danger' : 'btn-primary'],
        testid: `${testid}-confirm`,
        onClick: () => done(true),
      },
      confirmLabel,
    );
    const cancel = h(
      'button',
      { type: 'button', class: 'btn btn-ghost', testid: `${testid}-cancel`, onClick: () => done(false) },
      cancelLabel,
    );
    modal = openModal({
      title,
      body: message ? h('p', { class: 'modal-message', testid: `${testid}-message` }, message) : null,
      actions: [cancel, ok],
      testid,
      onRequestClose: () => done(false),
      onEnter: () => done(true),
      initialFocus: () => ok,
    });
  });
}
