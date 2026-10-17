// Export preview (SPEC §3.6): the exact text `GET /api/list/export` returns, refetched whenever
// the state version changes. Copy uses the cached text when it matches the current version, so
// the clipboard write happens inside the click/keypress (required by Safari's fallback).

import { h } from '../dom.js';
import { icon } from '../icons.js';

/**
 * @param {{store: object, api: object}} deps
 */
export function createExportPanel({ store, api }) {
  let cache = { version: null, text: '' };
  let inFlight = false;
  let again = false;
  let expanded = false;
  let destroyed = false;

  const pre = h('pre', { class: 'export-text', testid: 'export-preview' });
  const empty = h('p', { class: 'export-empty muted', testid: 'export-empty' }, 'Nothing to copy yet. Added items show up here exactly as they will paste.');
  const body = h(
    'div',
    { class: 'export-body', id: 'export-body' },
    pre,
    empty,
    h('p', { class: 'export-hint only-keys' }, h('kbd', { class: 'kbd' }, 'Ctrl+Shift+C'), ' copies it from anywhere'),
  );
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-ghost btn-sm export-toggle',
      'aria-expanded': 'false',
      'aria-controls': 'export-body',
      testid: 'export-toggle',
      onClick: () => setExpanded(!expanded),
    },
    h('span', { class: 'export-toggle-label' }, 'Show'),
  );
  const el = h(
    'aside',
    { class: 'card export-panel', testid: 'export-panel', 'aria-labelledby': 'export-title' },
    h(
      'div',
      { class: 'export-head' },
      icon('copy', { size: 16 }),
      h('h2', { class: 'export-title', id: 'export-title' }, 'Paste preview'),
      toggle,
    ),
    body,
  );

  function setExpanded(value) {
    expanded = value;
    el.classList.toggle('is-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.firstChild.textContent = expanded ? 'Hide' : 'Show';
  }

  function paint() {
    pre.textContent = cache.text;
    pre.hidden = !cache.text;
    empty.hidden = Boolean(cache.text);
    el.classList.toggle('is-stale', cache.version !== store.version);
  }

  /** Fetches the export if the store moved on; one request at a time, latest wins. */
  async function update() {
    if (destroyed || cache.version === store.version) {
      paint();
      return;
    }
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const version = store.version;
    try {
      const text = await api.exportText();
      if (!destroyed) cache = { version, text };
    } catch {
      // Offline: keep showing the last text (marked stale); the next version change retries.
    } finally {
      inFlight = false;
    }
    if (destroyed) return;
    paint();
    // The store changed while fetching: fetch again (only then, so offline doesn't spin).
    if (again) {
      again = false;
      if (cache.version !== store.version) update();
    }
  }

  setExpanded(false);
  paint();
  update();

  return {
    el,
    update,
    /** The export text if it is current, else null (fetch it first). */
    current() {
      return cache.version === store.version ? cache.text : null;
    },
    destroy() {
      destroyed = true;
    },
  };
}
