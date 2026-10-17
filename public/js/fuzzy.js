// Fuzzy matching for the omnibar and every filter box (SPEC §3.3). Pure functions only: no DOM,
// no fetch, so it runs unchanged in the browser and under `node --test`. Implementation:
// fuzzy-text.js (normalization, ranges) and fuzzy-tiers.js (the tier matchers).
//
//   search('parm', state.items, { limit: 8 })
//   // -> [{ item, tier: 2, quality: 0, field: 'alias', alias: 'Parmesan', text: 'Parmesan',
//   //       ranges: [[0, 4]] }, ...]
//
// Matching works on a normalized form of each text: lowercased, diacritics stripped ("Crème" ->
// "creme"), apostrophes dropped ("Jerry's" -> "jerrys"), and every run of other non-letter/digit
// characters turned into one space ("Half-and-half" -> "half and half"). Words are the runs
// between those spaces. A query is normalized the same way; its words are its tokens.
//
// Tiers (lower is better; the best tier over the name and every alias wins):
//   1 EXACT        the whole text equals the query
//   2 PREFIX       the text starts with the query
//   3 WORD_PREFIX  a later word starts with the query ("rice" -> "Basmati Rice")
//   4 TOKENS       2+ tokens, each a prefix of a different word, any order ("cream hea")
//   5 SUBSTRING    contiguous substring; needs 2+ characters (one letter mid-word is noise)
//   6 SUBSEQUENCE  query letters in order ("gy" -> "Greek Yogurt", "pmsn" -> "Parmesan"); the
//                  first letter, and the first letter matched in each later word, must be at
//                  the start of its word; needs 2+ characters
//   7 TYPO         every token matches a different word: as a prefix, or (tokens of 4+ chars)
//                  within Damerau-Levenshtein 1 (4-7 chars) or 2 (8+ chars) of the word. The last
//                  token (usually still being typed) of 5+ chars may also be that close to a
//                  *prefix* of the word ("strawv" -> "Strawberries"). Tokens under 4 chars never
//                  get typos.
//
// Ranking: tier; then match quality inside tiers 6 (word starts and adjacent letters score
// higher, gaps lower) and 7 (fewer edits); then use_count, last_used (both higher first), shorter
// name, alphabetical. On an equal tier and quality the name beats an alias.

import { prepare, toRawRanges } from './fuzzy-text.js';
import { TIER, prepareQuery, matchPrepared } from './fuzzy-tiers.js';

export { TIER, typoDistance } from './fuzzy-tiers.js';
export { normalize, segments } from './fuzzy-text.js';

/**
 * Matches a query against a single text.
 * @param {string} query
 * @param {string} text
 * @returns {{tier: number, quality: number, ranges: Array<[number, number]>} | null}
 *   `ranges` are [start, end) indices into `text`.
 */
export function matchText(query, text) {
  const q = prepareQuery(query);
  if (!q) return null;
  const t = prepare(String(text ?? ''));
  const m = matchPrepared(t, q);
  return m && { tier: m.tier, quality: m.quality, ranges: toRawRanges(t, m.ranges) };
}

const defaults = {
  name: (c) => c.name,
  aliases: (c) => c.aliases,
  useCount: (c) => c.use_count ?? 0,
  lastUsed: (c) => c.last_used ?? 0,
};

/**
 * @template T
 * @typedef {object} SearchResult
 * @property {T} item          the candidate
 * @property {number} tier     1 (exact) .. 7 (typo), see TIER
 * @property {number} quality  higher is better within a tier (0 for tiers 1-5)
 * @property {'name'|'alias'} field  which text matched
 * @property {string|null} alias     the matching alias, or null when the name matched
 * @property {string} text     the text that matched (name or alias): `ranges` index into it
 * @property {Array<[number, number]>} ranges  [start, end) ranges to highlight in `text`
 */

/**
 * Ranks `candidates` against `query`. An empty or blank query matches nothing (returns []).
 * Works for items, recipes and categories alike: recipes and categories simply have no aliases
 * or usage stats.
 *
 * @template T
 * @param {string} query
 * @param {Iterable<T>} candidates
 * @param {object} [options]
 * @param {(c: T) => string} [options.name]          primary text (default `c.name`)
 * @param {(c: T) => string[] | undefined} [options.aliases]  default `c.aliases`
 * @param {(c: T) => number} [options.useCount]     default `c.use_count ?? 0`
 * @param {(c: T) => number} [options.lastUsed]     default `c.last_used ?? 0`
 * @param {number} [options.limit]                  max results (default: all)
 * @returns {SearchResult<T>[]}
 */
export function search(query, candidates, options = {}) {
  const q = prepareQuery(query);
  if (!q) return [];
  const getName = options.name ?? defaults.name;
  const getAliases = options.aliases ?? defaults.aliases;
  const getUseCount = options.useCount ?? defaults.useCount;
  const getLastUsed = options.lastUsed ?? defaults.lastUsed;
  const limit = options.limit ?? Infinity;

  const hits = [];
  for (const item of candidates) {
    const name = prepare(String(getName(item) ?? ''));
    let best = matchPrepared(name, q);
    let matched = name;
    let isAlias = false;
    const aliases = getAliases(item);
    if (aliases) {
      for (const alias of aliases) {
        if (best && best.tier === TIER.EXACT) break;
        const a = prepare(String(alias));
        const m = matchPrepared(a, q, best ? best.tier : TIER.TYPO);
        if (m && (!best || m.tier < best.tier || (m.tier === best.tier && m.quality > best.quality))) {
          best = m;
          matched = a;
          isAlias = true;
        }
      }
    }
    if (!best) continue;
    hits.push({
      item,
      best,
      matched,
      isAlias,
      name,
      useCount: Number(getUseCount(item)) || 0,
      lastUsed: Number(getLastUsed(item)) || 0,
    });
  }

  hits.sort(compareHits);
  const top = limit < hits.length ? hits.slice(0, Math.max(0, limit)) : hits;
  return top.map((h) => ({
    item: h.item,
    tier: h.best.tier,
    quality: h.best.quality,
    field: h.isAlias ? 'alias' : 'name',
    alias: h.isAlias ? h.matched.raw : null,
    text: h.matched.raw,
    ranges: toRawRanges(h.matched, h.best.ranges),
  }));
}

function compareHits(a, b) {
  return (
    a.best.tier - b.best.tier ||
    b.best.quality - a.best.quality ||
    b.useCount - a.useCount ||
    b.lastUsed - a.lastUsed ||
    a.name.raw.length - b.name.raw.length ||
    (a.name.norm < b.name.norm ? -1 : a.name.norm > b.name.norm ? 1 : 0) ||
    (a.name.raw < b.name.raw ? -1 : a.name.raw > b.name.raw ? 1 : 0)
  );
}

