// Recipes view (SPEC §3.7). Placeholder until T6.

import { placeholderView, recipeMeta } from './placeholder.js';

export default placeholderView({
  id: 'recipes',
  title: 'Recipes',
  lead: 'Sets of ingredients you can drop onto the list in one go.',
  placeholder: 'Search recipes',
  emptyTitle: 'Recipes are coming next',
  emptyBody: 'Create, edit and add recipes to the list from here.',
  candidates: (state) => state.recipes,
  meta: recipeMeta,
});
