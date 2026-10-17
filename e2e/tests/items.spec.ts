import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Items catalog (SPEC §3.8): inline editor, staple toggle, category picker, delete, merge and
// `+ New item` from the filter. The DB is shared by every test of the run, so each test works on
// items and recipes with unique names (demo items are only read, never changed).

type Item = { id: number; name: string; category_id: number | null; aliases: string[]; staple: boolean };
type Snapshot = {
  version: number;
  categories: { id: number; name: string }[];
  items: Item[];
  recipes: { id: number; name: string; item_ids: number[] }[];
  list: { entries: { item_id: number; note: string | null }[]; recipe_ids: number[] };
};

async function state(request: APIRequestContext): Promise<Snapshot> {
  const res = await request.get('/api/state');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function resetList(request: APIRequestContext) {
  expect((await request.delete('/api/list')).ok()).toBeTruthy();
}

async function categoryId(request: APIRequestContext, name: string) {
  const category = (await state(request)).categories.find((c) => c.name === name);
  if (!category) throw new Error(`no category named ${name}`);
  return category.id;
}

async function itemId(request: APIRequestContext, name: string) {
  const item = (await state(request)).items.find((i) => i.name === name);
  if (!item) throw new Error(`no item named ${name}`);
  return item.id;
}

async function findItem(request: APIRequestContext, name: string) {
  return (await state(request)).items.find((i) => i.name === name);
}

async function createItem(request: APIRequestContext, data: Partial<Item> & { name: string }) {
  const res = await request.post('/api/items', { data });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as number;
}

async function createRecipe(request: APIRequestContext, name: string, itemIds: number[]) {
  const res = await request.post('/api/recipes', { data: { name, item_ids: itemIds } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as number;
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

/** Types into the items filter (desktop autofocuses it; phones fill it). */
async function filter(page: Page, isMobile: boolean, text: string) {
  const search = page.getByTestId('items-search');
  if (isMobile) await search.fill(text);
  else {
    await expect(search).toBeFocused();
    await page.keyboard.type(text);
  }
}

const itemRow = (page: Page, name: string) =>
  page.getByTestId('item-row').filter({ has: page.getByTestId('item-name').getByText(name, { exact: true }) });
const toast = (page: Page, text: string) => page.getByTestId('toast').filter({ hasText: text });
const cullRow = (dialog: Locator, name: string) =>
  dialog.getByTestId('cull-row').filter({ has: dialog.page().getByTestId('cull-name').getByText(name, { exact: true }) });

test('keyboard: edit an alias inline, then find the item by it in the List omnibar', async ({ page, request, isMobile }) => {
  test.skip(isMobile, 'keyboard flow (phones: see the tap tests below)');
  await resetList(request);
  const name = uniqueName();
  const alias = uniqueName();
  await createItem(request, { name, category_id: await categoryId(request, 'Pantry') });
  await open(page, '#/items');

  // Enter in the filter edits the top match.
  await filter(page, isMobile, name);
  await expect(itemRow(page, name)).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  const editor = page.getByTestId('item-editor');
  await expect(editor.getByTestId('item-edit-name')).toBeFocused();
  await expect(editor.getByTestId('item-edit-category')).toHaveValue(String(await categoryId(request, 'Pantry')));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(editor.getByTestId('item-edit-aliases')).toBeFocused();
  await page.keyboard.type(`  ${alias.toLowerCase()} ,`);
  await page.keyboard.press('Enter');

  // Saved (normalized); the row has focus again.
  await expect(editor).toHaveCount(0);
  const row = itemRow(page, name);
  await expect(row).toBeFocused();
  await expect(row.getByTestId('item-aliases')).toHaveText(`aka ${alias}`);
  await expect.poll(async () => (await findItem(request, name))?.aliases).toEqual([alias]);

  // Esc leaves the editor without saving.
  await page.keyboard.press('Enter');
  await expect(editor.getByTestId('item-edit-name')).toBeFocused();
  await page.keyboard.type('Something else');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(row).toBeFocused();
  expect((await findItem(request, name))?.name).toBe(name);

  // The List omnibar finds the item by its new alias.
  await page.keyboard.press('Alt+1');
  const omnibar = page.getByTestId('list-search');
  await expect(omnibar).toBeFocused();
  await page.keyboard.type(alias.toLowerCase());
  const first = page.getByTestId('omnibar-option').first();
  await expect(first).toContainText(name);
  await expect(first.locator('.option-alias')).toHaveText(alias);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('list-row').filter({ hasText: name })).toBeVisible();
});

test('staple on (s, or the editor on phones): the cull dialog then starts the item unchecked', async ({
  page,
  request,
  isMobile,
}) => {
  await resetList(request);
  const name = uniqueName();
  const id = await createItem(request, { name, category_id: await categoryId(request, 'Pantry') });
  const recipe = uniqueName();
  await createRecipe(request, recipe, [id, await itemId(request, 'Milk')]);
  await open(page, '#/items');
  await filter(page, isMobile, name);
  const row = itemRow(page, name);

  if (isMobile) {
    await row.getByTestId('item-name').tap();
    await page.getByTestId('item-edit-staple').tap();
    await page.getByTestId('item-edit-save').tap();
    await expect(page.getByTestId('item-editor')).toHaveCount(0);
  } else {
    await page.keyboard.press('ArrowDown');
    await expect(row).toBeFocused();
    await page.keyboard.press('s');
    await expect(toast(page, `${name} is a staple now`)).toBeVisible();
    // Rapid toggles all land, in order: on (above), off, on.
    await page.keyboard.press('s');
    await page.keyboard.press('s');
    await expect(toast(page, `${name} is no longer a staple`)).toHaveCount(1);
    await expect(toast(page, `${name} is a staple now`)).toHaveCount(2);
    await expect(row).toBeFocused();
  }
  await expect(row.getByTestId('item-staple')).toBeVisible();
  await expect.poll(async () => (await findItem(request, name))?.staple).toBe(true);
  // The Staples chip lists it.
  await page.getByTestId('filter-staples').click();
  await expect(page.getByTestId('filter-staples')).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toBeVisible();

  // The recipe's cull dialog starts it unchecked, tagged "staple".
  await open(page, '#/recipes');
  await page.getByTestId('recipe-row').filter({ hasText: recipe }).getByTestId('recipe-add').click();
  const dialog = page.getByTestId('cull-dialog');
  await expect(cullRow(dialog, name).getByTestId('cull-check')).not.toBeChecked();
  await expect(cullRow(dialog, name).getByTestId('cull-tag')).toHaveText(['staple']);
  await expect(cullRow(dialog, 'Milk').getByTestId('cull-check')).toBeChecked();
  await page.getByTestId('cull-cancel').click();
  await expect(dialog).toHaveCount(0);
});

test('change the category: c then a digit (phones: tap the category); uncategorized rows are flagged', async ({
  page,
  request,
  isMobile,
}) => {
  const name = uniqueName();
  await createItem(request, { name });
  const second = (await state(request)).categories[1];
  await open(page, '#/items');

  // The Uncategorized chip shows only uncategorized items; this one is flagged.
  await page.getByTestId('filter-uncategorized').click();
  await expect(page.getByTestId('filter-uncategorized')).toHaveAttribute('aria-pressed', 'true');
  const row = itemRow(page, name);
  await expect(row).toHaveClass(/is-uncategorized/);
  await expect(row.getByTestId('item-category')).toHaveText('Uncategorized');
  await expect(page.getByTestId('item-row').filter({ hasText: 'Milk' })).toHaveCount(0);

  const picker = page.getByTestId('category-picker');
  if (isMobile) {
    for (const target of [row.getByTestId('item-category'), page.getByTestId('filter-uncategorized')]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await row.getByTestId('item-category').tap();
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId('category-picker-input')).not.toBeFocused(); // no keyboard pop-up
    await picker.getByTestId('category-option').filter({ hasText: second.name }).tap();
  } else {
    await page.keyboard.press('/');
    await page.keyboard.type(name);
    await page.keyboard.press('ArrowDown');
    await expect(row).toBeFocused();
    await page.keyboard.press('c');
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('heading')).toHaveText(`Category for ${name}`);
    // The current category (Uncategorized) is marked and highlighted.
    await expect(picker.locator('[aria-selected="true"]')).toContainText('Uncategorized');
    await expect(picker.getByTestId('category-current')).toHaveCount(1);
    await page.keyboard.press('2');
  }
  await expect(picker).toHaveCount(0);
  await expect(toast(page, `Moved ${name} to ${second.name}`)).toBeVisible();
  // It has a category now, so the Uncategorized filter drops it.
  await expect(row).toHaveCount(0);
  expect((await findItem(request, name))?.category_id).toBe(second.id);

  await page.getByTestId('filter-uncategorized').click();
  await page.getByTestId('items-search').fill(name);
  await expect(row.getByTestId('item-category')).toHaveText(second.name);
  await expect(row).not.toHaveClass(/is-uncategorized/);
});

test('delete an item: the confirm names its recipes; it leaves them and the list', async ({ page, request, isMobile }) => {
  await resetList(request);
  const name = uniqueName();
  const id = await createItem(request, { name, category_id: await categoryId(request, 'Pantry') });
  const milk = await itemId(request, 'Milk');
  const recipe = uniqueName();
  const recipeId = await createRecipe(request, recipe, [id, milk]);
  expect((await request.post('/api/list/items', { data: { item_id: id } })).ok()).toBeTruthy();
  await open(page, '#/items');
  await filter(page, isMobile, name);
  const row = itemRow(page, name);
  await expect(row.getByTestId('item-on-list')).toBeVisible();

  if (isMobile) {
    await row.getByTestId('item-name').tap();
    await page.getByTestId('item-delete').tap();
  } else {
    await page.keyboard.press('ArrowDown');
    await expect(row).toBeFocused();
    await page.keyboard.press('Delete');
  }
  await expect(page.getByTestId('confirm-dialog-message')).toHaveText(
    `It comes out of ${recipe}, and off the list. This can't be undone.`,
  );
  if (isMobile) await page.getByTestId('confirm-dialog-confirm').tap();
  else await page.keyboard.press('Enter');

  await expect(toast(page, `Deleted ${name}`)).toBeVisible();
  await expect(row).toHaveCount(0);
  const s = await state(request);
  expect(s.items.some((i) => i.id === id)).toBe(false);
  expect(s.recipes.find((r) => r.id === recipeId)?.item_ids).toEqual([milk]);
  expect(s.list.entries.some((e) => e.item_id === id)).toBe(false);

  // The recipe editor shows what is left.
  await open(page, `#/recipes/${recipeId}`);
  await expect(page.getByTestId('ingredient-name')).toHaveText(['Milk']);
});

test('merge an item into another: its name becomes an alias; recipe and list references move', async ({
  page,
  request,
  isMobile,
}) => {
  await resetList(request);
  const from = uniqueName();
  const into = uniqueName();
  const pantry = await categoryId(request, 'Pantry');
  const fromId = await createItem(request, { name: from, category_id: pantry });
  const intoId = await createItem(request, { name: into });
  const milk = await itemId(request, 'Milk');
  const recipe = uniqueName();
  const recipeId = await createRecipe(request, recipe, [fromId, milk]);
  expect((await request.post('/api/list/items', { data: { item_id: fromId, note: '2 jars' } })).ok()).toBeTruthy();
  await open(page, '#/items');
  await filter(page, isMobile, from);

  const picker = page.getByTestId('merge-picker');
  if (isMobile) {
    await itemRow(page, from).getByTestId('item-name').tap();
    await page.getByTestId('item-merge').tap();
    await picker.getByTestId('merge-picker-input').fill(into);
    await picker.getByTestId('merge-option').filter({ hasText: into }).tap();
  } else {
    await page.keyboard.press('ArrowDown');
    await expect(itemRow(page, from)).toBeFocused();
    await page.keyboard.press('m');
    await expect(picker.getByTestId('merge-picker-input')).toBeFocused();
    await page.keyboard.type(into);
    await expect(picker.getByTestId('merge-option').first()).toContainText(into);
    await page.keyboard.press('Enter');
  }
  await expect(page.getByTestId('merge-confirm-message')).toHaveText(
    `${from} will become an alias of ${into}; 1 recipe updated. Its list entry becomes ${into}. ${into} moves to Pantry. This can't be undone.`,
  );
  if (isMobile) await page.getByTestId('merge-confirm-confirm').tap();
  else await page.keyboard.press('Enter');

  await expect(toast(page, `Merged ${from} into ${into}`)).toBeVisible();
  // The filter text is the old name: it now finds the kept item through its new alias.
  await expect(itemRow(page, from)).toHaveCount(0);
  const kept = itemRow(page, into);
  await expect(kept.getByTestId('item-aliases')).toHaveText(`aka ${from}`);
  await expect(kept.getByTestId('item-category')).toHaveText('Pantry');
  if (!isMobile) await expect(kept).toBeFocused();

  const s = await state(request);
  expect(s.items.some((i) => i.id === fromId)).toBe(false);
  const item = s.items.find((i) => i.id === intoId)!;
  expect(item.aliases).toEqual([from]);
  expect(item.category_id).toBe(pantry);
  expect(s.recipes.find((r) => r.id === recipeId)?.item_ids).toEqual([intoId, milk]);
  expect(s.list.entries.map((e) => [e.item_id, e.note])).toEqual([[intoId, '2 jars']]);
});

test('create an item from the filter: + New item, then pick its category', async ({ page, request, isMobile }) => {
  const name = uniqueName();
  const third = (await state(request)).categories[2];
  await open(page, '#/items');
  await filter(page, isMobile, name.toLowerCase());

  // Nothing matches: the create row is on top (and highlighted while typing).
  await expect(page.getByTestId('items-none')).toBeVisible();
  const create = page.getByTestId('item-create');
  await expect(create).toContainText(`New item ${name.toLowerCase()}`);
  const picker = page.getByTestId('category-picker');
  if (isMobile) {
    await create.tap();
    await picker.getByTestId('category-option').filter({ hasText: third.name }).tap();
  } else {
    await expect(create).toHaveClass(/is-active/);
    await page.keyboard.press('Enter');
    await expect(picker.getByRole('heading')).toHaveText(`New item "${name.toLowerCase()}"`);
    await expect(picker.getByTestId('category-picker-input')).toBeFocused();
    // Typing filters the categories; Enter picks the highlighted one.
    await page.keyboard.type(third.name.slice(0, 4));
    await expect(picker.locator('[aria-selected="true"]')).toContainText(third.name);
    await page.keyboard.press('Enter');
  }
  await expect(picker).toHaveCount(0);
  const row = itemRow(page, name);
  await expect(row.getByTestId('item-category')).toHaveText(third.name);
  await expect(create).toHaveCount(0); // the name exists now
  if (!isMobile) await expect(row).toBeFocused();
  const item = await findItem(request, name);
  expect(item?.category_id).toBe(third.id);
});

test('editor: a duplicate name shows inline; live sync keeps the typing and the filter', async ({
  page,
  request,
  isMobile,
  consoleErrors,
}) => {
  test.skip(isMobile, 'keyboard flow');
  const name = uniqueName();
  await createItem(request, { name });
  await open(page, '#/items');
  await filter(page, isMobile, name);
  await page.keyboard.press('Enter');
  const editor = page.getByTestId('item-editor');
  const nameInput = editor.getByTestId('item-edit-name');
  await expect(nameInput).toBeFocused();

  // 409: the server's message under the field; the editor stays open.
  await page.keyboard.type('milk');
  await page.keyboard.press('Enter');
  await expect(editor.getByTestId('item-editor-error')).toHaveText('an item named "Milk" already exists');
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
  await expect.poll(() => consoleErrors.length).toBeGreaterThan(0);
  consoleErrors.length = 0; // the expected 409

  // An alias that is another item's name: the message is on the aliases field.
  await nameInput.fill(name);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Eggs');
  await page.keyboard.press('Enter');
  const aliases = editor.getByTestId('item-edit-aliases');
  await expect(editor.getByTestId('item-editor-error')).toHaveText('alias "Eggs" is already the name of item "Eggs"');
  await expect(aliases).toHaveAttribute('aria-invalid', 'true');
  await expect.poll(() => consoleErrors.length).toBeGreaterThan(0);
  consoleErrors.length = 0;

  // A change from another device re-renders the rows; the half-typed aliases and the filter stay.
  await aliases.fill('Half typed');
  const summary = page.getByTestId('items-summary');
  const before = await summary.textContent();
  await createItem(request, { name: uniqueName() });
  await expect(summary).not.toHaveText(before!, { timeout: 8000 });
  await expect(aliases).toHaveValue('Half typed');
  await expect(aliases).toBeFocused();
  await expect(page.getByTestId('items-search')).toHaveValue(name);

  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await findItem(request, name))?.aliases).toEqual(['Half typed']);
});
