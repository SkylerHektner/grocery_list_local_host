// Stacked toasts (SPEC §3.11): confirmations, errors (with the server's message) and Undo.
//
//   toast('Removed Milk', { action: { label: 'Undo', onClick: () => api.undo() } });
//   toast(err.message, { variant: 'error' });
//
// Toasts live in the `[data-testid="toasts"]` live region from index.html (created if missing),
// newest at the bottom, at most MAX_VISIBLE at once. Auto-dismiss pauses while hovered/focused.
// A toast that goes away while it has keyboard focus (its Undo was pressed) hands focus back to
// where it came from, else to focusFallback() (the view's search box), never to <body>.

import { focusFallback, h } from '../dom.js';
import { icon } from '../icons.js';

const MAX_VISIBLE = 4;
const DURATION = { info: 3500, success: 3500, error: 6000 };
const ACTION_DURATION = 6000;

function region() {
  let el = document.querySelector('[data-testid="toasts"]');
  if (!el) {
    el = h('div', { class: 'toast-region', testid: 'toasts', 'aria-live': 'polite' });
    document.body.append(el);
  }
  return el;
}

/**
 * @param {string} message
 * @param {object} [options]
 * @param {'info'|'success'|'error'} [options.variant]
 * @param {{label: string, onClick: () => void}} [options.action]  e.g. Undo; clicking it also
 *   dismisses the toast
 * @param {number} [options.duration]  ms before auto-dismiss; 0 keeps it until dismissed
 * @returns {{el: HTMLElement, dismiss: () => void}}
 */
export function toast(message, { variant = 'info', action, duration } = {}) {
  const ms = duration ?? (action ? Math.max(ACTION_DURATION, DURATION[variant] ?? 0) : DURATION[variant] ?? 3500);
  let timer = null;
  let gone = false;
  let returnTo = null; // what had focus before Tab moved into the toast

  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    const hadFocus = el.contains(document.activeElement);
    el.remove();
    if (!hadFocus) return;
    if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    else focusFallback();
  }

  function arm() {
    clearTimeout(timer);
    if (ms > 0 && !gone) timer = setTimeout(dismiss, ms);
  }

  const el = h(
    'div',
    {
      class: ['toast', `toast-${variant}`],
      role: variant === 'error' ? 'alert' : 'status',
      testid: 'toast',
      'data-variant': variant,
      onMouseenter: () => clearTimeout(timer),
      onMouseleave: arm,
      onFocusin: (e) => {
        clearTimeout(timer);
        if (e.relatedTarget instanceof HTMLElement && !el.contains(e.relatedTarget)) returnTo = e.relatedTarget;
      },
      onFocusout: arm,
    },
    variant === 'error' ? icon('alert', { size: 18 }) : variant === 'success' ? icon('check', { size: 18 }) : null,
    h('span', { class: 'toast-message', testid: 'toast-message' }, message),
    action &&
      h(
        'button',
        {
          type: 'button',
          class: 'toast-action',
          testid: 'toast-action',
          onClick: () => {
            dismiss();
            action.onClick();
          },
        },
        action.label,
      ),
    h(
      'button',
      { type: 'button', class: 'toast-close', testid: 'toast-close', 'aria-label': 'Dismiss', onClick: dismiss },
      icon('close', { size: 16 }),
    ),
  );
  // Expose dismiss on the element so overflow trimming can close older toasts cleanly.
  el.dismissToast = dismiss;

  const host = region();
  host.append(el);
  while (host.children.length > MAX_VISIBLE) {
    const oldest = host.firstElementChild;
    if (oldest.dismissToast) oldest.dismissToast();
    else oldest.remove();
  }
  arm();
  return { el, dismiss };
}
