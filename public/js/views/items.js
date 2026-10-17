// Items catalog view (SPEC §3.8). Placeholder until T7.

import { itemMeta, placeholderView } from './placeholder.js';

export default placeholderView({
  id: 'items',
  title: 'Items',
  lead: 'Your catalog: names, aliases, categories and staples.',
  placeholder: 'Search items',
  emptyTitle: 'Catalog editing is coming',
  emptyBody: 'Rename items, add aliases, fix categories and mark staples here.',
  candidates: (state) => state.items,
  meta: itemMeta,
});
