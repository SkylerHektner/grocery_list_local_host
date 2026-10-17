// Tiny DOM helpers. Text is always inserted as text nodes: never build HTML from strings.

import { segments } from './fuzzy.js';

const PROPERTIES = new Set(['value', 'checked', 'selected', 'indeterminate', 'muted']);

/**
 * Creates an element. Children may be strings/numbers (inserted as text, never parsed as HTML),
 * Nodes, arrays, or null/undefined/false (skipped).
 *
 *   h('button', { class: 'btn btn-primary', testid: 'save', onClick: save }, 'Save')
 *
 * Attributes: `class` (string or array; falsy entries dropped), `testid` (-> data-testid),
 * `dataset` and `style` objects, `onXxx` functions (-> addEventListener('xxx')), `value` /
 * `checked` / `selected` / `indeterminate` set as properties, `true` -> empty attribute,
 * `false`/null/undefined -> omitted. Everything else is setAttribute(key, String(value)).
 *
 * @param {string} tag
 * @param {Record<string, unknown> | null} [attrs]
 * @param {...unknown} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const key of Object.keys(attrs)) setAttribute(el, key, attrs[key]);
  append(el, children);
  return el;
}

function setAttribute(el, key, value) {
  if (value === undefined || value === null || value === false) return;
  if (key === 'class' || key === 'className') {
    el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
  } else if (key === 'testid') {
    el.dataset.testid = String(value);
  } else if (key === 'dataset') {
    Object.assign(el.dataset, value);
  } else if (key === 'style' && typeof value === 'object') {
    Object.assign(el.style, value);
  } else if (key.startsWith('on') && typeof value === 'function') {
    el.addEventListener(key.slice(2).toLowerCase(), value);
  } else if (PROPERTIES.has(key)) {
    el[key] = value;
  } else {
    el.setAttribute(key, value === true ? '' : String(value));
  }
}

/** Appends children (same rules as h()). */
export function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.append(child);
    else parent.append(document.createTextNode(String(child)));
  }
  return parent;
}

/** A DocumentFragment of children (same rules as h()). */
export function fragment(...children) {
  return append(document.createDocumentFragment(), children);
}

/**
 * Renders `text` with `<mark>` around the matched `ranges` (a fuzzy SearchResult's `ranges`).
 * @param {string} text
 * @param {Array<[number, number]>} ranges
 */
export function highlight(text, ranges) {
  return fragment(segments(text, ranges).map((s) => (s.match ? h('mark', null, s.text) : s.text)));
}

/**
 * True on devices with a hardware keyboard and a fine pointer. Views autofocus their search box
 * only there: on phones focusing would pop up the on-screen keyboard.
 */
export function isKeyboardDevice() {
  return !matchMedia('(hover: none)').matches;
}

/**
 * Leaves a field (Esc on an empty search box) without dropping focus on <body>: focus goes to
 * the view area (`#view-root`, tabindex=-1), so single-key shortcuts work and Tab continues
 * from there.
 */
export function parkFocus() {
  const main = document.getElementById('view-root');
  if (main) main.focus({ preventScroll: true });
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

let fallback = null;

/** main.js: where focus goes when the element holding it disappears (see focusFallback). */
export function setFocusFallback(fn) {
  fallback = fn;
}

/**
 * Focus was on something that just went away (a toast's Undo button, a dialog's opener that a
 * re-render replaced): move it to the current view's search box on keyboard devices (the view
 * area on touch screens, where focusing a field pops up the keyboard), never <body>.
 */
export function focusFallback() {
  try {
    fallback?.();
  } finally {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) parkFocus();
  }
}

/** True when focus is nowhere useful: on <body> (or nothing). */
export function focusIsLost() {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

/** True when keystrokes on `el` type text (so single-key shortcuts must not fire). */
export function isTypingTarget(el) {
  if (!(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
}

function keyOf(el) {
  return el.dataset?.key || el.id || el.dataset?.testid || null;
}

function findByKey(root, key) {
  const esc = CSS.escape(key);
  return root.querySelector(`[data-key="${esc}"], [id="${esc}"], [data-testid="${esc}"]`);
}

/**
 * Replaces `container`'s children with `build()`'s result without losing the user's place:
 * if focus was inside, the element with the same `data-key` (else id, else data-testid) in the
 * new tree gets focus back, and a text field keeps the value and selection the user had (typing
 * beats incoming state). The container's scroll position is kept.
 *
 * Use it for live-sync re-renders; give every focusable element a stable, unique `data-key`.
 * Better still, keep inputs outside the re-rendered subtree (the omnibar stays put; only its
 * results are re-rendered).
 *
 * @param {Element} container
 * @param {() => Node | Node[]} build
 */
export function rerender(container, build) {
  const active = document.activeElement;
  let key = null;
  let field = null;
  if (active && active !== container && container.contains(active)) {
    key = keyOf(active);
    if (isTypingTarget(active) && 'value' in active) {
      field = { value: active.value, start: null, end: null, dir: undefined };
      try {
        field.start = active.selectionStart;
        field.end = active.selectionEnd;
        field.dir = active.selectionDirection;
      } catch {
        // input types without selection support
      }
    }
  }
  const { scrollTop, scrollLeft } = container;
  const built = build();
  container.replaceChildren(...(Array.isArray(built) ? built : [built]).filter(Boolean));
  container.scrollTop = scrollTop;
  container.scrollLeft = scrollLeft;
  if (!key) return;
  const next = findByKey(container, key);
  if (!(next instanceof HTMLElement)) return;
  if (field && 'value' in next) next.value = field.value;
  next.focus({ preventScroll: true });
  if (field && field.start !== null && typeof next.setSelectionRange === 'function') {
    try {
      next.setSelectionRange(field.start, field.end, field.dir);
    } catch {
      // ignore
    }
  }
}
