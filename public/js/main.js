// App shell: hash routing, global shortcuts, live sync, error toasts (SPEC §3.10, §3.11).
//
// ── View contract (T5-T7 follow this) ─────────────────────────────────────────────────────────
// Each module in js/views/ default-exports one object:
//   {
//     id: 'list',                  route id (#/list) — must match router.js VIEWS
//     title: 'List',               used for the document title and the ? overlay
//     mount(container, ctx),       render into `container`, an empty <section data-testid=
//                                  "view-<id>">. Called on every navigation to the view;
//                                  ctx.store.state is already loaded. Reset module state here.
//     unmount?(),                  extra teardown (ctx.subscribe/listen/onCleanup are automatic)
//     focusSearch?(),              focus the view's primary search box (`/` and Ctrl+K)
//     onParams?(params),           the hash changed within the view (#/recipes/12); without
//                                  it the view is remounted
//     shortcuts?,                  [{keys: ['n'], label: 'New recipe'}] (or a function returning
//                                  that) — extra rows for the ? overlay; SPEC shortcuts are
//                                  already listed in shortcuts.js
//   }
// ctx = {
//   store, api,                    store.js / api.js singletons (api mutations update the store)
//   params,                        extra hash segments, e.g. ['12'] for #/recipes/12
//   from,                          id of the view shown before this one (null on page load)
//   toast, confirm,                components/toast.js, components/dialog.js
//   navigate(viewId, ...params),   sets the hash
//   subscribe(fn),                 store.subscribe, removed automatically on unmount
//   listen(target, type, fn, opt), addEventListener, removed automatically on unmount
//   onCleanup(fn),                 run on unmount
// }
// The section is a centered 720 px column; add the class `view-wide` to it for the full page
// width (the List view does, for its tile grid).
// Live-sync re-renders must not clobber typing: keep inputs outside re-rendered subtrees and/or
// use rerender() from dom.js. Keyboard: views handle keys on their own elements and call
// preventDefault() on keys they consume; the global handler below then ignores the event.
// Single-key global shortcuts (/ and ?) never fire while a text field has focus.

import { api } from './api.js';
import { bindLiveSync, createLiveSync, store } from './store.js';
import { DEFAULT_VIEW, VIEWS, hashFor, parseHash } from './router.js';
import { h, isKeyboardDevice, isTypingTarget, parkFocus, setFocusFallback } from './dom.js';
import { trackVisualViewport } from './viewport.js';
import { bindThemeToggle } from './theme.js';
import { toast } from './components/toast.js';
import { confirm, isModalOpen } from './components/dialog.js';
import { openShortcutHelp } from './components/shortcut-help.js';
import listView from './views/list.js';
import recipesView from './views/recipes.js';
import itemsView from './views/items.js';
import categoriesView from './views/categories.js';

const VIEW_MODULES = { list: listView, recipes: recipesView, items: itemsView, categories: categoriesView };
const APP_NAME = 'Grocery list';
// [label, extra words hidden on phones]
const SYNC_LABELS = { connecting: ['Connecting…', ''], live: ['Live', ''], offline: ['Offline', ' — reconnecting'] };

const viewRoot = document.getElementById('view-root');
const syncStatus = document.querySelector('[data-testid="sync-status"]');

/** @type {{id: string, view: object, params: string[], cleanups: Function[]} | null} */
let current = null;

function navigate(viewId, ...params) {
  location.hash = hashFor(viewId, ...params);
}

function titleOf(id) {
  return VIEWS.find((v) => v.id === id)?.title ?? APP_NAME;
}

function unmountCurrent() {
  if (!current) return;
  const { view, cleanups } = current;
  current = null;
  for (const fn of cleanups.splice(0).reverse()) fn();
  view.unmount?.();
}

function mount(id, params) {
  const hadFocus = viewRoot.contains(document.activeElement);
  const from = current?.id ?? null;
  unmountCurrent();
  const view = VIEW_MODULES[id];
  const section = h('section', { class: 'view', testid: `view-${id}`, 'aria-label': view.title });
  viewRoot.replaceChildren(section);
  const cleanups = [];
  const ctx = {
    store,
    api,
    params,
    from,
    toast,
    confirm,
    navigate,
    subscribe(fn) {
      const off = store.subscribe(fn);
      cleanups.push(off);
      return off;
    },
    listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      cleanups.push(() => target.removeEventListener(type, fn, options));
    },
    onCleanup(fn) {
      cleanups.push(fn);
    },
  };
  current = { id, view, params, cleanups };
  view.mount(section, ctx);
  // Focus was in the old view (now gone): park it on the new view for keyboard/screen readers.
  if (hadFocus && !viewRoot.contains(document.activeElement)) viewRoot.focus({ preventScroll: true });
}

function sameParams(a, b) {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

function route() {
  const { view: id, params, known } = parseHash(location.hash);
  if (!known) history.replaceState(null, '', hashFor(DEFAULT_VIEW));
  for (const tab of document.querySelectorAll('[data-view]')) {
    if (tab.dataset.view === id) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  document.title = id === DEFAULT_VIEW ? APP_NAME : `${titleOf(id)} · ${APP_NAME}`;
  if (!store.state) {
    renderWaiting();
    return;
  }
  if (current?.id === id) {
    if (sameParams(current.params, params)) return;
    if (current.view.onParams) {
      current.params = params;
      current.view.onParams(params);
      return;
    }
  }
  mount(id, params);
}

/** Before the first snapshot: a loading line, or the offline message. */
function renderWaiting() {
  const offline = syncStatus.dataset.state === 'offline';
  viewRoot.replaceChildren(
    h(
      'div',
      { class: ['app-waiting', offline && 'is-offline'], testid: offline ? 'app-offline' : 'app-loading' },
      offline ? "Can't reach the server. Retrying…" : 'Loading…',
    ),
  );
}

function setSyncStatus(status) {
  const [label, more] = SYNC_LABELS[status] ?? [status, ''];
  syncStatus.dataset.state = status;
  syncStatus.querySelector('.sync-label').replaceChildren(label, more ? h('span', { class: 'sync-more' }, more) : '');
  syncStatus.title =
    status === 'live'
      ? 'Up to date: changes from other devices appear within seconds'
      : status === 'offline'
        ? "Can't reach the server. Reconnecting automatically; changes can't be saved until then."
        : 'Connecting to the server…';
  if (!store.state) renderWaiting();
}

function focusSearch() {
  current?.view.focusSearch?.();
}

// Focus lost with the element that had it (a toast's Undo, a dialog's re-rendered opener): the
// search box on keyboard devices; on touch screens the view area (no on-screen keyboard pop-up).
setFocusFallback(() => {
  if (isKeyboardDevice() && current) focusSearch();
  else parkFocus();
});

function showShortcuts() {
  const view = current?.view;
  const extra = typeof view?.shortcuts === 'function' ? view.shortcuts() : view?.shortcuts;
  const id = current?.id ?? parseHash(location.hash).view;
  openShortcutHelp({ viewId: id, viewTitle: titleOf(id), extra: extra ?? [] });
}

function onKeydown(e) {
  if (e.defaultPrevented || e.isComposing || isModalOpen()) return;
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const match = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
    if (match) {
      e.preventDefault();
      navigate(VIEWS[Number(match[1]) - 1].id);
      return;
    }
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    focusSearch();
    return;
  }
  if (!plain || isTypingTarget(e.target)) return;
  if (e.key === '/') {
    e.preventDefault();
    focusSearch();
  } else if (e.key === '?') {
    e.preventDefault();
    showShortcuts();
  }
}

const sync = createLiveSync({
  store,
  getVersion: api.getVersion,
  getState: api.getState,
  isVisible: () => document.visibilityState === 'visible',
  onStatus: setSyncStatus,
});

api.onError((err) => {
  toast(err.message, { variant: 'error' });
  // 404/409 usually mean this device is behind ("not on the list"): catch up right away.
  if (err.status === 404 || err.status === 409) sync.checkNow();
});

store.subscribe((state, prev) => {
  if (!prev) route();
});

document.addEventListener('keydown', onKeydown);
document.querySelector('[data-testid="shortcuts-button"]').addEventListener('click', showShortcuts);
bindThemeToggle(document.querySelector('[data-testid="theme-toggle"]'));
window.addEventListener('hashchange', route);
bindLiveSync(sync, window);
trackVisualViewport(window);
setSyncStatus('connecting');
route();
sync.start();
