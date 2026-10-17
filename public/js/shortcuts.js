// Every keyboard shortcut in the SPEC, for the `?` overlay. Pure data.
// `keys`: alternatives, shown separated by "/"; '+' joins keys pressed together.
// `views`: views the group belongs to (shown first there); none = everywhere.
// When a view implements (or changes) a shortcut, keep this list in sync. Views can also add
// entries at runtime through their `shortcuts` property (see main.js).

export const SHORTCUT_GROUPS = [
  {
    title: 'Everywhere',
    items: [
      { keys: ['Alt+1–4'], label: 'Switch view: List, Recipes, Items, Store order' },
      { keys: ['/', 'Ctrl+K'], label: 'Focus the search box' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['Esc'], label: 'Close a dialog or this overlay' },
    ],
  },
  {
    title: 'Search box',
    views: ['list', 'recipes'],
    items: [
      { keys: ['↑', '↓'], label: 'Move the highlight' },
      { keys: ['Enter'], label: 'Add the highlighted item or recipe' },
      { keys: ['Shift+Enter'], label: 'Create a new item' },
      { keys: ['Enter'], label: 'After "eggs, 2 dozen": add with a note' },
      { keys: ['Esc'], label: 'Clear the search; again to leave it' },
    ],
  },
  {
    title: 'New item: pick a category',
    views: ['list', 'recipes'],
    items: [
      { keys: ['1–9'], label: 'Pick a numbered category' },
      { keys: ['0', 'Tab'], label: 'Uncategorized' },
      { keys: ['↑', '↓'], label: 'Move the highlight' },
      { keys: ['Enter'], label: 'Pick the highlighted category' },
      { keys: ['Esc', 'Backspace'], label: 'Back to the search (Backspace: when the filter is empty)' },
    ],
  },
  {
    title: 'List',
    views: ['list'],
    items: [
      { keys: ['↓'], label: 'From an empty search: move into the list' },
      { keys: ['↑', '↓'], label: 'Move up / down the grid (↑ on the top line: back to the search)' },
      { keys: ['←', '→', 'j', 'k'], label: 'Previous / next item' },
      { keys: ['Home', 'End'], label: 'First / last item' },
      { keys: ['Delete', 'Backspace', 'x'], label: 'Remove the item' },
      { keys: ['Enter', 'n'], label: 'Edit the note (Enter saves, Esc cancels)' },
      { keys: ['/', 'Esc'], label: 'Back to the search' },
      { keys: ['Ctrl+Z'], label: 'Undo the last list change (when not typing)' },
      { keys: ['Ctrl+Shift+C'], label: 'Copy the list (also from the search box)' },
    ],
  },
  {
    title: 'Adding a recipe',
    views: ['list', 'recipes'],
    items: [
      { keys: ['↑', '↓', 'j', 'k'], label: 'Move between ingredients' },
      { keys: ['Home', 'End'], label: 'First / last ingredient' },
      { keys: ['Space'], label: 'Keep or skip the ingredient' },
      { keys: ['a'], label: 'Toggle all' },
      { keys: ['Enter'], label: 'Add to the list' },
      { keys: ['Esc'], label: 'Cancel' },
    ],
  },
  {
    title: 'Recipes',
    views: ['recipes'],
    items: [
      { keys: ['Enter'], label: 'In the filter: open the top match, or create the typed name' },
      { keys: ['↓'], label: 'From the filter: move into the recipes' },
      { keys: ['↑', '↓', 'j', 'k'], label: 'Move between recipes (↑ on the first: back to the filter)' },
      { keys: ['Home', 'End'], label: 'First / last recipe' },
      { keys: ['Enter'], label: 'Open the recipe' },
      { keys: ['a'], label: 'Add the recipe to the list' },
      { keys: ['n'], label: 'New recipe' },
      { keys: ['/', 'Esc'], label: 'Back to the filter' },
      { keys: ['Esc'], label: 'In the filter: clear it; again to leave it' },
    ],
  },
  {
    title: 'Recipe editor',
    views: ['recipes'],
    items: [
      { keys: ['F2'], label: 'Rename the recipe (Enter saves, Esc cancels)' },
      { keys: ['↓'], label: 'From the empty search: move into the ingredients' },
      { keys: ['↑', '↓', 'j', 'k'], label: 'Move between ingredients (↑ on the first: back to the search)' },
      { keys: ['Home', 'End'], label: 'First / last ingredient' },
      { keys: ['Enter', 'n'], label: "Edit the ingredient's note for the list (Enter saves, Esc cancels)" },
      { keys: ['Delete', 'Backspace', 'x'], label: 'Remove the ingredient' },
      { keys: ['/', 'Esc'], label: 'Back to the search' },
      { keys: ['Esc'], label: 'From the empty search: back to the recipes (or the list)' },
    ],
  },
  {
    title: 'Items',
    views: ['items'],
    items: [
      { keys: ['Enter'], label: 'In the filter: edit the top match, or create the typed name' },
      { keys: ['↓'], label: 'From the filter: move into the items' },
      { keys: ['↑', '↓', 'j', 'k'], label: 'Move between items (↑ on the first: back to the filter)' },
      { keys: ['Home', 'End'], label: 'First / last item' },
      { keys: ['Enter', 'F2'], label: 'Edit the item (Enter saves, Esc cancels)' },
      { keys: ['s'], label: 'Staple on / off' },
      { keys: ['c'], label: 'Change the category' },
      { keys: ['m'], label: 'Merge into another item' },
      { keys: ['Delete', 'Backspace'], label: 'Delete the item' },
      { keys: ['Enter'], label: 'On "Show more": the next 100 items' },
      { keys: ['/', 'Esc'], label: 'Back to the filter' },
      { keys: ['Esc'], label: 'In the filter: clear it; again to leave it' },
    ],
  },
  {
    title: 'Pick a category',
    views: ['items'],
    items: [
      { keys: ['1–9'], label: 'Pick a numbered category' },
      { keys: ['0', 'Tab'], label: 'Uncategorized' },
      { keys: ['↑', '↓'], label: 'Move the highlight (typing filters)' },
      { keys: ['Enter'], label: 'Pick the highlighted one' },
      { keys: ['Esc'], label: 'Cancel' },
    ],
  },
  {
    title: 'Store order',
    views: ['categories'],
    items: [
      { keys: ['↑', '↓', 'j', 'k'], label: 'Move between categories' },
      { keys: ['Home', 'End'], label: 'First / last category' },
      { keys: ['Alt+↑', 'Alt+↓'], label: 'Move the category up or down the walk' },
      { keys: ['Enter', 'F2'], label: 'Rename the category' },
      { keys: ['Delete', 'Backspace'], label: 'Delete the category (its items become Uncategorized)' },
      { keys: ['n'], label: 'New category' },
    ],
  },
];

/**
 * Orders the groups for a view: "Everywhere", then the view's groups, then the rest. Extra
 * entries from the view (`{keys, label}`) join its first group, or a group named `viewTitle`.
 * @param {string} viewId
 * @param {string} viewTitle
 * @param {{keys: string[], label: string}[]} [extra]
 */
export function groupsFor(viewId, viewTitle, extra = []) {
  const everywhere = SHORTCUT_GROUPS.filter((g) => !g.views);
  const mine = SHORTCUT_GROUPS.filter((g) => g.views?.includes(viewId)).map((g) => ({
    ...g,
    items: [...g.items],
  }));
  const others = SHORTCUT_GROUPS.filter((g) => g.views && !g.views.includes(viewId));
  const fresh = extra.filter((e) => !mine.some((g) => g.items.some((i) => i.label === e.label)));
  if (fresh.length) {
    const target = mine.find((g) => g.title === viewTitle);
    if (target) target.items.push(...fresh);
    else mine.unshift({ title: viewTitle, views: [viewId], items: fresh });
  }
  return [...everywhere, ...mine, ...others];
}
