// List view (SPEC §3.5). Placeholder until T5 builds the omnibar and the list.

import { itemMeta, placeholderView, recipeMeta } from './placeholder.js';

export default placeholderView({
  id: 'list',
  title: 'List',
  lead: 'Everything you need this trip, in the order you walk the store.',
  placeholder: 'Search items and recipes',
  emptyTitle: 'The list builder is on its way',
  emptyBody: 'Soon: type, press Enter, repeat. For now the search box previews what it will find.',
  candidates: (state) => [...state.items, ...state.recipes],
  meta: (c, state) => ('item_ids' in c ? recipeMeta(c, state) : itemMeta(c, state)),
});
