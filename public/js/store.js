// Client state and live sync (SPEC §3.10). DOM-free: timers, visibility and fetching are
// injected, so everything here runs under `node --test`. The browser wiring is in main.js.
//
//   store.state              latest derived state (null until the first snapshot), see derive()
//   store.subscribe(fn)      fn(state, prev) after every accepted snapshot; returns unsubscribe
//   store.set(snapshot)      accept a snapshot if it is newer (api.js does this on every mutation)
//
// Views never fetch state themselves: they render from `store.state` and re-render from
// `subscribe`. Keep in-progress typing safe across re-renders with `rerender()` from dom.js.

/**
 * Builds the derived, read-only client state from an API Snapshot.
 * @param {object} snapshot  `{version, categories, items, recipes, list}` (docs/API.md)
 */
export function derive(snapshot) {
  const categories = snapshot.categories ?? [];
  const items = snapshot.items ?? [];
  const recipes = snapshot.recipes ?? [];
  const list = snapshot.list ?? { entries: [], recipe_ids: [] };
  const entries = list.entries ?? [];

  const categoriesById = new Map();
  const categoryIndex = new Map();
  categories.forEach((c, i) => {
    categoriesById.set(c.id, c);
    categoryIndex.set(c.id, i);
  });
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const entriesByItemId = new Map(entries.map((e) => [e.item_id, e]));

  return Object.freeze({
    version: snapshot.version,
    snapshot,
    categories,
    items,
    recipes,
    list,
    /** @type {Map<number, object>} */ itemsById,
    /** @type {Map<number, object>} */ categoriesById,
    /** category id -> position in the store walk (0-based) */ categoryIndex,
    /** @type {Map<number, object>} */ recipesById,
    /** item id -> list entry */ entriesByItemId,
    /** recipe ids whose chips are on the list */ listRecipeIds: new Set(list.recipe_ids ?? []),
  });
}

/**
 * Walk position of a category id for sorting; Uncategorized (null/unknown) sorts last.
 * @param {ReturnType<typeof derive>} state
 * @param {number|null} categoryId
 */
export function walkIndex(state, categoryId) {
  return state.categoryIndex.get(categoryId) ?? state.categories.length;
}

/**
 * Decides whether a snapshot with version `incoming` replaces the one held (`current`).
 * Newer always wins; equal is a no-op. Older is accepted only from a read whose request was sent
 * while we already held `current` (`baseline === current`): then nothing newer can have arrived
 * since, so the server really went back (data restored or reset). Mutation responses pass no
 * baseline, so a slow response never rolls the client back.
 * @param {number|null} current
 * @param {number} incoming
 * @param {number|null} [baseline]
 */
export function acceptVersion(current, incoming, baseline) {
  if (current === null || current === undefined) return true;
  if (incoming > current) return true;
  return incoming < current && baseline !== undefined && baseline === current;
}

/**
 * What to do with a polled version: 'stale' if the store changed while the poll was in flight
 * (its answer predates what we hold; the next poll will tell), 'same' if nothing changed,
 * otherwise 'fetch' (newer, or older after a server-side restore).
 * @param {number|null} before   store version when the poll was sent
 * @param {number|null} current  store version now
 * @param {number} remote        version the server reported
 */
export function pollAction(before, current, remote) {
  if (before !== current) return 'stale';
  if (remote === current) return 'same';
  return 'fetch';
}

/**
 * @param {{onError?: (err: unknown) => void}} [options]  where subscriber errors go (default:
 *   rethrown asynchronously, so they surface as uncaught errors without starving other subscribers)
 */
export function createStore({ onError = rethrowLater } = {}) {
  let state = null;
  const subscribers = new Set();
  return {
    /** @returns {ReturnType<typeof derive> | null} */
    get state() {
      return state;
    },
    /** @returns {number|null} */
    get version() {
      return state ? state.version : null;
    },
    /**
     * Accepts `snapshot` if acceptVersion() says so and notifies subscribers.
     * @param {object} snapshot
     * @param {{baseline?: number|null}} [options]  see acceptVersion()
     * @returns {boolean} whether the snapshot was accepted
     */
    set(snapshot, { baseline } = {}) {
      if (!snapshot || typeof snapshot.version !== 'number') return false;
      if (!acceptVersion(state ? state.version : null, snapshot.version, baseline)) return false;
      const prev = state;
      state = derive(snapshot);
      for (const fn of [...subscribers]) {
        try {
          fn(state, prev);
        } catch (err) {
          onError(err);
        }
      }
      return true;
    },
    /**
     * @param {(state: ReturnType<typeof derive>, prev: ReturnType<typeof derive> | null) => void} fn
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

function rethrowLater(err) {
  setTimeout(() => {
    throw err;
  });
}

/** The app-wide store (api.js pushes every mutation response into it). */
export const store = createStore();

/**
 * Live sync: polls `getVersion()` every `interval` ms while `isVisible()`, and fetches
 * `getState()` into the store when the version differs. `wake()` (focus / visibilitychange)
 * checks immediately. Status ('connecting' -> 'live' | 'offline') is reported via `onStatus`.
 *
 * @param {object} deps
 * @param {ReturnType<typeof createStore>} deps.store
 * @param {() => Promise<{version: number}>} deps.getVersion
 * @param {() => Promise<object>} deps.getState
 * @param {number} [deps.interval]
 * @param {{setTimeout: Function, clearTimeout: Function}} [deps.timers]
 * @param {() => boolean} [deps.isVisible]
 * @param {(status: string) => void} [deps.onStatus]
 */
export function createLiveSync({
  store: target,
  getVersion,
  getState,
  interval = 3000,
  timers = globalThis,
  isVisible = () => true,
  onStatus = () => {},
}) {
  let running = false;
  let timer = null;
  let inFlight = null;
  let status = 'connecting';

  function setStatus(next) {
    if (next === status) return;
    status = next;
    onStatus(next);
  }

  /** One poll (and fetch if needed). Concurrent calls share the same request. */
  function checkNow() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const before = target.version;
        const { version } = await getVersion();
        if (pollAction(before, target.version, version) === 'fetch') {
          const baseline = target.version;
          target.set(await getState(), { baseline });
        }
        setStatus('live');
      } catch {
        setStatus('offline');
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function clear() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  function schedule() {
    clear();
    if (running && isVisible()) timer = timers.setTimeout(tick, interval);
  }

  async function tick() {
    timer = null;
    if (isVisible()) await checkNow();
    schedule();
  }

  return {
    /** Starts polling (checks immediately). */
    start() {
      if (running) return Promise.resolve();
      running = true;
      return tick();
    },
    stop() {
      running = false;
      clear();
    },
    /** Call on focus / visibilitychange: check now if visible, else pause polling. */
    wake() {
      if (!running) return Promise.resolve();
      clear();
      return isVisible() ? tick() : Promise.resolve();
    },
    checkNow,
    get status() {
      return status;
    },
  };
}

/**
 * Wires a live sync to browser events. Returns a function that removes the listeners.
 * @param {ReturnType<typeof createLiveSync>} sync
 * @param {Window} win
 */
export function bindLiveSync(sync, win) {
  const wake = () => {
    sync.wake();
  };
  const doc = win.document;
  doc.addEventListener('visibilitychange', wake);
  const events = ['focus', 'online', 'pageshow'];
  for (const type of events) win.addEventListener(type, wake);
  return () => {
    doc.removeEventListener('visibilitychange', wake);
    for (const type of events) win.removeEventListener(type, wake);
  };
}
