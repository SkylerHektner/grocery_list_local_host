// Fuzzy matching for the omnibar (SPEC §3.3). Pure functions only: no DOM, no fetch, so it runs
// unchanged in the browser and under `node --test`. T4 implements the full matcher here.

/**
 * Normalizes text for matching: Unicode NFD, combining marks stripped, lowercased.
 * "Crème Brûlée" -> "creme brulee".
 * @param {string} str
 * @returns {string}
 */
export function normalize(str) {
  return String(str).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
