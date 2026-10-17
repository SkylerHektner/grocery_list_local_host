// Export cache (SPEC §3.6): the exact text `GET /api/list/export` returns, refetched whenever
// the state version changes. There is no on-screen preview; Copy uses the cached text when it
// matches the current version, so the clipboard write happens inside the click/keypress
// (required by Safari's fallback).

/**
 * @param {{store: object, api: object}} deps
 */
export function createExportCache({ store, api }) {
  let cache = { version: null, text: '' };
  let inFlight = false;
  let again = false;
  let destroyed = false;

  /** Fetches the export if the store moved on; one request at a time, latest wins. */
  async function update() {
    if (destroyed || cache.version === store.version) return;
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
      // Offline: Copy fetches (and reports the error) itself; the next version change retries.
    } finally {
      inFlight = false;
    }
    if (destroyed) return;
    // The store changed while fetching: fetch again (only then, so offline doesn't spin).
    if (again) {
      again = false;
      if (cache.version !== store.version) update();
    }
  }

  update();

  return {
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
