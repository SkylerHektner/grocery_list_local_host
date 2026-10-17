// Rendering a long result list a page at a time (the Items view at 1,000+ items): rebuilding
// thousands of rows on every keystroke would make filtering sluggish, and nobody scrolls past
// the first hundred. Pure; no DOM.
//
//   const { shown, hidden } = visibleResults(results, limit, [editingId]);
//   // render `shown`, then a "Show more" row labelled moreLabel(hidden) if hidden > 0

/** Rows rendered at first, and added per "Show more". */
export const ROW_PAGE = 100;

/**
 * The first `limit` results, extended so that the `keep` item ids (an open editor, a row about
 * to get focus) are always among them. `hidden`: how many results are left for "Show more".
 * @template {{item: {id: number}}} R
 * @param {R[]} results
 * @param {number} limit
 * @param {Array<number|null|undefined>} [keep]
 * @returns {{shown: R[], hidden: number}}
 */
export function visibleResults(results, limit, keep = []) {
  let end = Math.min(Math.max(limit, 0), results.length);
  for (const id of keep) {
    if (id === null || id === undefined) continue;
    const at = results.findIndex((r) => r.item.id === id);
    if (at >= end) end = at + 1;
  }
  return { shown: results.slice(0, end), hidden: results.length - end };
}

/** The "Show more" row's label: "Show 100 more (1145 not shown)" / "Show the last 7". */
export function moreLabel(hidden, page = ROW_PAGE) {
  if (hidden <= page) return hidden === 1 ? 'Show the last item' : `Show the last ${hidden}`;
  return `Show ${page} more (${hidden} not shown)`;
}
