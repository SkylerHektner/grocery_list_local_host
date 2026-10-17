// JSON API client (docs/API.md). Every mutation resolves to `{state, id}` and pushes `state`
// into the store first, so callers never refetch. Failures reject with an ApiError carrying the
// server's message; mutation failures are also reported to `onError` listeners (the shell shows
// them as error toasts), so callers only `catch` to restore their own UI:
//
//   try { await api.addToList(item.id, note); input.value = ''; } catch { /* toast shown */ }
//
// `api.quiet.*` has the same mutations without the error report, for flows that show the error
// inline instead. Bodies are strict on the server (unknown fields are 400s): helpers send only
// the documented fields, so passing a whole item to updateItem() is fine.

import { store } from './store.js';

export class ApiError extends Error {
  /**
   * @param {string} message  the server's `error` text when it sent one (show it as-is)
   * @param {number} status   HTTP status; 0 when the server could not be reached
   * @param {{method?: string, path?: string}} [request]
   */
  constructor(message, status, { method, path } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

const enc = encodeURIComponent;

/** Copies only the given keys whose value is not undefined. */
function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
}

/** The mutation endpoints, built on a `mutate(method, path, body?)` function. */
function endpoints(mutate) {
  return {
    // Categories
    createCategory: (name) => mutate('POST', '/api/categories', { name }),
    renameCategory: (id, name) => mutate('PUT', `/api/categories/${enc(id)}`, { name }),
    deleteCategory: (id) => mutate('DELETE', `/api/categories/${enc(id)}`),
    reorderCategories: (ids) => mutate('PUT', '/api/categories/order', { ids }),
    // Items
    /** @param {{name: string, category_id?: number|null, aliases?: string[], staple?: boolean}} item */
    createItem: (item) =>
      mutate('POST', '/api/items', pick(item, ['name', 'category_id', 'aliases', 'staple'])),
    /** Full replace: name, category_id, aliases and staple are all required. */
    updateItem: (id, item) =>
      mutate('PUT', `/api/items/${enc(id)}`, pick(item, ['name', 'category_id', 'aliases', 'staple'])),
    deleteItem: (id) => mutate('DELETE', `/api/items/${enc(id)}`),
    mergeItem: (id, intoId) => mutate('POST', `/api/items/${enc(id)}/merge`, { into_id: intoId }),
    // Recipes
    /** @param {{name: string, item_ids?: number[]}} recipe */
    createRecipe: (recipe) => mutate('POST', '/api/recipes', pick(recipe, ['name', 'item_ids'])),
    /** Full replace: name and item_ids are both required. */
    updateRecipe: (id, recipe) =>
      mutate('PUT', `/api/recipes/${enc(id)}`, pick(recipe, ['name', 'item_ids'])),
    deleteRecipe: (id) => mutate('DELETE', `/api/recipes/${enc(id)}`),
    // List
    /** Adds (or re-adds) with a manual source; a blank/absent note keeps the existing one. */
    addToList: (itemId, note) =>
      mutate('POST', '/api/list/items', note == null ? { item_id: itemId } : { item_id: itemId, note }),
    /** `null` or '' clears the note. */
    setNote: (itemId, note) => mutate('PUT', `/api/list/items/${enc(itemId)}`, { note: note ?? null }),
    removeFromList: (itemId) => mutate('DELETE', `/api/list/items/${enc(itemId)}`),
    /** `itemIds`: the culled subset of the recipe's ingredients (may be empty). */
    addRecipeToList: (recipeId, itemIds) =>
      mutate('POST', '/api/list/recipes', { recipe_id: recipeId, item_ids: itemIds }),
    removeRecipeFromList: (recipeId) => mutate('DELETE', `/api/list/recipes/${enc(recipeId)}`),
    clearList: () => mutate('DELETE', '/api/list'),
    undo: () => mutate('POST', '/api/list/undo'),
  };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {(state: object) => void} [options.onState]  receives every mutation's new state
 */
export function createApi({ fetch: fetchImpl = (...args) => globalThis.fetch(...args), onState } = {}) {
  const errorListeners = new Set();

  async function request(method, path, body, { text = false } = {}) {
    const init = { method, headers: { Accept: text ? 'text/plain' : 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchImpl(path, init);
    } catch {
      throw new ApiError("Can't reach the server. Check the connection and try again.", 0, {
        method,
        path,
      });
    }
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status, { method, path });
    if (text) return res.text();
    try {
      return await res.json();
    } catch {
      throw new ApiError(`Unexpected response from the server (${method} ${path})`, res.status, {
        method,
        path,
      });
    }
  }

  function mutator(report) {
    return async (method, path, body) => {
      try {
        const result = await request(method, path, body);
        if (result && result.state) onState?.(result.state);
        return result;
      } catch (err) {
        if (report) for (const fn of [...errorListeners]) fn(err);
        throw err;
      }
    };
  }

  return {
    /** Low-level: any request; resolves to parsed JSON (or text with `{text: true}`). */
    request,
    health: () => request('GET', '/api/health'),
    /** @returns {Promise<object>} the Snapshot */
    getState: () => request('GET', '/api/state'),
    /** @returns {Promise<{version: number}>} */
    getVersion: () => request('GET', '/api/version'),
    /** @returns {Promise<string>} the plain-text export */
    exportText: () => request('GET', '/api/list/export', undefined, { text: true }),
    /**
     * Registers a listener for failed mutations (not reads, not `quiet`).
     * @param {(err: ApiError) => void} fn
     * @returns {() => void} unsubscribe
     */
    onError(fn) {
      errorListeners.add(fn);
      return () => errorListeners.delete(fn);
    },
    ...endpoints(mutator(true)),
    quiet: endpoints(mutator(false)),
  };
}

async function errorMessage(res) {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // not JSON: fall through
  }
  return `Request failed (${res.status}${res.statusText ? ` ${res.statusText}` : ''})`;
}

/** The app-wide client: mutation results go straight into the store. */
export const api = createApi({ onState: (state) => store.set(state) });
