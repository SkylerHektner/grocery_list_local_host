// Text normalization for fuzzy matching (see fuzzy.js): folding, words, and mapping matched
// ranges back to the original text. Pure; no DOM.

// Letters NFD does not decompose, plus apostrophes (deleted rather than treated as separators).
const FOLD = new Map([
  ['ß', 'ss'], ['æ', 'ae'], ['œ', 'oe'], ['ø', 'o'], ['ł', 'l'], ['đ', 'd'], ['ð', 'd'],
  ['þ', 'th'], ['ı', 'i'], ["'", ''], ['’', ''], ['‘', ''], ['ʼ', ''], ['`', ''],
]);
const COMBINING_MARK = /\p{M}/u;
const COMBINING_MARKS = /\p{M}/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function foldChar(ch) {
  const code = ch.charCodeAt(0);
  if (code < 128) {
    if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
    return FOLD.get(ch) ?? ch;
  }
  const lower = ch.toLowerCase();
  return FOLD.get(lower) ?? lower.normalize('NFD').replace(COMBINING_MARKS, '');
}

function isWordChar(c) {
  const code = c.charCodeAt(0);
  if (code < 128) {
    return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || (code >= 65 && code <= 90);
  }
  return WORD_CHAR.test(c);
}

/**
 * Prepared form of a text: `norm` plus, for every normalized character, the raw range it came
 * from (`from`/`to`), and the words (`starts`/`ends`/`words`, `isStart` per character).
 */
function build(raw) {
  const chars = [];
  const from = [];
  const to = [];
  let gapAt = -1;
  for (let i = 0; i < raw.length; ) {
    const len = raw.codePointAt(i) > 0xffff ? 2 : 1;
    for (const c of foldChar(raw.slice(i, i + len))) {
      if (isWordChar(c)) {
        if (gapAt >= 0 && chars.length) {
          chars.push(' ');
          from.push(gapAt);
          to.push(gapAt + 1);
        }
        gapAt = -1;
        chars.push(c);
        from.push(i);
        to.push(i + len);
      } else if (c && gapAt < 0) {
        gapAt = i;
      }
    }
    i += len;
  }
  const norm = chars.join('');
  const starts = [];
  const ends = [];
  const isStart = new Uint8Array(norm.length);
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] === ' ') continue;
    if (i === 0 || norm[i - 1] === ' ') {
      starts.push(i);
      isStart[i] = 1;
    }
    if (i === norm.length - 1 || norm[i + 1] === ' ') ends.push(i + 1);
  }
  const words = starts.map((s, w) => norm.slice(s, ends[w]));
  return { raw, norm, from, to, starts, ends, words, isStart };
}

// Names rarely change, so prepared texts are cached by their raw string.
const CACHE_LIMIT = 10_000;
const cache = new Map();

export function prepare(raw) {
  let prepared = cache.get(raw);
  if (prepared === undefined) {
    if (cache.size >= CACHE_LIMIT) cache.clear();
    prepared = build(raw);
    cache.set(raw, prepared);
  }
  return prepared;
}

/**
 * Normalizes text for matching: lowercased, diacritics stripped, apostrophes dropped, other
 * punctuation and whitespace runs collapsed to single spaces, trimmed.
 * "Crème Brûlée" -> "creme brulee", "Half-and-half" -> "half and half".
 * @param {string} str
 * @returns {string}
 */
export function normalize(str) {
  return prepare(String(str ?? '')).norm;
}

/** Converts normalized-index ranges to sorted, merged ranges of the raw text. */
export function toRawRanges(t, ranges) {
  const out = [];
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  for (const [a, b] of sorted) {
    if (b <= a) continue;
    const start = t.from[a];
    let end = t.to[b - 1];
    while (end < t.raw.length && COMBINING_MARK.test(t.raw[end])) end++;
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * Splits `text` into highlighted and plain segments for rendering. Render each segment's text
 * as a text node (see `highlight()` in dom.js); never as HTML.
 * @param {string} text
 * @param {Array<[number, number]>} ranges  [start, end) ranges, e.g. a SearchResult's `ranges`
 * @returns {{text: string, match: boolean}[]}
 */
export function segments(text, ranges = []) {
  const str = String(text ?? '');
  const out = [];
  let pos = 0;
  const sorted = ranges
    .map(([a, b]) => [Math.max(0, a), Math.min(str.length, b)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  for (const [a, b] of sorted) {
    const start = Math.max(a, pos);
    if (b <= start) continue;
    if (start > pos) out.push({ text: str.slice(pos, start), match: false });
    const last = out[out.length - 1];
    if (last && last.match && start === pos) last.text += str.slice(start, b);
    else out.push({ text: str.slice(start, b), match: true });
    pos = b;
  }
  if (pos < str.length) out.push({ text: str.slice(pos), match: false });
  return out;
}
