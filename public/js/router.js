// Hash routes (SPEC §3.11): #/list (default), #/recipes, #/items, #/categories. Extra path
// segments are passed to the view as params (e.g. #/recipes/12). Pure; no DOM.

export const VIEWS = Object.freeze([
  Object.freeze({ id: 'list', title: 'List' }),
  Object.freeze({ id: 'recipes', title: 'Recipes' }),
  Object.freeze({ id: 'items', title: 'Items' }),
  Object.freeze({ id: 'categories', title: 'Store order' }),
]);

export const DEFAULT_VIEW = 'list';

/**
 * @param {string} hash  e.g. location.hash
 * @returns {{view: string, params: string[], known: boolean}}  `known` is false when the hash
 *   was not a valid route (the caller should replace it with the canonical one)
 */
export function parseHash(hash) {
  const path = String(hash ?? '').replace(/^#\/?/, '');
  const [first = '', ...rest] = path.split('/');
  const view = VIEWS.find((v) => v.id === first);
  if (!view) return { view: DEFAULT_VIEW, params: [], known: false };
  const params = [];
  for (const segment of rest) {
    if (!segment) continue;
    try {
      params.push(decodeURIComponent(segment));
    } catch {
      params.push(segment);
    }
  }
  return { view: view.id, params, known: true };
}

/** `hashFor('recipes', 12)` -> '#/recipes/12' */
export function hashFor(view, ...params) {
  return `#/${[view, ...params.map((p) => encodeURIComponent(String(p)))].join('/')}`;
}
