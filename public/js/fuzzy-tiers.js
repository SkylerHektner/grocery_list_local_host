// The seven ranking tiers of SPEC §3.3 (documented in fuzzy.js). Pure; no DOM.

import { prepare } from './fuzzy-text.js';

export const TIER = Object.freeze({
  EXACT: 1,
  PREFIX: 2,
  WORD_PREFIX: 3,
  TOKENS: 4,
  SUBSTRING: 5,
  SUBSEQUENCE: 6,
  TYPO: 7,
});

const TYPO_MIN_LENGTH = 4;
const TYPO_LONG_LENGTH = 8;
const PREFIX_TYPO_MIN_LENGTH = 5;

// Subsequence scoring (tier 6 quality).
const WORD_START_BONUS = 3;
const ADJACENT_BONUS = 2;
const GAP_PENALTY = 0.1;

export function prepareQuery(query) {
  const p = prepare(String(query ?? ''));
  if (!p.norm) return null;
  const tokens = p.words;
  // Longest first for the greedy token -> word assignment; remember which token is last.
  const ordered = tokens
    .map((token, index) => ({ token, last: index === tokens.length - 1 }))
    .sort((a, b) => b.token.length - a.token.length);
  return {
    norm: p.norm,
    tokens,
    ordered,
    compact: tokens.join(''),
    typoable: tokens.some((t) => t.length >= TYPO_MIN_LENGTH),
  };
}

/** Matches one prepared text; returns `{tier, quality, ranges}` (normalized indices) or null. */
export function matchPrepared(t, q, worstTier = TIER.TYPO) {
  const s = t.norm;
  const qs = q.norm;
  const n = qs.length;
  if (!s) return null;
  if (s === qs) return { tier: TIER.EXACT, quality: 0, ranges: [[0, n]] };
  if (s.startsWith(qs)) return { tier: TIER.PREFIX, quality: 0, ranges: [[0, n]] };
  if (worstTier < TIER.WORD_PREFIX) return null;
  for (let w = 1; w < t.starts.length; w++) {
    const at = t.starts[w];
    if (s.startsWith(qs, at)) return { tier: TIER.WORD_PREFIX, quality: 0, ranges: [[at, at + n]] };
  }
  if (worstTier < TIER.TOKENS) return null;
  if (q.tokens.length > 1) {
    const ranges = tokenPrefixes(t, q);
    if (ranges) return { tier: TIER.TOKENS, quality: 0, ranges };
  }
  if (worstTier < TIER.SUBSTRING || q.compact.length < 2) return null;
  const at = s.indexOf(qs);
  if (at >= 0) return { tier: TIER.SUBSTRING, quality: 0, ranges: [[at, at + n]] };
  if (worstTier < TIER.SUBSEQUENCE) return null;
  const sub = subsequence(t, q.compact);
  if (sub) return { tier: TIER.SUBSEQUENCE, quality: sub.quality, ranges: sub.ranges };
  if (worstTier < TIER.TYPO || !q.typoable) return null;
  const typo = typoMatch(t, q);
  if (typo) return { tier: TIER.TYPO, quality: -typo.dist, ranges: typo.ranges };
  return null;
}

/** Tier 4: each token is a prefix of a different word (greedy, longest token first). */
function tokenPrefixes(t, q) {
  const used = new Uint8Array(t.starts.length);
  const ranges = [];
  for (const { token } of q.ordered) {
    let found = -1;
    for (let w = 0; w < t.starts.length; w++) {
      if (!used[w] && t.norm.startsWith(token, t.starts[w])) {
        found = w;
        break;
      }
    }
    if (found < 0) return null;
    used[found] = 1;
    ranges.push([t.starts[found], t.starts[found] + token.length]);
  }
  return ranges;
}

let dpScore = new Float64Array(1024);
let dpFrom = new Int32Array(1024);

/**
 * Tier 6: best alignment of `chars` as a subsequence of the text. The first character must sit
 * at a word start, and so must the first character matched in every later word ("tomatoe" does
 * not match "Tomato p-a-st-E"). Scores 1 per character, +WORD_START_BONUS at word starts,
 * +ADJACENT_BONUS directly after the previous match, -GAP_PENALTY per skipped character.
 */
function subsequence(t, chars) {
  const s = t.norm;
  const len = s.length;
  const m = chars.length;
  if (m > len) return null;

  // Cheap necessary condition: a plain subsequence from the first word starting with chars[0].
  let start = -1;
  for (const w of t.starts) {
    if (s[w] === chars[0]) {
      start = w;
      break;
    }
  }
  if (start < 0) return null;
  let k = 1;
  for (let j = start + 1; j < len && k < m; j++) if (s[j] === chars[k]) k++;
  if (k < m) return null;

  const size = m * len;
  if (dpScore.length < size) {
    dpScore = new Float64Array(size * 2);
    dpFrom = new Int32Array(size * 2);
  }
  const NEG = -Infinity;
  for (let j = 0; j < len; j++) {
    dpScore[j] = s[j] === chars[0] && t.isStart[j] ? 1 + WORD_START_BONUS : NEG;
    dpFrom[j] = -1;
  }
  for (let i = 1; i < m; i++) {
    const row = i * len;
    const prev = row - len;
    const c = chars[i];
    // Best predecessor j' <= j - 2, kept as score + GAP_PENALTY * j' so the gap penalty
    // -GAP_PENALTY * (j - j' - 1) applies in O(1): over the whole text (usable when j starts a
    // word) and within j's own word (usable anywhere).
    let runAll = NEG;
    let runAllAt = -1;
    let runWord = NEG;
    let runWordAt = -1;
    let wordStart = 0;
    for (let j = 0; j < len; j++) {
      if (t.isStart[j]) {
        wordStart = j;
        runWord = NEG;
        runWordAt = -1;
      }
      if (j >= 2) {
        const v = dpScore[prev + j - 2] + GAP_PENALTY * (j - 2);
        if (v > runAll) {
          runAll = v;
          runAllAt = j - 2;
        }
        if (j - 2 >= wordStart && v > runWord) {
          runWord = v;
          runWordAt = j - 2;
        }
      }
      let best = NEG;
      let from = -1;
      if (j >= 1 && s[j] === c) {
        const adjacent = dpScore[prev + j - 1];
        if (adjacent > NEG) {
          best = adjacent + ADJACENT_BONUS;
          from = j - 1;
        }
        const run = t.isStart[j] ? runAll : runWord;
        const runAt = t.isStart[j] ? runAllAt : runWordAt;
        if (runAt >= 0) {
          const gapped = run - GAP_PENALTY * (j - 1);
          if (gapped > best) {
            best = gapped;
            from = runAt;
          }
        }
      }
      dpScore[row + j] = from >= 0 ? best + 1 + (t.isStart[j] ? WORD_START_BONUS : 0) : NEG;
      dpFrom[row + j] = from;
    }
  }
  const last = (m - 1) * len;
  let quality = NEG;
  let end = -1;
  for (let j = 0; j < len; j++) {
    if (dpScore[last + j] > quality) {
      quality = dpScore[last + j];
      end = j;
    }
  }
  if (end < 0) return null;
  const positions = new Array(m);
  for (let i = m - 1, j = end; i >= 0; i--) {
    positions[i] = j;
    j = dpFrom[i * len + j];
  }
  return { quality, ranges: positionsToRanges(positions) };
}

function positionsToRanges(positions) {
  const ranges = [];
  for (const p of positions) {
    const lastRange = ranges[ranges.length - 1];
    if (lastRange && lastRange[1] === p) lastRange[1] = p + 1;
    else ranges.push([p, p + 1]);
  }
  return ranges;
}

/** Tier 7: every token matches a different word, at least one with a typo. */
function typoMatch(t, q) {
  const used = new Uint8Array(t.starts.length);
  const ranges = [];
  let dist = 0;
  let typos = 0;
  for (const { token, last } of q.ordered) {
    let bestWord = -1;
    let best = null;
    for (let w = 0; w < t.starts.length; w++) {
      if (used[w]) continue;
      let candidate = null;
      if (t.norm.startsWith(token, t.starts[w])) candidate = { dist: 0, len: token.length };
      else if (token.length >= TYPO_MIN_LENGTH) {
        const k = token.length >= TYPO_LONG_LENGTH ? 2 : 1;
        candidate = typoDistance(token, t.words[w], k, last && token.length >= PREFIX_TYPO_MIN_LENGTH);
      }
      if (candidate && (!best || candidate.dist < best.dist)) {
        best = candidate;
        bestWord = w;
        if (best.dist === 0) break;
      }
    }
    if (!best) return null;
    used[bestWord] = 1;
    dist += best.dist;
    if (best.dist > 0) typos++;
    ranges.push([t.starts[bestWord], t.starts[bestWord] + best.len]);
  }
  return typos ? { dist, ranges } : null;
}

let rowA = new Int32Array(128);
let rowB = new Int32Array(128);
let rowC = new Int32Array(128);

/**
 * Optimal-string-alignment Damerau-Levenshtein distance between `a` and the word `b` (or, with
 * `allowPrefix`, the closest prefix of `b` of length a.length ± k), if it is <= k. Returns
 * `{dist, len}` (len = matched length of `b`) or null. Stops early once a row exceeds k.
 */
export function typoDistance(a, b, k, allowPrefix = false) {
  const n = a.length;
  if (allowPrefix ? b.length < n - k : Math.abs(b.length - n) > k) return null;
  const m = allowPrefix ? Math.min(b.length, n + k) : b.length;
  if (m + 1 > rowA.length) {
    rowA = new Int32Array(m + 1);
    rowB = new Int32Array(m + 1);
    rowC = new Int32Array(m + 1);
  }
  let prev2 = rowA;
  let prev = rowB;
  let cur = rowC;
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const ai = a.charCodeAt(i - 1);
    const aPrev = i > 1 ? a.charCodeAt(i - 2) : -1;
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ai === bj ? 0 : 1);
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      if (j > 1 && ai === b.charCodeAt(j - 2) && aPrev === bj && prev2[j - 2] + 1 < v) {
        v = prev2[j - 2] + 1;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > k) return null;
    const spare = prev2;
    prev2 = prev;
    prev = cur;
    cur = spare;
  }
  if (!allowPrefix) return prev[m] <= k ? { dist: prev[m], len: m } : null;
  let best = null;
  for (let j = Math.max(1, n - k); j <= m; j++) {
    const d = prev[j];
    // Ties: the whole word, else the prefix closest to the token's length.
    if (
      d <= k &&
      (!best ||
        d < best.dist ||
        (d === best.dist &&
          best.len !== b.length &&
          (j === b.length || Math.abs(j - n) < Math.abs(best.len - n))))
    ) {
      best = { dist: d, len: j };
    }
  }
  return best;
}

