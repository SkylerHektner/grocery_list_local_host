// Store order view (SPEC §3.9). Placeholder until T7.

import { h } from '../dom.js';
import { placeholderView } from './placeholder.js';

export default placeholderView({
  id: 'categories',
  title: 'Store order',
  lead: 'The sections of your store, in the order you walk through it.',
  placeholder: 'Search store sections',
  emptyTitle: 'Reordering is coming',
  emptyBody: 'Arrange the sections to match your path through the store.',
  candidates: (state) => state.categories,
  meta: (category, state) => [
    h('span', { class: 'option-category' }, `stop ${state.categoryIndex.get(category.id) + 1}`),
  ],
});
