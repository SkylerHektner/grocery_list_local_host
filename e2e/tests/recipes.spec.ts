import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Recipes (SPEC §3.4, §3.7): the cull dialog from the List omnibar and the Recipes view, the
// recipes index and the recipe editor. The DB is shared by every test of the run, so each test
// clears the list first and works on recipes/items with unique names.

type Snapshot = {
  version: number;
  categories: { id: number; name: string }[];
  items: { id: number; name: string; category_id: number | null; staple: boolean }[];
  recipes: { id: number; name: string; ingredients: { item_id: number; note: string | null }[] }[];
  list: {
    entries: { item_id: number; note: string | null; sources: { kind: string; recipe_id?: number }[] }[];
    recipe_ids: number[];
  };
};

async function state(request: APIRequestContext): Promise<Snapshot> {
  const res = await request.get('/api/state');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function resetList(request: APIRequestContext) {
  expect((await request.delete('/api/list')).ok()).toBeTruthy();
}

async function itemIds(request: APIRequestContext, names: string[]) {
  const { items } = await state(request);
  return names.map((name) => {
    const item = items.find((i) => i.name === name);
    if (!item) throw new Error(`no item named ${name}`);
    return item.id;
  });
}

async function createRecipe(request: APIRequestContext, name: string, items: string[]) {
  const ingredients = (await itemIds(request, items)).map((item_id) => ({ item_id }));
  const res = await request.post('/api/recipes', { data: { name, ingredients } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as number;
}

async function addViaApi(request: APIRequestContext, name: string) {
  const [id] = await itemIds(request, [name]);
  expect((await request.post('/api/list/items', { data: { item_id: id } })).ok()).toBeTruthy();
}

/** Names of the items on the list, sorted. */
async function listNames(request: APIRequestContext) {
  const s = await state(request);
  return s.list.entries.map((e) => s.items.find((i) => i.id === e.item_id)!.name).sort();
}

/** A name nothing else fuzzy-matches (random letters, so no typo/prefix overlap). */
function uniqueName() {
  let suffix = '';
  for (let i = 0; i < 9; i++) suffix += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return `Zq${suffix}`;
}

async function open(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'live');
}

/** Focuses a search box (keyboard devices autofocus it; phones don't). */
async function focus(page: Page, testid: string) {
  const input = page.getByTestId(testid);
  if (!(await input.evaluate((el) => el === document.activeElement))) await input.click();
  await expect(input).toBeFocused();
  return input;
}

const toast = (page: Page, text: string) => page.getByTestId('toast').filter({ hasText: text });
const cullRow = (dialog: Locator, name: string) =>
  dialog.getByTestId('cull-row').filter({ has: dialog.page().getByTestId('cull-name').getByText(name, { exact: true }) });
const cullCheck = (dialog: Locator, name: string) => cullRow(dialog, name).getByTestId('cull-check');
const listRow = (page: Page, name: string) =>
  page.getByTestId('list-row').filter({ has: page.getByTestId('row-name').getByText(name, { exact: true }) });

test('create a recipe entirely by keyboard from the List omnibar, then go back', async ({ page, request, isMobile }) => {
  await resetList(request);
  await open(page, '#/list');
  await focus(page, 'list-search');
  const name = uniqueName();

  // No matches: "+ Create item" is highlighted; ↓ to "+ Create recipe", Enter.
  await page.keyboard.type(name);
  await expect(page.getByTestId('omnibar-create-item')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('omnibar-create-recipe')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/#\/recipes\/\d+$/);
  await expect(page.getByTestId('recipe-name-input')).toHaveValue(name);
  await expect(page.getByTestId('ingredients-empty')).toBeVisible();
  await expect(page.getByTestId('recipe-back')).toHaveText('List');
  const search = await focus(page, 'recipe-search');

  // Rapid entry: two known items and a brand-new one through the category picker.
  await page.keyboard.type('milk');
  await page.keyboard.press('Enter');
  await page.keyboard.type('bananas');
  await page.keyboard.press('Enter');
  const fresh = uniqueName();
  await page.keyboard.type(fresh);
  await expect(page.getByTestId('omnibar-create-recipe')).toHaveCount(0); // items only here
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('omnibar-picker-name')).toHaveText(fresh);
  const category = (await page.locator('[data-testid="category-option"][data-number="2"] .option-label').textContent())!.trim();
  await page.keyboard.press('2');

  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByTestId('ingredient-row')).toHaveCount(3);
  await expect(page.locator(`[data-testid="ingredient-group"][data-category="${category}"]`)).toContainText(fresh);
  await expect(page.getByTestId('recipe-summary')).toContainText('3 ingredients');

  // The dropdown marks ingredients; picking one again only says so.
  await page.keyboard.type('milk');
  await expect(page.getByTestId('omnibar-option').first().getByTestId('option-badge')).toHaveText('in recipe');
  await page.keyboard.press('Enter');
  await expect(toast(page, `Milk is already in ${name}`)).toBeVisible();

  // Esc on the empty search goes back to where we came from: the List view.
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/list$/);
  if (!isMobile) await expect(page.getByTestId('list-search')).toBeFocused();

  const s = await state(request);
  const recipe = s.recipes.find((r) => r.name === name)!;
  const names = recipe.ingredients.map(({ item_id }) => s.items.find((i) => i.id === item_id)!.name);
  expect(names).toEqual(['Milk', 'Bananas', fresh]);
  const created = s.items.find((i) => i.name === fresh)!;
  expect(s.categories.find((c) => c.id === created.category_id)?.name).toBe(category);
  expect(s.list.entries).toEqual([]); // creating a recipe never touches the list
});

test('add a recipe from the List omnibar: staples start unchecked, Space toggles, Enter adds', async ({ page, request }) => {
  await resetList(request);
  const name = uniqueName();
  const id = await createRecipe(request, name, ['Ground beef', 'Corn tortillas', 'Salt', 'Limes']);
  await addViaApi(request, 'Limes');
  await open(page, '#/list');
  const input = await focus(page, 'list-search');

  await page.keyboard.type(name);
  await expect(page.getByTestId('omnibar-option').first()).toContainText(name);
  await page.keyboard.press('Enter');

  const dialog = page.getByTestId('cull-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText(`Add ${name}`);
  // List order: walk order (Produce, Bakery, Meat & Seafood, Pantry), then name.
  await expect(dialog.getByTestId('cull-name')).toHaveText(['Limes', 'Corn tortillas', 'Ground beef', 'Salt']);
  await expect(cullCheck(dialog, 'Salt')).not.toBeChecked();
  await expect(cullRow(dialog, 'Salt').getByTestId('cull-tag')).toHaveText(['staple']);
  await expect(cullCheck(dialog, 'Limes')).toBeChecked();
  await expect(cullRow(dialog, 'Limes').getByTestId('cull-tag')).toHaveText(['on list']);
  await expect(page.getByTestId('cull-count')).toHaveText('Adding 3 of 4');

  await expect(cullCheck(dialog, 'Limes')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(cullCheck(dialog, 'Corn tortillas')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(cullCheck(dialog, 'Corn tortillas')).not.toBeChecked();
  await expect(page.getByTestId('cull-count')).toHaveText('Adding 2 of 4');
  await page.keyboard.press('Enter');

  await expect(dialog).toHaveCount(0);
  await expect(input).toBeFocused(); // focus is back in the omnibar
  await expect(page.getByTestId('row-name')).toHaveText(['Limes', 'Ground beef']);
  await expect(page.getByTestId('recipe-chip')).toHaveText([name]);
  await expect(listRow(page, 'Limes').getByTestId('row-source')).toHaveText([name]);
  await expect(toast(page, `Added 2 items from ${name}`)).toBeVisible();

  const s = await state(request);
  expect(s.list.recipe_ids).toEqual([id]);
  expect(await listNames(request)).toEqual(['Ground beef', 'Limes']);
  const limes = s.list.entries.find((e) => s.items.find((i) => i.id === e.item_id)!.name === 'Limes')!;
  expect(limes.sources).toEqual([{ kind: 'manual' }, { kind: 'recipe', recipe_id: id }]);

  // Undo in the toast takes it all back off.
  await toast(page, `Added 2 items from ${name}`).getByTestId('toast-action').click();
  await expect(page.getByTestId('recipe-chip')).toHaveCount(0);
  await expect(page.getByTestId('row-name')).toHaveText(['Limes']);
});

test('cull dialog: a toggles all, Esc cancels without changes, nothing checked adds just the chip', async ({
  page,
  request,
}) => {
  await resetList(request);
  const name = uniqueName();
  await createRecipe(request, name, ['Milk', 'Butter', 'Eggs']);
  await open(page, '#/list');
  const input = await focus(page, 'list-search');
  const dialog = page.getByTestId('cull-dialog');
  const count = page.getByTestId('cull-count');
  const checks = dialog.getByTestId('cull-check');

  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(count).toHaveText('Adding 2 of 3'); // Butter is a staple
  await page.keyboard.press('a');
  await expect(count).toHaveText('Adding 3 of 3');
  for (const check of await checks.all()) await expect(check).toBeChecked();
  await expect(page.getByTestId('cull-toggle-all')).toHaveText('Uncheck all');
  await page.keyboard.press('a');
  await expect(count).toHaveText('Adding 0 of 3');
  for (const check of await checks.all()) await expect(check).not.toBeChecked();
  // The button does the same (for touch).
  await page.getByTestId('cull-toggle-all').click();
  await expect(count).toHaveText('Adding 3 of 3');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(input).toBeFocused();
  let s = await state(request);
  expect(s.list.entries).toEqual([]);
  expect(s.list.recipe_ids).toEqual([]);

  // Culling everything still puts the recipe's chip on the list.
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(count).toHaveText('Adding 2 of 3');
  await page.keyboard.press('a'); // not all checked: checks all
  await page.keyboard.press('a'); // all checked: unchecks all
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('recipe-chip')).toHaveText([name]);
  await expect(toast(page, `Added ${name} without any items`)).toBeVisible();
  s = await state(request);
  expect(s.list.entries).toEqual([]);
  expect(s.list.recipe_ids).toHaveLength(1);
});

test('removing a recipe chip keeps a manually added item (all through the UI)', async ({ page, request }) => {
  await resetList(request);
  const name = uniqueName();
  await createRecipe(request, name, ['Milk', 'Eggs', 'Bananas']);
  await open(page, '#/list');
  await focus(page, 'list-search');

  await page.keyboard.type('milk');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('row-name')).toHaveText(['Milk']);
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('cull-dialog');
  await expect(cullRow(dialog, 'Milk').getByTestId('cull-tag')).toHaveText(['on list']);
  await page.getByTestId('cull-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('row-name')).toHaveText(['Bananas', 'Eggs', 'Milk']);
  await expect(listRow(page, 'Milk').getByTestId('row-source')).toHaveText([name]);

  await page.getByTestId('recipe-chip').filter({ hasText: name }).getByTestId('recipe-chip-remove').click();
  await expect(page.getByTestId('recipe-chip')).toHaveCount(0);
  await expect(page.getByTestId('row-name')).toHaveText(['Milk']);
  await expect(listRow(page, 'Milk').getByTestId('row-source')).toHaveCount(0);
  const s = await state(request);
  expect(await listNames(request)).toEqual(['Milk']);
  expect(s.list.entries[0].sources).toEqual([{ kind: 'manual' }]);
});

test('ingredient notes: edited in the editor, shown in the cull dialog, fill empty list notes, leave with the chip', async ({
  page,
  request,
}) => {
  await resetList(request);
  const name = uniqueName();
  const id = await createRecipe(request, name, ['Milk', 'Eggs', 'Bananas']);
  // Milk is on the list without a note, Eggs with one of its own.
  await addViaApi(request, 'Milk');
  const [eggs] = await itemIds(request, ['Eggs']);
  expect((await request.post('/api/list/items', { data: { item_id: eggs, note: '6' } })).ok()).toBeTruthy();
  await open(page, `#/recipes/${id}`);
  const ingredient = (n: string) =>
    page.getByTestId('ingredient-row').filter({ has: page.getByTestId('ingredient-name').getByText(n, { exact: true }) });
  const noteInput = page.getByTestId('ingredient-note-input');

  // Clicking a row edits its note; Enter saves (normalized) and focuses the row.
  await ingredient('Milk').getByTestId('ingredient-name').click();
  await expect(noteInput).toBeFocused();
  await noteInput.fill('  2   gallons ');
  await page.keyboard.press('Enter');
  await expect(ingredient('Milk').getByTestId('ingredient-note')).toHaveText('2 gallons');
  await expect(ingredient('Milk')).toBeFocused();
  // Enter on a focused row opens the editor too; Esc cancels.
  await page.keyboard.press('Enter');
  await expect(noteInput).toHaveValue('2 gallons');
  await page.keyboard.press('Escape');
  await expect(noteInput).toHaveCount(0);
  await expect(ingredient('Milk')).toBeFocused();
  await ingredient('Eggs').getByTestId('ingredient-name').click();
  await noteInput.fill('12');
  await page.keyboard.press('Enter');

  // "item, note" in the search adds the ingredient with that note.
  await focus(page, 'recipe-search');
  await page.keyboard.type('greek yogurt, 2 tubs');
  await page.keyboard.press('Enter');
  await expect(ingredient('Greek yogurt').getByTestId('ingredient-note')).toHaveText('2 tubs');
  await expect
    .poll(async () => {
      const s = await state(request);
      const recipe = s.recipes.find((r) => r.id === id)!;
      return recipe.ingredients.map((i) => [s.items.find((x) => x.id === i.item_id)!.name, i.note]);
    })
    .toEqual([
      ['Milk', '2 gallons'],
      ['Eggs', '12'],
      ['Bananas', null],
      ['Greek yogurt', '2 tubs'],
    ]);

  // The cull dialog shows the notes (read-only).
  await page.getByTestId('recipe-add-to-list').click();
  const dialog = page.getByTestId('cull-dialog');
  await expect(cullRow(dialog, 'Milk').getByTestId('cull-note')).toHaveText('2 gallons');
  await expect(cullRow(dialog, 'Bananas').getByTestId('cull-note')).toHaveCount(0);
  await page.getByTestId('cull-confirm').click();
  await expect(dialog).toHaveCount(0);

  // On the list the recipe's notes fill empty notes only.
  await open(page, '#/list');
  await expect(listRow(page, 'Milk').getByTestId('row-note')).toHaveText('2 gallons');
  await expect(listRow(page, 'Greek yogurt').getByTestId('row-note')).toHaveText('2 tubs');
  await expect(listRow(page, 'Eggs').getByTestId('row-note')).toHaveText('6');
  await expect(listRow(page, 'Bananas').getByTestId('row-note')).toHaveCount(0);

  // Removing the chip: Milk stays (added manually) without the recipe's note; Eggs keeps its own.
  await page.getByTestId('recipe-chip').filter({ hasText: name }).getByTestId('recipe-chip-remove').click();
  await expect(page.getByTestId('row-name')).toHaveText(['Eggs', 'Milk']);
  await expect(listRow(page, 'Milk').getByTestId('row-note')).toHaveCount(0);
  await expect(listRow(page, 'Eggs').getByTestId('row-note')).toHaveText('6');
});

test('recipes index: filter, Enter opens the editor; back, a adds to the list; n and the create row make new ones', async ({
  page,
  request,
  isMobile,
  consoleErrors,
}) => {
  await resetList(request);
  const name = uniqueName();
  const id = await createRecipe(request, name, ['Milk', 'Butter']);
  await open(page, '#/recipes');
  const search = await focus(page, 'recipes-search');
  const row = page.getByTestId('recipe-row').filter({ hasText: name });
  await expect(row.getByTestId('recipe-count')).toHaveText('2 ingredients');

  await page.keyboard.type(name);
  await expect(page.getByTestId('recipe-row')).toHaveCount(1);
  await expect(page.getByTestId('recipe-create')).toHaveCount(0); // the name exists
  await expect(row).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/recipes/${id}$`));
  await expect(page.getByTestId('recipe-name-input')).toHaveValue(name);
  await expect(page.getByTestId('recipe-back')).toHaveText('Recipes');

  // Back (Esc on the empty ingredient search): the index, with focus on that recipe's row.
  await focus(page, 'recipe-search');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/recipes$/);
  await expect(row).toBeFocused();
  await page.keyboard.press('a');
  const dialog = page.getByTestId('cull-dialog');
  await expect(page.getByTestId('cull-count')).toHaveText('Adding 1 of 2');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeFocused();
  await expect(toast(page, `Added 1 item from ${name}`)).toBeVisible();
  await expect(row.getByTestId('recipe-on-list')).toBeVisible();
  expect(await listNames(request)).toEqual(['Milk']);

  // ↓ from the filter moves into the rows; ↑ on the first row comes back.
  await focus(page, 'recipes-search');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('recipe-row').first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(search).toBeFocused();

  // A name nothing matches: the create row is on top, Enter creates and opens it.
  const fresh = uniqueName();
  await page.keyboard.type(fresh);
  await expect(page.getByTestId('recipes-none')).toBeVisible();
  await expect(page.getByTestId('recipe-create')).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/recipes\/\d+$/);
  await expect(page.getByTestId('recipe-name-input')).toHaveValue(fresh);

  // `n` (not typing) asks for a name; a duplicate shows the server's message inline.
  await page.getByTestId('recipe-back').click();
  await expect(page).toHaveURL(/#\/recipes$/);
  if (isMobile) {
    await page.getByTestId('new-recipe').click();
  } else {
    await expect(page.getByTestId('recipe-row').filter({ hasText: fresh })).toBeFocused();
    await page.keyboard.press('n');
  }
  const nameInput = page.getByTestId('new-recipe-dialog-input');
  await expect(nameInput).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('new-recipe-dialog-error')).toHaveText(`a recipe named "${name}" already exists`);
  await expect(nameInput).toBeFocused();
  consoleErrors.length = 0; // the 409 above
  const other = uniqueName();
  await nameInput.fill(other);
  await expect(page.getByTestId('new-recipe-dialog-error')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('recipe-name-input')).toHaveValue(other);
  expect((await state(request)).recipes.some((r) => r.name === other)).toBe(true);
});

test('editor: rename (live sync keeps the typing), ↓ Delete and Undo, then delete the recipe', async ({
  page,
  request,
  consoleErrors,
}) => {
  await resetList(request);
  const name = uniqueName();
  const id = await createRecipe(request, name, ['Milk', 'Eggs']);
  await request.post('/api/list/recipes', { data: { recipe_id: id, item_ids: await itemIds(request, ['Milk', 'Eggs']) } });
  await open(page, `#/recipes/${id}`);
  const nameInput = page.getByTestId('recipe-name-input');
  const search = page.getByTestId('recipe-search');
  await expect(page.getByTestId('recipe-summary')).toContainText('on list');

  // Rename: Enter saves (normalized) and moves on to the ingredient search.
  const renamed = uniqueName();
  await nameInput.click();
  await nameInput.fill(`  ${renamed.toLowerCase()}  `);
  await page.keyboard.press('Enter');
  await expect(nameInput).toHaveValue(renamed);
  await expect(search).toBeFocused();
  await expect.poll(async () => (await state(request)).recipes.find((r) => r.id === id)?.name).toBe(renamed);

  // A taken name shows the server's message; Esc puts the saved name back.
  await nameInput.click();
  await nameInput.fill('Tacos');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('recipe-name-error')).toHaveText('a recipe named "Tacos" already exists');
  await expect(nameInput).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nameInput).toHaveValue(renamed);
  await expect(page.getByTestId('recipe-name-error')).toBeHidden();
  consoleErrors.length = 0; // the 409 above

  // Unsaved typing in the name survives an update from another device.
  await nameInput.click();
  await nameInput.fill('Half typed');
  const [bananas] = await itemIds(request, ['Bananas']);
  const res = await request.put(`/api/recipes/${id}`, {
    data: {
      name: renamed,
      ingredients: [...(await itemIds(request, ['Milk', 'Eggs'])), bananas].map((item_id) => ({ item_id })),
    },
  });
  expect(res.ok()).toBeTruthy();
  await expect(page.getByTestId('ingredient-row')).toHaveCount(3, { timeout: 8000 });
  await expect(nameInput).toHaveValue('Half typed');
  await expect(nameInput).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nameInput).toHaveValue(renamed);
  await expect(search).toBeFocused();

  // ↓ into the ingredients (walk order: Bananas, Eggs, Milk); Delete, then Undo.
  await page.keyboard.press('ArrowDown');
  const ingredient = (n: string) => page.getByTestId('ingredient-row').filter({ hasText: n });
  await expect(ingredient('Bananas')).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(ingredient('Eggs')).toBeFocused();
  await expect(page.getByTestId('ingredient-name')).toHaveText(['Eggs', 'Milk']);
  await toast(page, `Removed Bananas from ${renamed}`).getByTestId('toast-action').click();
  await expect(page.getByTestId('ingredient-name')).toHaveText(['Bananas', 'Eggs', 'Milk']);
  await expect.poll(async () => (await state(request)).recipes.find((r) => r.id === id)?.ingredients.length).toBe(3);
  await ingredient('Milk').focus();
  await page.keyboard.press('x');
  await expect(page.getByTestId('ingredient-name')).toHaveText(['Bananas', 'Eggs']);
  await expect(ingredient('Eggs')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();

  // Delete (confirmed): back to the index; its items stay on the list as manual ones.
  await page.getByTestId('recipe-delete').click();
  await expect(page.getByTestId('confirm-dialog-message')).toContainText('comes off the list');
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page).toHaveURL(/#\/recipes$/);
  await expect(toast(page, `Deleted ${renamed}`)).toBeVisible();
  await expect(page.getByTestId('recipe-row').filter({ hasText: renamed })).toHaveCount(0);
  const s = await state(request);
  expect(s.recipes.some((r) => r.id === id)).toBe(false);
  expect(s.list.recipe_ids).toEqual([]);
  expect(await listNames(request)).toEqual(['Eggs', 'Milk']);
  expect(s.list.entries.every((e) => e.sources.length === 1 && e.sources[0].kind === 'manual')).toBe(true);
});

test('a recipe without ingredients offers its editor; an unknown recipe shows "not found"', async ({ page, request }) => {
  await resetList(request);
  const name = uniqueName();
  const id = await createRecipe(request, name, []);
  await open(page, '#/list');
  await focus(page, 'list-search');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cull-empty')).toBeVisible();
  await expect(page.getByTestId('cull-edit')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/recipes/${id}$`));
  await expect(page.getByTestId('ingredients-empty')).toBeVisible();
  expect((await state(request)).list.recipe_ids).toEqual([]);

  await open(page, '#/recipes/99999999');
  await expect(page.getByTestId('recipe-not-found')).toContainText('Recipe not found');
  await page.getByTestId('recipe-not-found-back').click();
  await expect(page).toHaveURL(/#\/recipes$/);
  await expect(page.getByTestId('recipe-list')).toBeVisible();

  // A recipe made on another device a moment ago: "not found" until live sync brings it in.
  const later = uniqueName();
  const laterId = await createRecipe(request, later, ['Milk']);
  await page.evaluate((hash) => (location.hash = hash), `#/recipes/${laterId}`);
  await expect(page.getByTestId('recipe-name-input')).toHaveValue(later, { timeout: 8000 });
  await expect(page.getByTestId('ingredient-name')).toHaveText(['Milk']);
});

test('mobile: the cull dialog is a full-screen sheet with a reachable confirm button', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone layout');
  await resetList(request);
  const name = uniqueName();
  const items = ['Ground beef', 'Corn tortillas', 'Sharp cheddar', 'Sour cream', 'Cilantro', 'Limes', 'Avocados', 'Tomatoes', 'Yellow onions', 'Taco seasoning', 'Salt', 'Milk', 'Eggs', 'Bananas'];
  await createRecipe(request, name, items);
  await open(page, '#/recipes');
  await page.getByTestId('recipe-row').filter({ hasText: name }).getByTestId('recipe-add').tap();

  const dialog = page.getByTestId('cull-dialog');
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = (await dialog.boundingBox())!;
      return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
    })
    .toEqual([0, 0, viewport.width, viewport.height]);

  // Big rows; tapping one toggles it.
  const label = cullRow(dialog, 'Milk').locator('label');
  expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await label.tap();
  await expect(cullCheck(dialog, 'Milk')).not.toBeChecked();
  await expect(page.getByTestId('cull-count')).toHaveText(`Adding ${items.length - 2} of ${items.length}`);

  // The confirm button is on screen (sticky at the bottom) even with a long, scrolling list.
  const confirm = page.getByTestId('cull-confirm');
  const box = (await confirm.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const scrolls = await dialog.locator('.modal-body').evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
  const overflow = await dialog.locator('.modal-body').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await confirm.tap();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page, `Added ${items.length - 2} items from ${name}`)).toBeVisible();
  expect((await listNames(request)).length).toBe(items.length - 2);
});
